// Step 4. Choose who gets what (the consent, a placeholder), then convert and send.
// Only the resource types the patient ticked are converted and sent.
import { useState } from 'react';
import { PURPOSES, SCOPES, TARGETS } from '../lib/config.js';
import { convert } from '../lib/convert.js';
import { filterByScopes } from '../lib/sources.js';
import { submit } from '../lib/submit.js';
import { Button, Card, Field, PlaceholderBadge, Status, inputClass, runStep } from './ui.jsx';

export default function SharePanel({ record, converted, onConverted, targetId, setTargetId }) {
  const [scopes, setScopes] = useState(SCOPES.map((s) => s.type));
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [consent, setConsent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [sent, setSent] = useState(null);
  const target = TARGETS.find((t) => t.id === targetId);

  // Any change to the choices withdraws the consent given for the old ones.
  const reset = () => {
    setConsent(null);
    onConverted(null);
    setSent(null);
    setMessage(null);
  };
  const toggle = (type) => {
    setScopes((cur) => (cur.includes(type) ? cur.filter((t) => t !== type) : [...cur, type]));
    reset();
  };

  const grant = () => {
    setConsent({ receiver: target.label, purpose, scopes, at: new Date().toLocaleString() });
    setMessage(null);
  };

  const doConvert = () => runStep(setMessage, setBusy, 'Converting…', async () => {
    const result = await convert(filterByScopes(record, scopes), target);
    onConverted(result.bundle);
    setSent(null);
    setMessage(result.translated
      ? { text: `Converted for ${target.label}.`, kind: 'ok' }
      : { text: 'Translator not connected yet: the data is passed on unchanged. See the Converted tab.' });
  });

  const doSend = () => runStep(setMessage, setBusy, `Sending to ${target.label}…`, async () => {
    const response = await submit(converted, target.url);
    setSent(response.entry ?? []);
    setMessage({ text: `Sent ${converted.entry.length} records to ${target.url}.`, kind: 'ok' });
  });

  const scopeLabel = (type) => SCOPES.find((s) => s.type === type)?.label ?? type;

  return (
    <Card step="4" title="Share">
      <div className="rounded-md border-2 border-dashed border-amber-400 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">Consent <PlaceholderBadge /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Share with">
            <select className={inputClass} value={targetId} onChange={(e) => { setTargetId(e.target.value); reset(); }}>
              {TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Purpose">
            <select className={inputClass} value={purpose} onChange={(e) => { setPurpose(e.target.value); reset(); }}>
              {PURPOSES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <span className="text-slate-600">What to share:</span>
          {SCOPES.map((s) => (
            <label key={s.type} className="flex items-center gap-1.5">
              <input type="checkbox" checked={scopes.includes(s.type)} disabled={s.type === 'Patient'} onChange={() => toggle(s.type)} />
              {s.label}
            </label>
          ))}
        </div>

        {consent ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
            <span>
              Consent given {consent.at}: <strong>{consent.scopes.map(scopeLabel).join(', ')}</strong> to <strong>{consent.receiver}</strong> for “{consent.purpose}”.
            </span>
            <Button className="ml-auto" onClick={reset}>Withdraw</Button>
          </div>
        ) : (
          <Button primary className="mt-4" onClick={grant}>Give consent</Button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button disabled={busy || !consent} onClick={doConvert}>Convert</Button>
        <Button primary disabled={busy || !converted} onClick={doSend}>Send to {target.label}</Button>
      </div>
      <Status message={message} />
      {sent && (
        <ul className="mt-2 space-y-0.5 text-sm">
          {sent.map((e, i) => <li key={i}><code className="text-xs">{e.response?.status}</code> {e.response?.location}</li>)}
        </ul>
      )}
    </Card>
  );
}
