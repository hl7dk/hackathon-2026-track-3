// The wallet's identity credential: a JWT signed by the demo MitID issuer (server/issuer.js).
// The wallet only stores and presents it; checking the signature is the verifier's job.

async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `${res.status} ${res.statusText} from ${url}`);
  return json;
}

// Demo MitID login: returns the signed credential for a test user from config.yml.
export async function signIn(userId) {
  return (await postJson('/issuer/credential', { userId })).credential;
}

const decodePart = (part) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
const encodePart = (obj) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Kept in sessionStorage so the credential survives a reload, but not closing the tab.
// Storage can be blocked (private mode, site settings); the wallet then just forgets on reload.
const STORAGE_KEY = 'wallet.credential';

export function loadCredential() {
  try {
    const credential = sessionStorage.getItem(STORAGE_KEY);
    if (credential) readClaims(credential); // throws on anything that is not a JWT
    return credential;
  } catch {
    return null;
  }
}

export function saveCredential(credential) {
  try {
    if (credential) sessionStorage.setItem(STORAGE_KEY, credential);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not stored: the credential still works until the page is reloaded.
  }
}

// The claims, for showing them in the wallet. Decoding is not verifying: anyone can read a JWT.
export function readClaims(credential) {
  return decodePart(credential.split('.')[1]);
}

// For the demo: the same credential with another CPR but the original signature,
// as someone editing a stolen or their own credential would make. The verifier must reject it.
export function tamper(credential, cpr) {
  const [header, payload, signature] = credential.split('.');
  return [header, encodePart({ ...decodePart(payload), sub: cpr }), signature].join('.');
}
