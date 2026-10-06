// wallet.mode demo: our own issuer and verifier, no extra services. The issuer signs a JWT with
// the CPR as subject; the browser holds it (the handle is the credential itself) and the verifier
// checks it. The key is new on every start of the dev server, which invalidates older credentials.
import { SignJWT, decodeJwt, generateKeyPair, jwtVerify } from 'jose';
import { httpError } from './errors.js';

const ISSUER = 'urn:dk-de-translator:demo-mitid-issuer';
const CREDENTIAL_TYPE = 'urn:dk-de-translator:identity';
const ALG = 'ES256';
const { privateKey, publicKey } = await generateKeyPair(ALG);

export default function demoMode({ ttlMinutes }) {
  return {
    async signIn(user) {
      const name = `${user.given} ${user.family}`;
      const credential = await new SignJWT({ vct: CREDENTIAL_TYPE, name, login: user.login })
        .setProtectedHeader({ alg: ALG, typ: 'JWT' })
        .setIssuer(ISSUER)
        .setSubject(user.cpr)
        .setIssuedAt()
        .setExpirationTime(`${ttlMinutes}m`)
        .sign(privateKey);
      return { handle: credential, claims: { name, cpr: user.cpr, issuer: 'Demo MitID issuer', validUntil: decodeJwt(credential).exp * 1000 } };
    },

    // What the wallet would share. Read without verifying: this is the wallet looking at its own credential.
    async startRequest(handle) {
      try {
        return { verifier: null, disclosures: [{ label: 'CPR number', value: decodeJwt(handle).sub }], state: null };
      } catch {
        throw httpError(401, 'The wallet holds no readable credential: sign in again');
      }
    },

    // The CPR comes from the verified credential, never from the request.
    async answer(handle, state, share) {
      if (!share) return null;
      const check = { label: 'Signed by the demo issuer, not expired, an identity credential (jose jwtVerify)', by: 'dev server' };
      const disclosed = ['CPR (sub)', 'Name', 'MitID login']; // a plain JWT has no selective disclosure
      try {
        const { payload } = await jwtVerify(handle, publicKey, { issuer: ISSUER, algorithms: [ALG] });
        if (payload.vct !== CREDENTIAL_TYPE || !payload.sub) throw new Error('not an identity credential');
        return { cpr: payload.sub, verification: { status: 'SUCCESSFUL', checks: [{ ...check, ok: true }], disclosed } };
      } catch (err) {
        const verification = { status: 'FAILED', checks: [{ ...check, ok: false, detail: err.message }], disclosed };
        throw Object.assign(httpError(401, `Credential rejected: ${err.message}`), { verification });
      }
    },
  };
}
