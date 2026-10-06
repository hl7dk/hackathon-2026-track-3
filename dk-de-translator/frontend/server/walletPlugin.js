// Dev server routes for the wallet demo:
//   POST /issuer/credential  {userId}  -> {credential}   demo MitID login: signs an identity credential
//   GET  /issuer/jwks                   -> {keys}         the issuer's public key
//   GET  /verifier/record?source=<id>   Authorization: Bearer <credential> -> the holder's record
import { issueCredential, issuerKey } from './issuer.js';
import { fetchRecord, verifyCredential } from './verifier.js';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

// testUsers, cprSystem, wallet: from config.yml. sources: config.yml sources with
// upstream (the real FHIR base) and headers (its credentials) resolved by vite.config.js.
export default function walletPlugin({ testUsers, cprSystem, wallet, sources }) {
  if (!testUsers?.length) throw new Error('config.yml needs testUsers for the wallet sign-in');
  if (!wallet?.ttlMinutes) throw new Error('config.yml needs wallet.ttlMinutes');

  const routes = {
    'POST /issuer/credential': async (req, res) => {
      const { userId } = await readJson(req);
      const user = testUsers.find((u) => u.id === userId);
      if (!user) return send(res, 404, { error: `Unknown test user ${userId}` });
      send(res, 200, { credential: await issueCredential(user, wallet.ttlMinutes) });
    },

    'GET /issuer/jwks': (req, res) => send(res, 200, { keys: [issuerKey.jwk] }),

    'GET /verifier/record': async (req, res, url) => {
      const source = sources.find((s) => s.id === url.searchParams.get('source'));
      if (!source) return send(res, 404, { error: `Unknown source ${url.searchParams.get('source')}` });

      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) return send(res, 401, { error: 'Present your identity credential to get your record' });
      let holder;
      try {
        holder = await verifyCredential(token);
      } catch (err) {
        return send(res, 401, { error: `Credential rejected: ${err.message}` });
      }

      try {
        send(res, 200, await fetchRecord({ upstream: source.upstream, headers: source.headers, cprSystem, cpr: holder.sub }));
      } catch (err) {
        send(res, err.status ?? 502, { error: err.message });
      }
    },
  };

  return {
    name: 'wallet-demo',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        const route = routes[`${req.method} ${url.pathname}`];
        if (!route) return next();
        try {
          await route(req, res, url);
        } catch (err) {
          send(res, 500, { error: err.message });
        }
      });
    },
  };
}
