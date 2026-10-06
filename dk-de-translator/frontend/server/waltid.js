// wallet.mode waltid: walt.id's issuer, wallet and verifier (docker compose --profile wallet).
// The wallet is server-side: each test user has an account and a wallet in walt.id's wallet API,
// and the handle the browser holds only points at it. Sign-in issues an EUDI PID (SD-JWT VC)
// over OpenID4VCI; a source asks for the CPR over OpenID4VP.
import { createHash, randomUUID } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { httpError } from './errors.js';

const CPR_CLAIM = 'personal_administrative_number';
const label = (claim) => (claim === CPR_CLAIM ? 'CPR number' : claim);

const sha256 = (text) => createHash('sha256').update(text).digest('base64url');

// What walt.id's verifier checked, in words. Policies not listed here show walt.id's own description.
const POLICY_LABELS = {
  signature: "Issuer's signature on the PID is valid (against the certificate in the PID)",
  'dc+sd-jwt/kb-jwt_signature': "Holder binding: key-binding JWT signed with the wallet's key (cnf in the PID)",
  'dc+sd-jwt/nonce-check': 'Answers this request, not a replayed one (nonce)',
  'dc+sd-jwt/audience-check': 'Meant for this verifier (audience)',
  'dc+sd-jwt/sd_hash-check': 'Disclosures are the ones the wallet signed for (sd_hash)',
  'dc+sd-jwt/kb-jwt_iat-check': 'Key-binding JWT is fresh (iat, max 5 minutes)',
  'dc+sd-jwt/exp-check': 'PID has not expired (exp)',
  'dc+sd-jwt/nbf-check': 'PID is already valid (nbf)',
};

// walt.id's SSE events in words (null: not shown). Unlisted events show their name; *_failed ones their error.
const ISSUER_EVENTS = {
  credential_offer_created: 'Offer for the PID created',
  credential_offer_retrieved: 'Wallet fetched the offer',
  token_request_pre_authorized_code_succeeded: 'Wallet got an access token (pre-authorized code)',
  nonce_request_succeeded: 'Wallet got a nonce, to prove it holds its key',
  credential_request_sd_jwt_vc_succeeded: "PID issued (SD-JWT VC), bound to the wallet's key",
  issuance_status_changed: null,
};
const VERIFIER_EVENTS = {
  authorization_request_requested: "Wallet fetched the GP's request (asks for the CPR)",
  attempted_presentation: 'Wallet sent a presentation: the CPR and a key-binding proof',
  parsed_presentation_available: 'Presentation unpacked (SD-JWT)',
  presentation_validation_available: 'Presentation checked: key binding, nonce, audience',
  validated_credentials_available: "Credential checked: issuer's signature, validity",
  presentation_fulfils_dcql_query: 'It contains what was asked for (the CPR)',
  credential_policy_results_available: 'Policy results ready',
  wallet_error_response_received: 'Wallet answered with a refusal: the patient declined',
};

function describe(texts, { event, error, error_description }) {
  if (event.endsWith('_failed')) return { text: `${event}: ${error_description ?? error ?? 'failed'}`, ok: false };
  return texts[event] === null ? null : { text: texts[event] ?? event, ok: true };
}

// Connects to a walt.id SSE stream; onEvent then gets each event until the stream ends or signal
// aborts. Resolves once connected, to {done}: a promise for the end (wrapped, as returning it from
// this async function would make the caller wait for the end).
async function followEvents(url, onEvent, signal) {
  const res = await fetch(url, { headers: { Accept: 'text/event-stream' }, signal });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  const done = (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop();
      for (const block of blocks) {
        const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
        try {
          const event = data && JSON.parse(data);
          if (event?.event) onEvent(event);
        } catch {
          // not JSON: skip
        }
      }
    }
  })().catch(() => {}); // aborted or dropped
  return { done };
}

// JSON calls to one walt.id service. Errors name the service, and keep its status as upstreamStatus.
function waltidClient(name, baseUrl) {
  return async function call(path, { method = 'GET', body, token } = {}) {
    let res;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        body: body && JSON.stringify(body),
      });
    } catch {
      throw httpError(502, `walt.id ${name} not reachable at ${baseUrl}. Is it running? docker compose --profile wallet up -d`);
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (!res.ok) {
      const detail = json?.message ?? json?.error ?? (typeof json === 'string' ? json : res.statusText);
      throw Object.assign(httpError(502, `walt.id ${name}: ${res.status} ${detail}`), { upstreamStatus: res.status });
    }
    return json;
  };
}

function verifierChecks(info) {
  const by = 'walt.id verifier';
  const results = info.policy_results ?? {};
  const vc = (results.vc_policies ?? []).map((r) => [r.policy?.id ?? r.policy?.policy, r]);
  const vp = Object.values(results.vp_policies ?? {}).flatMap((perCredential) => Object.entries(perCredential));
  return [...vc, ...vp].map(([id, r]) => ({
    label: POLICY_LABELS[id] ?? r.policy_executed?.description ?? id,
    ok: r.success === true,
    ...(r.errors?.length && { detail: JSON.stringify(r.errors) }),
    by,
  }));
}

// emit: adds to the live log (events.js). signal: aborts when the dev server stops.
export default function waltidMode({ issuer, verifier, wallet, accountPassword, profileId, credentialType }, { emit, signal }) {
  const issuerApi = waltidClient('issuer', issuer);
  const verifierApi = waltidClient('verifier', verifier);
  const walletApi = waltidClient('wallet', wallet);
  const issuerKeys = createRemoteJWKSet(new URL(`${issuer}/openid4vci/jwks`));
  const sessions = new Map(); // handle -> { token, walletId }

  const show = (source, texts) => (event) => {
    const shown = describe(texts, event);
    if (shown) emit(source, shown.text, shown.ok);
  };

  // The issuer's stream covers every issuance; reconnect if it drops (walt.id restarted). On connect
  // it replays past events in one burst, without timestamps: skip what arrives in the first second.
  (async function followIssuer() {
    while (!signal.aborted) {
      try {
        const connectedAt = Date.now();
        const live = show('issuer', ISSUER_EVENTS);
        await (await followEvents(`${issuer}/issuer2/events`, (e) => Date.now() - connectedAt > 1000 && live(e), signal)).done;
      } catch {
        // not reachable yet
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  })();

  // The user's walt.id wallet account; the same login works in the web wallet.
  const account = (user) => `${user.id}@wallet.demo`;

  // Logs in to the user's walt.id account, registering it the first time.
  async function login(user) {
    const body = { email: account(user), password: accountPassword };
    try {
      return (await walletApi('/auth/emailpass', { method: 'POST', body })).token;
    } catch (err) {
      if (err.upstreamStatus !== 404) throw err;
      await walletApi('/auth/register', { method: 'POST', body });
      return (await walletApi('/auth/emailpass', { method: 'POST', body })).token;
    }
  }

  // The account's wallet, created with a key and DID on first use. The key is what the PID is bound to.
  async function openWallet(user) {
    const token = await login(user);
    const [existing] = await walletApi('/auth/account/wallets', { token });
    if (existing) return { token, walletId: existing };
    const { walletId } = await walletApi('/wallet', { method: 'POST', body: {}, token });
    await walletApi(`/wallet/${walletId}/keys/generate`, { method: 'POST', body: { backend: 'jwk', keyType: 'secp256r1' }, token });
    await walletApi(`/wallet/${walletId}/dids/create`, { method: 'POST', body: { method: 'jwk' }, token });
    return { token, walletId };
  }

  function session(handle) {
    const s = sessions.get(handle);
    if (!s) throw httpError(401, 'Unknown wallet session (the dev server restarted?): sign in again');
    return s;
  }

  // Calls to the user's wallet; a 401 there means walt.id restarted and the wallet is gone.
  async function inWallet(handle, path, options = {}) {
    const { token, walletId } = session(handle);
    try {
      return await walletApi(`/wallet/${walletId}${path}`, { ...options, token });
    } catch (err) {
      if (err.upstreamStatus !== 401) throw err;
      sessions.delete(handle);
      throw httpError(401, 'The walt.id wallet was reset: sign in again');
    }
  }

  // Our own trust checks on top of walt.id's policies, whose signature check only uses the
  // certificate inside the credential: the PID must be signed with our issuer's published key, and
  // the disclosed CPR must be one of the digests in it. -> {checks, cpr}, cpr null if not trusted.
  async function ownChecks(presented) {
    const by = 'dev server';
    const [issuerSigned, ...parts] = presented.signedWithDisclosures.split('~');
    let payload;
    try {
      const { credential_issuer: issuerId } = await issuerApi('/.well-known/openid-credential-issuer/openid4vci');
      ({ payload } = await jwtVerify(issuerSigned, issuerKeys, { issuer: issuerId }));
    } catch (err) {
      return { cpr: null, checks: [{ label: "PID signed with our issuer's published key", ok: false, detail: err.message, by }] };
    }
    const disclosure = presented.disclosures?.find((d) => d.name === CPR_CLAIM);
    const signedCpr = !!disclosure && parts.includes(disclosure.encoded) && !!payload._sd?.includes(sha256(disclosure.encoded));
    return {
      cpr: signedCpr ? disclosure.value : null,
      checks: [
        { label: "PID signed with our issuer's published key", ok: true, by },
        { label: 'Disclosed CPR is one of the signed claims (its digest is in _sd)', ok: signedCpr, by },
      ],
    };
  }

  // Shares (or declines) and waits for the verifier's verdict -> {cpr, verification}, or null if declined.
  async function present(handle, { sessionId, requestUrl }, share) {
    if (!share) {
      await inWallet(handle, '/credentials/present/reject', {
        method: 'POST',
        body: { requestUrl, errorCode: 'access_denied', errorDescription: 'The patient declined' },
      });
      return null;
    }
    await inWallet(handle, '/credentials/present', { method: 'POST', body: { requestUrl } });

    // The verifier checks the presentation after receiving it; wait for its verdict.
    let info;
    for (let i = 0; i < 20; i++) {
      info = await verifierApi(`/verification-session/${sessionId}/info`);
      if (info.status === 'SUCCESSFUL' || info.status === 'FAILED') break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const presented = info.presented_credentials?.pid?.[0];
    const own = presented ? await ownChecks(presented) : { cpr: null, checks: [] };
    const verification = {
      sessionId,
      status: info.status,
      checks: [...verifierChecks(info), ...own.checks],
      disclosed: (presented?.disclosures ?? []).map((d) => label(d.name)),
    };
    if (info.status !== 'SUCCESSFUL' || !info.policy_results?.overallSuccess) {
      throw Object.assign(httpError(401, `The verifier rejected the presentation (${info.status})`), { verification });
    }
    if (!own.cpr) throw Object.assign(httpError(401, 'Credential rejected: not from our issuer'), { verification });
    return { cpr: own.cpr, verification };
  }

  return {
    async signIn(user) {
      const { token, walletId } = await openWallet(user);
      const handle = randomUUID();
      sessions.set(handle, { token, walletId });

      // A new sign-in replaces the PID from the last one.
      for (const old of await inWallet(handle, '/credentials')) {
        await inWallet(handle, `/credentials/${old.id}`, { method: 'DELETE' });
      }
      const { credentialOffer } = await issuerApi('/issuer2/credential-offers', {
        method: 'POST',
        body: {
          profileId,
          authMethod: 'PRE_AUTHORIZED',
          runtimeOverrides: { credentialData: { given_name: user.given, family_name: user.family, birth_date: user.birthDate, [CPR_CLAIM]: user.cpr } },
        },
      });
      const { credentialIds } = await inWallet(handle, '/credentials/receive', { method: 'POST', body: { offerUrl: credentialOffer } });
      const { credential } = await inWallet(handle, `/credentials/${credentialIds[0]}`);
      const data = credential.credentialData;
      return {
        handle,
        claims: { name: `${data.given_name} ${data.family_name}`, cpr: data[CPR_CLAIM], issuer: 'Demo MitID issuer (walt.id)', validUntil: data.exp * 1000, account: account(user) },
      };
    },

    // The verifier asks for the CPR only; the wallet previews what it would disclose.
    async startRequest(handle) {
      session(handle);
      const { sessionId, bootstrapAuthorizationRequestUrl: requestUrl } = await verifierApi('/verification-session/create', {
        method: 'POST',
        body: {
          flow_type: 'cross_device',
          core_flow: {
            dcql_query: { credentials: [{ id: 'pid', format: 'dc+sd-jwt', meta: { vct_values: [credentialType] }, claims: [{ path: [CPR_CLAIM] }] }] },
            policies: { vc_policies: [{ policy: 'signature' }] },
          },
        },
      });
      // The verifier's stream is per session: follow it until the request is answered (or for 5 minutes).
      const stream = new AbortController();
      const stopEvents = () => setTimeout(() => stream.abort(), 1500); // let the last events arrive
      setTimeout(() => stream.abort(), 5 * 60 * 1000);
      signal.addEventListener('abort', () => stream.abort());
      await followEvents(`${verifier}/verification-session/${sessionId}/events`, show('verifier', VERIFIER_EVENTS), stream.signal).catch(() => {});

      const preview = await inWallet(handle, '/credentials/present/preview', { method: 'POST', body: { requestUrl } });
      if (!preview.valid) throw httpError(409, `The wallet cannot answer this request: ${preview.error?.message ?? 'no matching credential'}`);
      return {
        verifier: preview.verifier?.name ?? null,
        disclosures: preview.credentialOptions[0].disclosures.map((d) => ({ label: label(d.name), value: d.value })),
        state: { sessionId, requestUrl, stopEvents },
      };
    },

    async answer(handle, { sessionId, requestUrl, stopEvents }, share) {
      try {
        return await present(handle, { sessionId, requestUrl }, share);
      } finally {
        stopEvents();
      }
    },
  };
}
