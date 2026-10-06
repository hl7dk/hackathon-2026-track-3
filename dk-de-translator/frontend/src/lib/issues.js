// Sorting the receiver's validation errors into who closes them: the map (gone after the transform),
// the patient (they know the answer, e.g. when a diagnosis was made) or the receiver (only it can
// assign it, e.g. its own patient number). Matched on the validator's message, so only errors are used.

// Errors the patient can close: question, input type, and how the answer goes into the resource.
// partialDate: a FHIR date as precise as the patient remembers it, 2019, 2019-03 or 2019-03-14.
const ASK = [
  {
    match: /Condition\.recordedDate: minimum required/,
    question: 'When was this diagnosis made?',
    input: 'partialDate',
    apply: (r, v) => { r.recordedDate = v; },
  },
  {
    match: /MedicationStatement\.effective\[x\]: minimum required/,
    question: 'Since when have you been taking this?',
    input: 'partialDate',
    apply: (r, v) => { r.effectivePeriod = { start: v }; },
  },
];

// Errors only the receiver can close.
const RECEIVER = [
  { match: /Patient\.identifier:Patientennummer/, note: 'The hospital assigns its own patient number (Patientennummer) on admission.' },
  { match: /isik-con1/, note: 'The hospital links each diagnosis to its own encounter (Fall) when it documents it.' },
  // The receiver's server has no SNOMED CT (licensed per country, the German edition from BfArM), so it cannot
  // check a SNOMED code against a value set. The codes are the ones the German profiles ask for.
  {
    match: /snomed\.info\/sct.*(is ignored\/not-present|could not be found|Failed to expand)|(is ignored\/not-present|could not be found|Failed to expand).*snomed\.info\/sct/s,
    note: "The receiver's server has no SNOMED CT loaded, so it cannot check SNOMED codes against its value sets. The code is the one the German profile asks for; a real receiver has a SNOMED CT terminology server.",
  },
];

const PARTIAL_DATE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;
// Well formed and not in the future (compared as text, which works for all three precisions).
export const validPartialDate = (v) => PARTIAL_DATE.test(v) && v <= new Date().toISOString().slice(0, v.length);

export const isError = (i) => i.severity === 'error' || i.severity === 'fatal';
export const message = (i) => i.diagnostics ?? i.details?.text ?? '';
const key = (i) => `${i.expression?.[0] ?? ''}|${message(i)}`;

// before, after: validateBundle results for the Danish record and the converted one, entry by entry
// (the maps keep the order). answered: Map from `${index}|${issue key}` to the value the patient gave.
export function classify(before, after, answered = new Map()) {
  const fixedByMap = [];
  const ask = [];
  const receiver = [];
  const other = [];
  after.forEach((result, index) => {
    const now = result.issues.filter(isError);
    const nowKeys = new Set(now.map(key));
    for (const issue of before[index]?.issues.filter(isError) ?? []) {
      // An error the patient answered is theirs, not the map's.
      if (!nowKeys.has(key(issue)) && !answered.has(`${index}|${key(issue)}`)) fixedByMap.push({ index, resource: result.resource, issue });
    }
    for (const issue of now) {
      const id = `${index}|${key(issue)}`;
      const a = ASK.find((f) => f.match.test(message(issue)));
      const r = RECEIVER.find((f) => f.match.test(message(issue)));
      if (a) ask.push({ id, index, resource: result.resource, issue, ...a });
      else if (r) receiver.push({ index, resource: result.resource, issue, note: r.note });
      else other.push({ index, resource: result.resource, issue });
    }
  });
  const fixedByPatient = [...answered.entries()]
    .filter(([id]) => !ask.some((a) => a.id === id))
    .map(([id, value]) => {
      const index = Number(id.split('|')[0]);
      return { id, index, resource: after[index]?.resource, value, question: ASK.find((f) => f.match.test(id))?.question };
    });
  return { fixedByMap, ask, fixedByPatient, receiver, other };
}
