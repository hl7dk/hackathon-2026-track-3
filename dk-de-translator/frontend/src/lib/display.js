// Turning FHIR resources into table rows. Cells are plain strings, or arrays of
// [label, code] pairs for codings and identifiers. row(r, resolve) gets a resolver
// for references to other resources in the same bundle (see resolver below).
import { SYSTEM_LABELS } from './config.js';

const label = (system) => SYSTEM_LABELS[system] ?? system;
const codes = (cc) => (cc?.coding ?? []).map((c) => [label(c.system), c.code]);
const text = (cc) => cc?.text ?? cc?.coding?.[0]?.display;
const quantity = (q) => q && `${q.value} ${q.unit ?? q.code ?? ''}`.trim();

function value(r) {
  return quantity(r.valueQuantity) ?? r.valueString ?? text(r.valueCodeableConcept)
    ?? r.component?.map((c) => `${text(c.code) ?? ''} ${quantity(c.valueQuantity) ?? ''}`.trim()).join(', ');
}

export const SECTIONS = [
  {
    type: 'Patient', title: 'Personal details', head: ['Name', 'Born', 'Sex', 'Identifiers'],
    row: (r) => [
      r.name?.map((n) => [...(n.given ?? []), n.family].join(' ')).join(', '),
      r.birthDate, r.gender, (r.identifier ?? []).map((i) => [label(i.system), i.value]),
    ],
  },
  {
    type: 'Condition', title: 'Diagnoses', head: ['Diagnosis', 'Code', 'Status', 'Since'],
    row: (r) => [text(r.code), codes(r.code), r.clinicalStatus?.coding?.[0]?.code, r.onsetDateTime ?? r.recordedDate],
  },
  {
    type: 'MedicationStatement', title: 'Medication', head: ['Medicine', 'Code', 'Dose', 'Status'],
    // German records put the codes (PZN, ATC) on a separate Medication resource, or a contained one.
    row: (r, resolve) => {
      const contained = r.contained?.find((c) => `#${c.id}` === r.medicationReference?.reference);
      const code = r.medicationCodeableConcept ?? contained?.code ?? resolve?.(r, r.medicationReference)?.code;
      return [
        text(code) ?? r.medicationReference?.display,
        codes(code), r.dosage?.map((d) => d.text).join('; '), r.status,
      ];
    },
  },
  {
    type: 'AllergyIntolerance', title: 'Allergies', head: ['Substance', 'Code', 'Criticality', 'Recorded'],
    row: (r) => [text(r.code), codes(r.code), r.criticality, r.recordedDate],
  },
  {
    type: 'Observation', title: 'Measurements', head: ['What', 'Value', 'When'],
    row: (r) => [text(r.code), value(r), r.effectiveDateTime ?? r.effectivePeriod?.start],
  },
];

// One line naming a resource, used in the validation list.
export function describe(r) {
  const section = SECTIONS.find((s) => s.type === r.resourceType);
  const first = section?.row(r)[0];
  return typeof first === 'string' && first ? `${r.resourceType}: ${first}` : r.resourceType;
}

// Looks up a Reference in the bundle: contained (#id), by fullUrl (urn:uuid from a
// file) or by Type/id (from a server, where fullUrl is absolute).
export function resolver(bundle) {
  const byRef = new Map();
  for (const { fullUrl, resource } of bundle.entry ?? []) {
    if (!resource) continue;
    if (fullUrl) byRef.set(fullUrl, resource);
    if (resource.id) byRef.set(`${resource.resourceType}/${resource.id}`, resource);
  }
  return (from, ref) => {
    const r = ref?.reference;
    if (!r) return undefined;
    if (r.startsWith('#')) return from.contained?.find((c) => c.id === r.slice(1));
    return byRef.get(r) ?? byRef.get(r.match(/([A-Za-z]+\/[^/]+)$/)?.[1]);
  };
}
