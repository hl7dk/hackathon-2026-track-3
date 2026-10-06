// Getting the record into the wallet. requestRecord() is the seam for the consent /
// wallet group: the wallet presents its identity credential to the source's verifier
// (server/verifier.js), which returns the record of the patient the credential is about.

export async function requestRecord({ sourceId, credential }) {
  const res = await fetch(`/verifier/record?source=${encodeURIComponent(sourceId)}`, {
    headers: { Accept: 'application/fhir+json', Authorization: `Bearer ${credential}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `${res.status} ${res.statusText}`);
  return json;
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
