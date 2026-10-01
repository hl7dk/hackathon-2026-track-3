// Step 1. Stand-in for the wallet: sign-in is a button, and records are read
// straight from the source server with no token.
import { useState } from 'react';
import { DEFAULT_PATIENT, SOURCES } from '../lib/config.js';
import { readBundleFile, requestRecord } from '../lib/sources.js';
import { Button, Card, Status, runStep } from './ui.jsx';

export default function WalletPanel({ record, onRecord }) {
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const done = (bundle, origin) => {
    setMessage({ text: `Added ${bundle.entry.length} records from ${origin} to the wallet.`, kind: 'ok' });
    onRecord(bundle);
  };

  const fetchFrom = (source) => runStep(setMessage, setBusy, `Getting your records from ${source.label}…`, async () => {
    done(await requestRecord({ baseUrl: source.url, cpr: DEFAULT_PATIENT.cpr }), source.label);
  });

  const loadFile = (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (file) runStep(setMessage, setBusy, `Reading ${file.name}…`, async () => done(await readBundleFile(file), file.name));
  };

  const signOut = () => {
    setSignedIn(false);
    setMessage(null);
    onRecord(null);
  };

  return (
    <Card step="1" title="My wallet" placeholder actions={signedIn && <Button onClick={signOut}>Sign out</Button>}>
      <p className="mb-4 text-sm text-amber-800">
        Stands in for the wallet and consent flow from the consent group. Every button just works: there is no real login, token or consent check.
      </p>

      {!signedIn ? (
        <Button primary onClick={() => setSignedIn(true)}>Sign in with MitID</Button>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-8 gap-y-1 rounded-md bg-slate-50 px-3 py-2 text-sm">
            <span><span className="text-slate-500">Signed in as</span> {DEFAULT_PATIENT.name}</span>
            <span><span className="text-slate-500">CPR</span> <code className="text-xs">{DEFAULT_PATIENT.cpr}</code></span>
            <span className="text-slate-500">{DEFAULT_PATIENT.login}</span>
          </div>

          <h3 className="mt-4 mb-2 text-sm font-medium text-slate-600">Connected sources</h3>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {SOURCES.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="font-medium">{s.label}</span>
                <code className="text-xs text-slate-500">{s.url}</code>
                <Button primary className="ml-auto" disabled={busy} onClick={() => fetchFrom(s)}>Get my records</Button>
              </li>
            ))}
            <li className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <span className="font-medium">A file I already have</span>
              <label className={`ml-auto cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
                Add file
                <input type="file" accept=".json,application/fhir+json" className="hidden" onChange={loadFile} />
              </label>
            </li>
          </ul>
          {record && !message && <p className="mt-3 text-sm text-slate-600">{record.entry.length} records in the wallet.</p>}
        </>
      )}
      <Status message={message} />
    </Card>
  );
}
