// Getting the record into the wallet. requestRecord() is the seam for the consent /
// wallet group: today there is no login or token, it reads the source server directly.
import { CPR_SYSTEM } from './config.js';

const FHIR_JSON = { Accept: 'application/fhir+json' };

async function getJson(url) {
  const res = await fetch(url, { headers: FHIR_JSON });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
  return res.json();
}

// Patient by CPR, then Patient/$everything, following paging links.
export async function requestRecord({ baseUrl, cpr }) {
  const search = await getJson(`${baseUrl}/Patient?identifier=${encodeURIComponent(`${CPR_SYSTEM}|${cpr}`)}`);
  const patient = search.entry?.[0]?.resource;
  if (!patient) throw new Error(`No patient with CPR ${cpr} on ${baseUrl}`);

  const entries = [];
  let next = `${baseUrl}/Patient/${patient.id}/$everything?_count=200`;
  while (next) {
    const page = await getJson(next);
    entries.push(...(page.entry ?? []));
    // HAPI writes absolute paging links; keep going through baseUrl (it may be a proxy path).
    next = page.link?.find((l) => l.relation === 'next')?.url?.replace(/^https?:\/\/[^/]+\/fhir/, baseUrl);
  }
  return { resourceType: 'Bundle', type: 'collection', entry: entries };
}

// A bundle the patient already has, e.g. downloaded from sundhed.dk.
export async function readBundleFile(file) {
  const json = JSON.parse(await file.text());
  return json.resourceType === 'Bundle' ? json : { resourceType: 'Bundle', type: 'collection', entry: [{ resource: json }] };
}

// Keep only the resource types the patient chose to share.
export function filterByScopes(bundle, scopes) {
  const allowed = new Set(scopes);
  return { ...bundle, entry: (bundle.entry ?? []).filter((e) => allowed.has(e.resource?.resourceType)) };
}
