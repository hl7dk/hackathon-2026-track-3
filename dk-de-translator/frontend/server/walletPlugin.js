// Dev server routes for the wallet. wallet.mode in config.yml picks who issues, holds and
// verifies the identity credential: demo.js (our own JWT) or waltid.js (walt.id, OpenID4VC).
//   POST /wallet/sign-in                  {userId}  -> {handle, claims, since}   demo MitID login
//   POST /verifier/requests?source=<id>   Bearer handle -> 201 {requestId, verifier, disclosures}
//                                         a source asks for the CPR; the wallet previews what it would share
//   POST /verifier/requests/<id>/response Bearer handle, {share} -> {shared: true, record, verification} | {shared: false}
//                                         the patient's answer; if shared and verified, their record. verification
//                                         lists what the verifier checked (also when it refuses), and is logged here.
import { randomUUID } from 'node:crypto';
import demoMode from './demo.js';
import { httpError } from './errors.js';
import { createEventLog } from './events.js';
import { fetchRecord } from './fhir.js';
import waltidMode from './waltid.js';

const REQUEST_TTL_MS = 5 * 60 * 1000;

// What the verifier checked, in the dev server's terminal and the live log, so a share can be followed live.
function logVerification(log, verifier, { status, sessionId, checks, disclosed }) {
  const failed = checks.filter((c) => !c.ok);
  log.emit('app', failed.length
    ? `${verifier} refuses: ${failed.map((c) => c.label).join('; ')}`
    : `${verifier} accepts: all ${checks.length} checks passed. It got: ${disclosed.join(', ')}`, !failed.length);
  const lines = [
    `[verifier] ${verifier}: ${status}${sessionId ? ` (walt.id session ${sessionId})` : ''}`,
    ...checks.map((c) => `  ${c.ok ? '✓' : '✗'} ${c.label} [${c.by}]${c.detail ? `: ${c.detail}` : ''}`),
    `  disclosed: ${disclosed.join(', ') || 'nothing'}`,
  ];
  console.log(lines.join('\n'));
}

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

function bearer(req) {
  const handle = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!handle) throw httpError(401, 'Sign in to the wallet first');
  return handle;
}

// testUsers, cprSystem, wallet: from config.yml. sources: config.yml sources with
// upstream (the real FHIR base) and headers (its credentials) resolved by vite.config.js.
export default function walletPlugin({ testUsers, cprSystem, wallet, sources }) {
  if (!testUsers?.length) throw new Error('config.yml needs testUsers for the wallet sign-in');
  const log = createEventLog();
  const stopped = new AbortController(); // ends walt.id's event streams when the dev server stops or restarts
  const modes = { demo: () => demoMode(wallet), waltid: () => waltidMode(wallet.waltid, { emit: log.emit, signal: stopped.signal }) };
  if (!modes[wallet?.mode]) throw new Error(`config.yml wallet.mode must be one of: ${Object.keys(modes).join(', ')}`);
  let mode; // made by the dev server only: waltid mode follows walt.id's event streams, which would keep `vite build` running

  const pending = new Map(); // requestId -> { handle, source, verifier, state, expires }

  const routes = [
    ['POST', /^\/wallet\/sign-in$/, async (req, res) => {
      const { userId } = await readJson(req);
      const user = testUsers.find((u) => u.id === userId);
      if (!user) throw httpError(404, `Unknown test user ${userId}`);
      const since = Date.now(); // the page's log starts here; the server's clock, like the events'
      log.emit('app', `${user.given} ${user.family} signs in with MitID (test user)`);
      const session = await mode.signIn(user);
      log.emit('app', 'Identity credential is in the wallet');
      send(res, 200, { ...session, since });
    }],

    ['POST', /^\/verifier\/requests$/, async (req, res, url) => {
      const handle = bearer(req);
      const source = sources.find((s) => s.id === url.searchParams.get('source'));
      if (!source) throw httpError(404, `Unknown source ${url.searchParams.get('source')}`);

      const { verifier = null, disclosures, state } = await mode.startRequest(handle);
      const now = Date.now();
      for (const [id, p] of pending) if (p.expires < now) pending.delete(id);
      const requestId = randomUUID();
      const request = { handle, source, verifier: verifier ?? source.label, state, expires: now + REQUEST_TTL_MS };
      pending.set(requestId, request);
      log.emit('app', `${request.verifier} asks for: ${disclosures.map((d) => d.label).join(', ')}. Waiting for the patient`);
      send(res, 201, { requestId, verifier: request.verifier, disclosures });
    }],

    ['POST', /^\/verifier\/requests\/([^/]+)\/response$/, async (req, res, url, [requestId]) => {
      const handle = bearer(req);
      const request = pending.get(requestId);
      // Only the wallet the request was made to can answer it, and only once.
      if (!request || request.handle !== handle || request.expires < Date.now()) throw httpError(404, 'No such request (expired or answered already)');
      pending.delete(requestId);

      const { share } = await readJson(req);
      log.emit('app', share === true ? `Patient consents: share with ${request.verifier}` : 'Patient declines: nothing is shared');
      let answer;
      try {
        answer = await mode.answer(handle, request.state, share === true);
      } catch (err) {
        if (err.verification) logVerification(log, request.verifier, err.verification);
        throw err;
      }
      if (!answer) {
        console.log(`[verifier] ${request.verifier}: the patient declined, nothing shared`);
        return send(res, 200, { shared: false });
      }
      const { cpr, verification } = answer;
      logVerification(log, request.verifier, verification);
      const { upstream, headers } = request.source;
      const record = await fetchRecord({ upstream, headers, cprSystem, cpr });
      console.log(`  -> ${record.entry.length} resources for CPR ${cpr} from ${request.source.label}`);
      log.emit('app', `${record.entry.length} resources fetched for the verified CPR, sent to the wallet`);
      send(res, 200, { shared: true, record, verification: { verifier: request.verifier, ...verification } });
    }],
  ];

  return {
    name: 'wallet',
    configureServer(server) {
      mode = modes[wallet.mode]();
      log.attach(server); // the live log, see events.js
      server.httpServer?.on('close', () => stopped.abort());
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        let params;
        const route = routes.find(([method, pattern]) => method === req.method && (params = url.pathname.match(pattern)));
        if (!route) return next();
        try {
          await route[2](req, res, url, params.slice(1));
        } catch (err) {
          if (!err.status) console.error(err);
          if (!err.verification) log.emit('app', err.message, false); // a refusal is logged by logVerification
          send(res, err.status ?? 500, { error: err.message, ...(err.verification && { verification: err.verification }) });
        }
      });
    },
  };
}
