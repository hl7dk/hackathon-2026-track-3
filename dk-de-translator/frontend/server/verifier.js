// Verifier in front of a source server: it only hands out a record to the patient the
// presented credential is about. The CPR comes from the verified credential, never from
// the request, so asking for someone else's record means forging the issuer's signature.
import { jwtVerify } from 'jose';
import { CREDENTIAL_TYPE, ISSUER, issuerKey } from './issuer.js';

// Throws when the token is not signed by our issuer, has expired, or is not an identity credential.
export async function verifyCredential(token) {
  const { payload } = await jwtVerify(token, issuerKey.publicKey, { issuer: ISSUER, algorithms: [issuerKey.alg] });
  if (payload.vct !== CREDENTIAL_TYPE || !payload.sub) throw new Error('Not an identity credential');
  return payload;
}

async function getJson(url, headers) {
  const res = await fetch(url, { headers: { Accept: 'application/fhir+json', ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
  return res.json();
}

// Patient by CPR on the real server (upstream), then Patient/$everything, following paging links.
export async function fetchRecord({ upstream, headers, cprSystem, cpr }) {
  const search = await getJson(`${upstream}/Patient?identifier=${encodeURIComponent(`${cprSystem}|${cpr}`)}`, headers);
  const patient = search.entry?.[0]?.resource;
  if (!patient) throw Object.assign(new Error(`No patient with CPR ${cpr} on this server`), { status: 404 });

  const entries = [];
  let next = `${upstream}/Patient/${patient.id}/$everything?_count=200`;
  while (next) {
    const page = await getJson(next, headers);
    entries.push(...(page.entry ?? []));
    next = page.link?.find((l) => l.relation === 'next')?.url;
  }
  return { resourceType: 'Bundle', type: 'collection', entry: entries };
}
