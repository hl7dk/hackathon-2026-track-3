// Turning FHIR resources into table rows. Cells are plain strings, or arrays of
// [label, code] pairs for codings and identifiers.
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
    row: (r) => [
      text(r.medicationCodeableConcept) ?? r.medicationReference?.display,
      codes(r.medicationCodeableConcept), r.dosage?.map((d) => d.text).join('; '), r.status,
    ],
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
