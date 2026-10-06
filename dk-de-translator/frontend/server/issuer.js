// Demo identity issuer: stands in for MitID. It signs an identity credential (a JWT)
// for a test user. The private key lives only in the dev server and is new on every
// start, so restarting `npm run dev` makes every credential issued before it invalid.
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

export const ISSUER = 'urn:dk-de-translator:demo-mitid-issuer';
export const CREDENTIAL_TYPE = 'urn:dk-de-translator:identity';
const ALG = 'ES256';

const { privateKey, publicKey } = await generateKeyPair(ALG);

// What a verifier needs to check credentials from this issuer.
export const issuerKey = { publicKey, alg: ALG, jwk: { ...(await exportJWK(publicKey)), alg: ALG, use: 'sig' } };

// user: one of testUsers in config.yml. The CPR is the subject: it is what the credential proves.
export function issueCredential(user, ttlMinutes) {
  return new SignJWT({ vct: CREDENTIAL_TYPE, name: user.name, login: user.login })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setIssuer(ISSUER)
    .setSubject(user.cpr)
    .setIssuedAt()
    .setExpirationTime(`${ttlMinutes}m`)
    .sign(privateKey);
}
