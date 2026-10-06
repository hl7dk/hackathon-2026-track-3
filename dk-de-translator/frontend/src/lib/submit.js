// Sending the record: turn whatever bundle we have into a transaction and POST it.
import { CPR_SYSTEM } from './config.js';

// Ids on the receiver, derived from the Danish resource (its server id, or the urn:uuid of a file's
// entry), so sending again replaces what an earlier send created instead of adding a copy.
const PREFIX = 'dk-';

function stableId(entry) {
  const own = entry.resource.id ?? entry.fullUrl?.match(/^urn:uuid:(.+)$/)?.[1];
  if (!own) return crypto.randomUUID();
  const id = `${PREFIX}${own}`.replace(/[^A-Za-z0-9\-.]/g, '-');
  // FHIR ids are at most 64 characters.
  return id.length <= 64 ? id : `${PREFIX}${hash(id)}`;
}

function hash(s) {
  let h = 0x811c9dc5;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return h.toString(16);
}

// Every resource is PUT under its stable id, and references are rewritten to match. The Patient is the
// exception: it is created only if the receiver has no one with her CPR (the German GP may already know
// her), and otherwise the record attaches to the Patient it has, which keeps its German details.
export function toTransaction(bundle) {
  const newRef = new Map();
  const ids = new Map();
  for (const e of bundle.entry ?? []) {
    const r = e.resource;
    const ref = r.resourceType === 'Patient' ? `urn:uuid:${crypto.randomUUID()}` : `${r.resourceType}/${stableId(e)}`;
    ids.set(e, ref);
    if (e.fullUrl) newRef.set(e.fullUrl, ref);
    if (r.id) newRef.set(`${r.resourceType}/${r.id}`, ref);
  }

  const entry = (bundle.entry ?? []).map((e) => {
    const resource = rewriteReferences(structuredClone(e.resource), newRef);
    const ref = ids.get(e);
    if (resource.meta) {
      delete resource.meta.versionId;
      delete resource.meta.lastUpdated;
      delete resource.meta.source;
    }
    if (resource.resourceType !== 'Patient') {
      resource.id = ref.split('/')[1];
      return { resource, request: { method: 'PUT', url: ref } };
    }
    delete resource.id;
    const request = { method: 'POST', url: 'Patient' };
    const cpr = resource.identifier?.find((i) => i.system === CPR_SYSTEM);
    if (cpr) request.ifNoneExist = `identifier=${CPR_SYSTEM}|${cpr.value}`;
    return { fullUrl: ref, resource, request };
  });

  return { resourceType: 'Bundle', type: 'transaction', entry };
}

function rewriteReferences(node, newRef) {
  if (Array.isArray(node)) return node.map((n) => rewriteReferences(n, newRef));
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'reference' && typeof v === 'string') {
        // Absolute references from $everything, e.g. http://localhost:28080/fhir/Patient/1
        const relative = v.match(/([A-Za-z]+\/[^/]+)$/)?.[1];
        node[k] = newRef.get(v) ?? newRef.get(relative) ?? v;
      } else {
        node[k] = rewriteReferences(v, newRef);
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
