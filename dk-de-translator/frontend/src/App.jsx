import { useEffect, useState } from 'react';
import { loadSession, saveSession } from './lib/identity.js';
import { SOURCES, TARGETS } from './lib/config.js';
import DataPanel from './components/DataPanel.jsx';
import EventLog from './components/EventLog.jsx';
import FixPanel from './components/FixPanel.jsx';
import SharePanel from './components/SharePanel.jsx';
import ValidationPanel from './components/ValidationPanel.jsx';
import WalletPanel from './components/WalletPanel.jsx';

export default function App() {
  const [session, setSession] = useState(loadSession); // the wallet session: {handle, claims, since}
  const [record, setRecord] = useState(null);
  // conversion: the convert() result plus its input (source); converted: its bundle, with the patient's answers added.
  const [conversion, setConversion] = useState(null);
  const [converted, setConverted] = useState(null);
  const [view, setView] = useState('original');
  const [targetId, setTargetId] = useState(TARGETS[0].id);
  const [validateOn, setValidateOn] = useState(SOURCES[0].id);

  useEffect(() => {
    saveSession(session);
  }, [session]);

  const onRecord = (bundle) => {
    setRecord(bundle);
    setConversion(null);
    setConverted(null);
    setView('original');
    setValidateOn(SOURCES[0].id);
  };

  // Validate where the shown version belongs: the source for the original, the receiver once converted.
  const changeView = (v) => {
    setView(v);
    setValidateOn(v === 'converted' ? targetId : SOURCES[0].id);
  };

  const onConverted = (result) => {
    setConversion(result);
    setConverted(result?.bundle ?? null);
    changeView(result ? 'converted' : 'original');
  };

  const showConverted = view === 'converted' && converted;
  const shown = showConverted ? converted : record;

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">My health data</h1>
        <p className="text-slate-500">
          Get your record into your wallet, check it, and share it with a German provider. <a className="text-blue-700 underline" href="/patients.html">Dashboard</a>
        </p>
      </header>

      <div className="rounded-md border border-dashed border-amber-400 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        <strong>Draft prototype.</strong> Sign-in uses a demo MitID issuer, not real MitID, and the wallet runs on the server. Consent to share with a German provider is a placeholder: nothing is enforced.
        The DK → DE translation runs the FHIR maps on Matchbox.
      </div>

      <div className={`grid items-start gap-4 ${session ? 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : ''}`}>
        <WalletPanel session={session} onSession={setSession} record={record} onRecord={onRecord} />
        {session && <EventLog since={session.since ?? 0} />}
      </div>

      {record && (
        <>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <DataPanel bundle={shown} view={view} setView={changeView} hasConverted={!!converted} />
            <ValidationPanel
              bundle={shown}
              versionLabel={showConverted ? 'Converted' : 'Original'}
              serverId={validateOn}
              setServerId={setValidateOn}
            />
          </div>
          <SharePanel
            record={record}
            onConverted={onConverted}
            targetId={targetId}
            setTargetId={setTargetId}
          />
          {conversion && <FixPanel conversion={conversion} converted={converted} setConverted={setConverted} />}
        </>
      )}
    </div>
  );
}
