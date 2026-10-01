// Sending the record: turn whatever bundle we have into a transaction and POST it.
import { CPR_SYSTEM } from './config.js';

// Server ids from the source mean nothing on the target, so every resource gets a
// urn:uuid fullUrl and references are rewritten to point at those.
export function toTransaction(bundle) {
  const newUrl = new Map();
  for (const e of bundle.entry ?? []) {
    const r = e.resource;
    const url = e.fullUrl?.startsWith('urn:uuid:') ? e.fullUrl : `urn:uuid:${crypto.randomUUID()}`;
    if (e.fullUrl) newUrl.set(e.fullUrl, url);
    if (r.id) newUrl.set(`${r.resourceType}/${r.id}`, url);
  }

  const entry = (bundle.entry ?? []).map((e) => {
    const resource = rewriteReferences(structuredClone(e.resource), newUrl);
    delete resource.id;
    if (resource.meta) {
      delete resource.meta.versionId;
      delete resource.meta.lastUpdated;
      delete resource.meta.source;
    }
    const request = { method: 'POST', url: resource.resourceType };
    // Do not create Anne twice when the same record is sent again.
    const cpr = resource.resourceType === 'Patient' && resource.identifier?.find((i) => i.system === CPR_SYSTEM);
    if (cpr) request.ifNoneExist = `identifier=${CPR_SYSTEM}|${cpr.value}`;
    return { fullUrl: newUrl.get(e.fullUrl) ?? newUrl.get(`${e.resource.resourceType}/${e.resource.id}`), resource, request };
  });

  return { resourceType: 'Bundle', type: 'transaction', entry };
}

function rewriteReferences(node, newUrl) {
  if (Array.isArray(node)) return node.map((n) => rewriteReferences(n, newUrl));
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'reference' && typeof v === 'string') {
        // Absolute references from $everything, e.g. http://localhost:28080/fhir/Patient/1
        const relative = v.match(/([A-Za-z]+\/[^/]+)$/)?.[1];
        node[k] = newUrl.get(v) ?? newUrl.get(relative) ?? v;
      } else {
        node[k] = rewriteReferences(v, newUrl);
      }
    }
  }
  return node;
}

export async function submit(bundle, baseUrl) {
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/fhir+json', Accept: 'application/fhir+json' },
    body: JSON.stringify(toTransaction(bundle)),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const issues = body?.issue?.map((i) => i.diagnostics).filter(Boolean).join('; ');
    throw new Error(`${res.status} ${res.statusText}${issues ? `: ${issues}` : ''}`);
  }
  return body;
}
