// Step 1. The wallet: sign in with the demo MitID issuer to get an identity credential,
// then present it to a source to get your own record.
import { useEffect, useState } from 'react';
import { SOURCES, TEST_USERS } from '../lib/config.js';
import { loadCredential, readClaims, saveCredential, signIn, tamper } from '../lib/identity.js';
import { readBundleFile, requestRecord } from '../lib/sources.js';
import { Button, Card, Field, Status, inputClass, runStep } from './ui.jsx';

export default function WalletPanel({ record, onRecord }) {
  const [userId, setUserId] = useState(TEST_USERS[0].id);
  const [credential, setCredential] = useState(loadCredential);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => saveCredential(credential), [credential]);

  const claims = credential && readClaims(credential);
  const expired = claims && claims.exp * 1000 < Date.now();

  const login = () => runStep(setMessage, setBusy, 'Signing in with MitID…', async () => {
    setCredential(await signIn(userId));
    setMessage({ text: 'Identity credential added to the wallet.', kind: 'ok' });
  });

  const done = (bundle, origin) => {
    setMessage({ text: `Added ${bundle.entry.length} records from ${origin} to the wallet.`, kind: 'ok' });
    onRecord(bundle);
  };

  const fetchFrom = (source) => runStep(setMessage, setBusy, `Presenting your credential to ${source.label}…`, async () => {
    done(await requestRecord({ sourceId: source.id, credential }), source.label);
  });

  // Shows the verifier at work: the same credential, edited to someone else's CPR, must be refused.
  const tryForged = () => runStep(setMessage, setBusy, 'Presenting a forged credential…', async () => {
    const other = TEST_USERS.find((u) => u.cpr !== claims.sub);
    try {
      await requestRecord({ sourceId: SOURCES[0].id, credential: tamper(credential, other.cpr) });
    } catch (err) {
      setMessage({ text: `Asked for ${other.name}'s record with an edited credential. Refused as it should be: ${err.message}`, kind: 'ok' });
      return;
    }
    throw new Error(`The source returned ${other.name}'s record for a forged credential.`);
  });

  const loadFile = (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (file) runStep(setMessage, setBusy, `Reading ${file.name}…`, async () => done(await readBundleFile(file), file.name));
  };

  const signOut = () => {
    setCredential(null);
    setMessage(null);
    onRecord(null);
  };

  return (
    <Card step="1" title="My wallet" actions={credential && <Button onClick={signOut}>Sign out</Button>}>
      {!credential ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="MitID test user">
            <select className={inputClass} value={userId} onChange={(e) => setUserId(e.target.value)} disabled={busy}>
              {TEST_USERS.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.login})</option>)}
            </select>
          </Field>
          <Button primary disabled={busy} onClick={login}>Sign in with MitID</Button>
          <p className="w-full text-xs text-slate-500">Demo issuer in the dev server, not real MitID: it signs an identity credential for the test user you pick.</p>
        </div>
      ) : (
        <>
          <h3 className="mb-2 text-sm font-medium text-slate-600">Identity credential</h3>
          <div className="flex flex-wrap gap-x-8 gap-y-1 rounded-md bg-slate-50 px-3 py-2 text-sm">
            <span><span className="text-slate-500">Name</span> {claims.name}</span>
            <span><span className="text-slate-500">CPR</span> <code className="text-xs">{claims.sub}</code></span>
            <span><span className="text-slate-500">Issued by</span> Demo MitID issuer</span>
            <span className={expired ? 'text-red-700' : ''}>
              <span className="text-slate-500">Valid until</span> {new Date(claims.exp * 1000).toLocaleTimeString()}
              {expired && ' (expired: sign out and in again)'}
            </span>
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-slate-600">Raw credential (JWT)</summary>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-100 p-3 text-xs">{credential}</pre>
            <Button className="mt-2" disabled={busy} onClick={tryForged}>Try a forged credential</Button>
          </details>

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
