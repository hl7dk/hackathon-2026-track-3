// The wallet session: a handle to the identity credential, plus its claims for showing.
// With wallet.mode demo the handle is the credential itself (a JWT the browser holds); with
// waltid it points at a walt.id wallet on the server. Either way the browser only presents it.

async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `${res.status} ${res.statusText} from ${url}`);
  return json;
}

// Demo MitID login for a test user from config.yml: returns {handle, claims}.
export function signIn(userId) {
  return postJson('/wallet/sign-in', { userId });
}

// Kept in sessionStorage so the session survives a reload, but not closing the tab.
// Storage can be blocked (private mode, site settings); the wallet then just forgets on reload.
const STORAGE_KEY = 'wallet.session';

export function loadSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    return session?.handle && session?.claims ? session : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not stored: the session still works until the page is reloaded.
  }
}

const decodePart = (part) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
const encodePart = (obj) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Demo mode only: the same credential with another CPR but the original signature,
// as someone editing a stolen or their own credential would make. The verifier must reject it.
export function tamper(credential, cpr) {
  const [header, payload, signature] = credential.split('.');
  return [header, encodePart({ ...decodePart(payload), sub: cpr }), signature].join('.');
}
