// Getting the record into the wallet, in two steps (the seam for the consent / wallet group):
// the source's verifier asks the wallet for the patient's CPR, the patient sees what would be
// shared and answers. If they share and the verifier accepts the credential, the source returns
// the record of the patient the credential is about (server/walletPlugin.js).

async function postJson(url, handle, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${handle}` },
    body: body && JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  // A refusal can carry what the verifier checked (verification), to show what failed.
  if (!res.ok) throw Object.assign(new Error(json.error ?? `${res.status} ${res.statusText}`), { verification: json.verification });
  return json;
}

// -> {requestId, verifier, disclosures: [{label, value}]}
export function requestRecord({ sourceId, handle }) {
  return postJson(`/verifier/requests?source=${encodeURIComponent(sourceId)}`, handle);
}

// -> {record, verification} if shared (record is a Bundle), null if declined.
export async function answerRequest({ requestId, handle, share }) {
  const { shared, record, verification } = await postJson(`/verifier/requests/${encodeURIComponent(requestId)}/response`, handle, { share });
  return shared ? { record, verification } : null;
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
