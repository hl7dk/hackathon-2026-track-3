// Step 5. What the receiver's validator says about the record, before and after the map: what the map
// fixed, what the patient is asked to fill in, what only the receiver can fill in. Then send.
import { useEffect, useState } from 'react';
import { SYSTEM_LABELS } from '../lib/config.js';
import { describe } from '../lib/display.js';
import { classify, isError, message as issueText, validPartialDate } from '../lib/issues.js';
import { submit } from '../lib/submit.js';
import { validateBundle } from '../lib/validate.js';
import { Button, Card, Status, inputClass, runStep } from './ui.jsx';

const label = (system) => SYSTEM_LABELS[system] ?? system;
const coding = (c) => `${label(c.system)} ${c.code}`;
// The validator's message without the "(from <profile>)" tail.
const short = (issue) => issueText(issue).replace(/\s*\(from [^)]*\)\.?/, '').replace(/\s*\(defined in [^)]*\)/, '');

// Issues on the same kind of resource (e.g. every blood pressure) and with the same note as one line: how
// many resources, then each distinct message once, with how often it came up, folded away.
function groupIssues(items) {
  const groups = new Map();
  for (const it of items) {
    const label = describe(it.resource);
    const key = `${label}|${it.note ?? ''}`;
    if (!groups.has(key)) groups.set(key, { key, label, note: it.note, resources: new Set(), messages: new Map() });
    const g = groups.get(key);
    g.resources.add(it.index);
    // Without the parts that differ per resource, e.g. 'Observation/172504'.
    const m = short(it.issue).replace(/'[A-Za-z]+\/[^']+'/g, "'…'");
    g.messages.set(m, (g.messages.get(m) ?? 0) + 1);
  }
  return [...groups.values()];
}

// summary(group): what the line says after the resource, e.g. how many kinds of error were fixed.
function GroupedIssues({ items, mark, summary }) {
  return groupIssues(items).map((g) => (
    <li key={g.key}>
      <details>
        <summary className="cursor-pointer">
          {mark} {g.label}{g.resources.size > 1 && ` ×${g.resources.size}`}: {summary(g)}
        </summary>
        <ul className="ml-5 mt-1 list-disc space-y-0.5 break-words text-xs text-slate-600">
          {[...g.messages].map(([m, n]) => <li key={m}>{m}{n > 1 && ` (×${n})`}</li>)}
        </ul>
      </details>
    </li>
  ));
}

const kinds = (g) => `${g.messages.size} kind${g.messages.size === 1 ? '' : 's'} of error`;

function Section({ tone, title, count, children }) {
  const color = {
    ok: 'border-green-300 bg-green-50',
    ask: 'border-amber-300 bg-amber-50',
    receiver: 'border-slate-300 bg-slate-50',
    err: 'border-red-300 bg-red-50',
  }[tone];
  return (
    <section className={`rounded-md border p-3 ${color}`}>
      <h3 className="mb-2 text-sm font-semibold">{title} <span className="font-normal text-slate-500">({count})</span></h3>
      <ul className="space-y-1.5 text-sm">{children}</ul>
    </section>
  );
}

function Question({ item, busy, onAnswer }) {
  const [value, setValue] = useState('');
  const valid = validPartialDate(value);
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="min-w-56 flex-1">
        <strong>{describe(item.resource)}</strong>: {item.question}
        <span className="block text-xs text-slate-500">{short(item.issue)}</span>
      </span>
      <input
        className={`${inputClass} w-44`}
        placeholder="2019, 2019-03 or 2019-03-14"
        value={value}
        onChange={(e) => setValue(e.target.value.trim())}
        aria-invalid={!!value && !valid}
      />
      <Button primary disabled={busy || !valid} onClick={() => onAnswer(item, value)}>Add</Button>
      {value && !valid && <span className="w-full text-right text-xs text-red-700">A year, year-month or full date, not in the future.</span>}
    </li>
  );
}

export default function FixPanel({ conversion, converted, setConverted }) {
  const { source, report, target } = conversion;
  const [before, setBefore] = useState(null);
  const [after, setAfter] = useState(null);
  const [answered, setAnswered] = useState(new Map());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [sent, setSent] = useState(null);

  // A new conversion: validate the Danish record and the converted one against the receiver.
  useEffect(() => {
    setBefore(null);
    setAfter(null);
    setAnswered(new Map());
    setSent(null);
    runStep(setMessage, setBusy, 'Checking…', async () => {
      const progress = (what) => (i, n) => setMessage({ text: `Validating the ${what} record against ${target.label}: ${i} of ${n}…` });
      setBefore(await validateBundle(source, target, progress('Danish')));
      setAfter(await validateBundle(conversion.bundle, target, progress('converted')));
      setMessage(null);
    });
  }, [conversion]); // eslint-disable-line react-hooks/exhaustive-deps

  // The patient's answer goes into the converted resource, which is then validated again.
  const answer = (item, value) => runStep(setMessage, setBusy, 'Checking your answer…', async () => {
    const bundle = structuredClone(converted);
    item.apply(bundle.entry[item.index].resource, value);
    const [result] = await validateBundle({ entry: [bundle.entry[item.index]] }, target);
    setConverted(bundle);
    setAfter((cur) => cur.map((r, i) => (i === item.index ? result : r)));
    setAnswered((cur) => new Map(cur).set(item.id, value));
    setMessage(null);
  });

  const doSend = () => runStep(setMessage, setBusy, `Sending to ${target.label}…`, async () => {
    const response = await submit(converted, target.url);
    setSent(response.entry ?? []);
    setMessage({ text: `Sent ${converted.entry.length} records to ${target.url}.`, kind: 'ok' });
  });

  const c = before && after && classify(before, after, answered);
  const errorsBefore = before?.flatMap((r) => r.issues).filter(isError).length;
  const errorsNow = after?.flatMap((r) => r.issues).filter(isError).length;
  const translated = report.filter((r) => r.to);
  const unmapped = report.filter((r) => !r.to);

  return (
    <Card step="5" title={`Check and complete for ${target.label}`}>
      <p className="text-sm text-slate-500">
        The receiver's validator (<code className="text-xs">$validate</code> on {target.label}, against its German profiles) on your Danish record and on the translated one.
      </p>
      <Status message={message} />

      {c && (
        <>
          <p className="mt-3 text-sm">
            Errors: <strong>{errorsBefore}</strong> on the Danish record, <strong>{errorsNow}</strong> now
            {errorsNow > 0 && <>: <strong>{c.ask.length}</strong> for you, <strong>{c.receiver.length}</strong> for {target.label}, <strong>{c.other.length}</strong> not solved</>}.
            {' '}{translated.length} codes translated.
          </p>
          <div className="mt-3 space-y-3">
            <Section tone="ok" title="Translated by the map" count={translated.length + c.fixedByMap.length}>
              {translated.map((r, i) => (
                <li key={`t${i}`}>✓ {describe(r.resource)}: <code className="text-xs">{coding(r.from)}</code> → <code className="text-xs">{coding(r.to)}</code></li>
              ))}
              <GroupedIssues items={c.fixedByMap} mark="✓" summary={(g) => `${kinds(g)} fixed`} />
            </Section>

            {c.ask.length > 0 && (
              <Section tone="ask" title="Only you know this" count={c.ask.length}>
                {c.ask.map((item) => <Question key={item.id} item={item} busy={busy} onAnswer={answer} />)}
              </Section>
            )}

            {c.fixedByPatient.length > 0 && (
              <Section tone="ok" title="Added by you" count={c.fixedByPatient.length}>
                {c.fixedByPatient.map((f) => <li key={f.id}>✓ {describe(f.resource)}: {f.question} <strong>{f.value}</strong></li>)}
              </Section>
            )}

            {c.receiver.length > 0 && (
              <Section tone="receiver" title={`Left to ${target.label}`} count={c.receiver.length}>
                <GroupedIssues items={c.receiver} mark="→" summary={(g) => g.note} />
              </Section>
            )}

            {(c.other.length > 0 || unmapped.length > 0) && (
              <Section tone="err" title="Not solved" count={c.other.length + unmapped.length}>
                {unmapped.map((r, i) => <li key={`u${i}`}>✗ {describe(r.resource)}: no mapping for <code className="text-xs">{coding(r.from)}</code></li>)}
                <GroupedIssues items={c.other} mark="✗" summary={kinds} />
              </Section>
            )}
          </div>
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button primary disabled={busy || !c} onClick={doSend}>Send to {target.label}</Button>
        {c?.ask.length > 0 && <span className="text-sm text-amber-800">{c.ask.length} question{c.ask.length === 1 ? '' : 's'} still open.</span>}
      </div>
      {sent && (
        <ul className="mt-2 space-y-0.5 text-sm">
          {sent.map((e, i) => <li key={i}><code className="text-xs">{e.response?.status}</code> {e.response?.location}</li>)}
        </ul>
      )}
    </Card>
  );
}
