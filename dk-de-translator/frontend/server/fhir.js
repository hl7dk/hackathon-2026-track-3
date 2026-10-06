// Reading a patient's record from a source server, once a verifier has established who they are.
import { httpError } from './errors.js';

async function getJson(url, headers) {
  const res = await fetch(url, { headers: { Accept: 'application/fhir+json', ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
  return res.json();
}

// Patient by CPR on the real server (upstream), then Patient/$everything, following paging links.
export async function fetchRecord({ upstream, headers, cprSystem, cpr }) {
  const search = await getJson(`${upstream}/Patient?identifier=${encodeURIComponent(`${cprSystem}|${cpr}`)}`, headers);
  const patient = search.entry?.[0]?.resource;
  if (!patient) throw httpError(404, `No patient with CPR ${cpr} on this server`);

  const entries = [];
  let next = `${upstream}/Patient/${patient.id}/$everything?_count=200`;
  while (next) {
    const page = await getJson(next, headers);
    entries.push(...(page.entry ?? []));
    next = page.link?.find((l) => l.relation === 'next')?.url;
  }
  return { resourceType: 'Bundle', type: 'collection', entry: entries };
}
