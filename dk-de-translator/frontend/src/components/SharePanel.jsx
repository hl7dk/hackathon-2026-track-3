// Step 4. Choose who gets what (the consent), then convert (step 5 checks and sends).
// Only the resource types the patient ticked are converted and sent.
import { useState } from 'react';
import { PURPOSES, SCOPES, TARGETS } from '../lib/config.js';
import { convert } from '../lib/convert.js';
import { filterByScopes } from '../lib/sources.js';
import { Button, Card, Field, Status, inputClass, runStep } from './ui.jsx';

export default function SharePanel({ record, onConverted, targetId, setTargetId }) {
  const [scopes, setScopes] = useState(SCOPES.map((s) => s.type));
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [consent, setConsent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const target = TARGETS.find((t) => t.id === targetId);

  // Any change to the choices withdraws the consent given for the old ones.
  const reset = () => {
    setConsent(null);
    onConverted(null);
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
    const source = filterByScopes(record, scopes);
    const result = await convert(source, target);
    onConverted({ ...result, source });
    const unmapped = result.report.filter((r) => !r.to).map((r) => `${r.from.code}`);
    setMessage(unmapped.length
      ? { text: `Converted for ${target.label}: ${result.report.length - unmapped.length} codes translated, no mapping for ${unmapped.join(', ')}.` }
      : { text: `Converted for ${target.label}: ${result.report.length} codes translated. Check the result below.`, kind: 'ok' });
  });

  const scopeLabel = (type) => SCOPES.find((s) => s.type === type)?.label ?? type;

  return (
    <Card step="4" title="Share">
      <div className="rounded-md border border-slate-200 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">Consent</div>
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
        <Button primary disabled={busy || !consent} onClick={doConvert}>Convert for {target.label}</Button>
      </div>
      <Status message={message} />
    </Card>
  );
}
