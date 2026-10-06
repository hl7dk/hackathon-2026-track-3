// The translator: StructureMap/$transform on Matchbox (transform in config.yml) with the target's map
// (map under targets), written in FML in ../../../maps/. The maps set the German profiles, fix the
// structure and put a German coding (through the ConceptMaps) in front of every Danish one, which stays.
import { TRANSFORM } from './config.js';

// report: one row per Danish coding, with the German coding the map put next to it (null if none).
export async function convert(bundle, target) {
  const params = new URLSearchParams({ source: target.map });
  const res = await fetch(`${TRANSFORM.url}/StructureMap/$transform?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/fhir+json', Accept: 'application/fhir+json' },
    body: JSON.stringify(bundle),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.resourceType !== 'Bundle') {
    const issues = body?.issue?.map((i) => i.diagnostics).filter(Boolean).join('; ');
    throw new Error(`$transform with ${target.map} failed: ${res.status} ${res.statusText}${issues ? `: ${issues}` : ''}`);
  }
  const report = [];
  for (const e of body.entry ?? []) {
    for (const concept of codeableConcepts(e.resource)) {
      for (const from of concept.coding.filter((c) => TRANSFORM.systems[c.system])) {
        const to = concept.coding.find((c) => c.system === TRANSFORM.systems[from.system] && c.code) ?? null;
        report.push({ resource: e.resource, from, to });
      }
    }
  }
  return { bundle: body, translated: true, target, report };
}

// Every CodeableConcept in a resource, at any depth (contained resources included).
function codeableConcepts(node, found = []) {
  if (Array.isArray(node)) node.forEach((n) => codeableConcepts(n, found));
  else if (node && typeof node === 'object') {
    if (Array.isArray(node.coding)) found.push(node);
    Object.values(node).forEach((v) => codeableConcepts(v, found));
  }
  return found;
}
