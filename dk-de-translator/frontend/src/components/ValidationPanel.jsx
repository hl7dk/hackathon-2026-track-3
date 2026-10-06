// Step 3, below My data: $validate output for the version shown there.
import { useState } from 'react';
import { SERVERS } from '../lib/config.js';
import { describe } from '../lib/display.js';
import { validateBundle } from '../lib/validate.js';
import { Button, Card, Status, inputClass, runStep } from './ui.jsx';

const SEVERITIES = ['fatal', 'error', 'warning', 'information'];
const BADGE = {
  fatal: 'bg-red-100 text-red-800',
  error: 'bg-red-100 text-red-800',
  warning: 'bg-amber-100 text-amber-800',
  information: 'bg-slate-100 text-slate-700',
};

function Badge({ severity, children }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${BADGE[severity]}`}>{children}</span>;
}

const count = (issues, severity) => issues.filter((i) => i.severity === severity).length;

function ResourceResult({ result, shown }) {
  const issues = result.issues.filter((i) => shown.includes(i.severity));
  const errors = count(result.issues, 'error') + count(result.issues, 'fatal');
  return (
    <details open={errors > 0} className="rounded-md border border-slate-200">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <span className="font-medium">{describe(result.resource)}</span>
        {errors === 0 && <Badge severity="information">no errors</Badge>}
        {SEVERITIES.filter((s) => count(result.issues, s)).map((s) => (
          <Badge key={s} severity={s}>{count(result.issues, s)} {s}</Badge>
        ))}
      </summary>
      <div className="border-t border-slate-200 px-3 py-2">
        <p className="mb-2 break-all text-xs text-slate-500">Profile: {result.profile ?? 'base FHIR'}</p>
        {issues.length === 0 && <p className="text-sm text-slate-500">Nothing to show for the selected severities.</p>}
        <ul className="space-y-2">
          {issues.map((issue, i) => (
            <li key={i} className="text-sm">
              <Badge severity={issue.severity}>{issue.severity}</Badge>{' '}
              {issue.expression?.[0] && <code className="text-xs text-slate-500">{issue.expression[0]}</code>}
              <div className="mt-0.5 break-words">{issue.diagnostics ?? issue.details?.text}</div>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export default function ValidationPanel({ bundle, versionLabel, serverId, setServerId }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [results, setResults] = useState(null);
  const [shown, setShown] = useState(['fatal', 'error', 'warning']);
  const server = SERVERS.find((s) => s.id === serverId);

  const run = () => runStep(setMessage, setBusy, 'Validating…', async () => {
    const out = await validateBundle(bundle, server, (i, n) => setMessage({ text: `Validating ${i} of ${n}…` }));
    setResults({ out, versionLabel, server: server.label });
    const all = out.flatMap((r) => r.issues);
    const errors = count(all, 'error') + count(all, 'fatal');
    setMessage({ text: `${versionLabel} data against ${server.label}: ${errors} errors, ${count(all, 'warning')} warnings.`, kind: errors ? 'err' : 'ok' });
  });

  const toggle = (s) => setShown((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <Card
      step="3"
      title="Validation"
      actions={(
        <>
          <select className={inputClass} value={serverId} onChange={(e) => setServerId(e.target.value)} aria-label="Validate against">
            {SERVERS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <Button primary disabled={busy || !bundle} onClick={run}>Validate</Button>
        </>
      )}
    >
      <p className="text-sm text-slate-500">
        Checks the <strong>{versionLabel.toLowerCase()}</strong> data with <code className="text-xs">$validate</code> on the chosen server.
        On a German server each resource is checked as if it claimed that server's German profile.
      </p>
      <Status message={message} />

      {results && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-slate-500">Show:</span>
            {SEVERITIES.map((s) => (
              <label key={s} className="flex items-center gap-1">
                <input type="checkbox" checked={shown.includes(s)} onChange={() => toggle(s)} /> {s}
              </label>
            ))}
          </div>
          {(results.versionLabel !== versionLabel || results.server !== server.label) && (
            <p className="mt-2 text-sm text-amber-700">These results are for the {results.versionLabel.toLowerCase()} data against {results.server}. Validate again to update.</p>
          )}
          <div className="mt-3 space-y-2">
            {results.out.map((r, i) => <ResourceResult key={i} result={r} shown={shown} />)}
          </div>
        </>
      )}
    </Card>
  );
}
