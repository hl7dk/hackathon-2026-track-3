// Step 1. The wallet: sign in with the demo MitID issuer to get an identity credential, then
// let a source see the part of it it asks for (the CPR) to get your own record.
import { useState } from 'react';
import { SOURCES, TEST_USERS, WALLET } from '../lib/config.js';
import { signIn, tamper } from '../lib/identity.js';
import { answerRequest, readBundleFile, requestRecord } from '../lib/sources.js';
import { Button, Card, Field, Status, inputClass, runStep } from './ui.jsx';
import VerificationReport from './VerificationReport.jsx';

const IS_DEMO = WALLET.mode === 'demo';

// session and onSession: the wallet session, kept by App (the log needs it too).
export default function WalletPanel({ session, onSession, record, onRecord }) {
  const [userId, setUserId] = useState(TEST_USERS[0].id);
  const [request, setRequest] = useState(null); // a source's open request: {source, requestId, verifier, disclosures}
  const [report, setReport] = useState(null); // what the verifier checked on the last share: {verifier, verification}
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const claims = session?.claims;
  const expired = claims && claims.validUntil < Date.now();

  const login = () => runStep(setMessage, setBusy, 'Signing in with MitID…', async () => {
    onSession(await signIn(userId));
    setMessage({ text: 'Identity credential added to the wallet.', kind: 'ok' });
  });

  const done = (bundle, origin) => {
    setMessage({ text: `Added ${bundle.entry.length} records from ${origin} to the wallet.`, kind: 'ok' });
    onRecord(bundle);
  };

  const askFrom = (source) => runStep(setMessage, setBusy, `Connecting to ${source.label}…`, async () => {
    setReport(null);
    setRequest({ source, ...(await requestRecord({ sourceId: source.id, handle: session.handle })) });
    setMessage(null);
  });

  // Answers a request, keeping what the verifier checked for the report (also when it refuses).
  const answerAndReport = async ({ requestId, verifier }, handle, share) => {
    try {
      const shared = await answerRequest({ requestId, handle, share });
      if (shared) setReport({ verifier, verification: shared.verification });
      return shared;
    } catch (err) {
      if (err.verification) setReport({ verifier, verification: err.verification });
      throw err;
    }
  };

  const answer = (share) => runStep(setMessage, setBusy, share ? `Sharing with ${request.verifier}…` : 'Declining…', async () => {
    setRequest(null);
    const shared = await answerAndReport(request, session.handle, share);
    if (shared) done(shared.record, request.source.label);
    else setMessage({ text: `You declined. ${request.source.label} got nothing.` });
  });

  // Demo mode: the same credential, edited to someone else's CPR, must be refused by the verifier.
  const tryForged = () => runStep(setMessage, setBusy, 'Presenting a forged credential…', async () => {
    const other = TEST_USERS.find((u) => u.cpr !== claims.cpr);
    const forged = tamper(session.handle, other.cpr);
    setReport(null);
    try {
      await answerAndReport(await requestRecord({ sourceId: SOURCES[0].id, handle: forged }), forged, true);
    } catch (err) {
      setMessage({ text: `Asked for ${other.given}'s record with an edited credential. Refused as it should be: ${err.message}`, kind: 'ok' });
      return;
    }
    throw new Error(`The source returned ${other.given}'s record for a forged credential.`);
  });

  const loadFile = (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (file) runStep(setMessage, setBusy, `Reading ${file.name}…`, async () => done(await readBundleFile(file), file.name));
  };

  const signOut = () => {
    onSession(null);
    setRequest(null);
    setReport(null);
    setMessage(null);
    onRecord(null);
  };

  return (
    <Card
      step="1"
      title="My wallet"
      actions={session && (
        <>
          {!IS_DEMO && <Button onClick={() => window.open(WALLET.waltid.webWallet, '_blank', 'noopener')}>Open my wallet</Button>}
          <Button onClick={signOut}>Sign out</Button>
        </>
      )}
    >
      {!session ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="MitID test user">
            <select className={inputClass} value={userId} onChange={(e) => setUserId(e.target.value)} disabled={busy}>
              {TEST_USERS.map((u) => <option key={u.id} value={u.id}>{u.given} {u.family} ({u.login})</option>)}
            </select>
          </Field>
          <Button primary disabled={busy} onClick={login}>Sign in with MitID</Button>
          <p className="w-full text-xs text-slate-500">
            Demo issuer, not real MitID: it issues an identity credential for the test user you pick
            {IS_DEMO ? ' (a JWT signed by the dev server).' : ' (an EUDI PID as SD-JWT VC, via walt.id over OpenID4VCI).'}
          </p>
        </div>
      ) : (
        <>
          <h3 className="mb-2 text-sm font-medium text-slate-600">Identity credential</h3>
          <div className="flex flex-wrap gap-x-8 gap-y-1 rounded-md bg-slate-50 px-3 py-2 text-sm">
            <span><span className="text-slate-500">Name</span> {claims.name}</span>
            <span><span className="text-slate-500">CPR</span> <code className="text-xs">{claims.cpr}</code></span>
            <span><span className="text-slate-500">Issued by</span> {claims.issuer}</span>
            <span className={expired ? 'text-red-700' : ''}>
              <span className="text-slate-500">Valid until</span> {new Date(claims.validUntil).toLocaleString()}
              {expired && ' (expired: sign out and in again)'}
            </span>
          </div>
          {claims.account && (
            <p className="mt-2 text-xs text-slate-500">
              Held in your walt.id wallet. To look inside, "Open my wallet" and log in as <code>{claims.account}</code> with
              password <code>{WALLET.waltid.accountPassword}</code>.
            </p>
          )}
          {IS_DEMO && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-slate-600">Raw credential (JWT)</summary>
              <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-100 p-3 text-xs">{session.handle}</pre>
              <Button className="mt-2" disabled={busy} onClick={tryForged}>Try a forged credential</Button>
            </details>
          )}

          <h3 className="mt-4 mb-2 text-sm font-medium text-slate-600">Connected sources</h3>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {SOURCES.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="font-medium">{s.label}</span>
                <code className="text-xs text-slate-500">{s.url}</code>
                <Button primary className="ml-auto" disabled={busy || !!request} onClick={() => askFrom(s)}>Get my records</Button>
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

          {request && (
            <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-3 text-sm">
              <p><strong>{request.verifier}</strong> asks to see from your identity credential:</p>
              <ul className="my-2 list-disc pl-5">
                {request.disclosures.map((d) => (
                  <li key={d.label}>{d.label}: <code className="text-xs">{d.value}</code></li>
                ))}
              </ul>
              <p className="mb-3 text-slate-600">Nothing else from the credential is shared. In return you get your record from {request.source.label}.</p>
              <div className="flex gap-2">
                <Button primary disabled={busy} onClick={() => answer(true)}>Share</Button>
                <Button disabled={busy} onClick={() => answer(false)}>Decline</Button>
              </div>
            </div>
          )}
          {record && !message && !request && <p className="mt-3 text-sm text-slate-600">{record.entry.length} records in the wallet.</p>}
        </>
      )}
      <Status message={message} />
      {report && <VerificationReport {...report} />}
    </Card>
  );
}
