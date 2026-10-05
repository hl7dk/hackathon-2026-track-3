// Which patients a server holds, and what each one's record contains.
// Served at /patients.html by `npm run dev`; reads the servers through the same proxy as the main page.
import { useEffect, useState } from 'react';
import { SERVERS, SYSTEM_LABELS } from '../lib/config.js';
import RecordView from '../components/RecordView.jsx';
import { Button, Card, Field, Json, Status, inputClass, runStep } from '../components/ui.jsx';

const FHIR_JSON = { Accept: 'application/fhir+json' };

// All entries of a search, following paging links through baseUrl (HAPI writes absolute links).
async function fetchAll(baseUrl, path) {
  const entries = [];
  let next = `${baseUrl}/${path}`;
  while (next) {
    const res = await fetch(next, { headers: FHIR_JSON });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${next}`);
    const page = await res.json();
    entries.push(...(page.entry ?? []));
    next = page.link?.find((l) => l.relation === 'next')?.url?.replace(/^https?:\/\/[^/]+\/fhir/, baseUrl);
  }
  return entries;
}

const name = (p) => p.name?.map((n) => [...(n.given ?? []), n.family].join(' ')).join(', ') || '(no name)';

function PatientRow({ patient, baseUrl }) {
  const [record, setRecord] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const toggle = () => {
    setOpen(!open);
    if (record || open) return;
    runStep(setMessage, setBusy, 'Loading record…', async () => {
      const entry = await fetchAll(baseUrl, `Patient/${patient.id}/$everything?_count=200`);
      setRecord({ resourceType: 'Bundle', type: 'collection', entry });
      setMessage(null);
    });
  };

  const counts = record && Object.entries(
    record.entry.reduce((acc, e) => ({ ...acc, [e.resource.resourceType]: (acc[e.resource.resourceType] ?? 0) + 1 }), {}),
  ).filter(([type]) => type !== 'Patient');

  return (
    <>
      <tr className="cursor-pointer border-b border-slate-100 align-top hover:bg-slate-50" onClick={toggle}>
        <td className="px-2 py-1.5">{open ? '▾' : '▸'} {name(patient)}</td>
        <td className="px-2 py-1.5">{patient.birthDate}</td>
        <td className="px-2 py-1.5">{patient.gender}</td>
        <td className="px-2 py-1.5">
          {(patient.identifier ?? []).map((i) => (
            <div key={`${i.system}|${i.value}`}>
              <span className="text-slate-500">{SYSTEM_LABELS[i.system] ?? i.system}</span> <code className="text-xs">{i.value}</code>
            </div>
          ))}
        </td>
        <td className="px-2 py-1.5"><code className="text-xs text-slate-500">{patient.id}</code></td>
        <td className="px-2 py-1.5 text-slate-500">{patient.meta?.lastUpdated?.slice(0, 10)}</td>
      </tr>
      {open && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={6} className="px-4 py-3">
            <Status message={message} />
            {record && (
              <>
                <p className="mb-3 text-sm text-slate-600">
                  {counts.length ? counts.map(([t, n]) => `${n} ${t}`).join(' · ') : 'Only the Patient resource, nothing else.'}
                </p>
                <RecordView bundle={record} />
                <Json value={record} />
              </>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function PatientsApp() {
  const [serverId, setServerId] = useState(SERVERS[0].id);
  const [patients, setPatients] = useState(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const server = SERVERS.find((s) => s.id === serverId);

  const load = () => runStep(setMessage, setBusy, `Reading patients from ${server.label}…`, async () => {
    setPatients(null);
    const entries = await fetchAll(server.url, 'Patient?_count=200');
    setPatients(entries.map((e) => e.resource));
    setMessage({ text: `${entries.length} patient${entries.length === 1 ? '' : 's'} on ${server.label}.`, kind: 'ok' });
  });

  useEffect(() => { load(); }, [serverId]); // eslint-disable-line react-hooks/exhaustive-deps

  const needle = filter.trim().toLowerCase();
  const shown = (patients ?? []).filter((p) => !needle
    || name(p).toLowerCase().includes(needle)
    || (p.identifier ?? []).some((i) => i.value?.includes(needle)));

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">Patients on the servers</h1>
        <p className="text-slate-500">
          Who is on each server. Click a patient to see their record. <a className="text-blue-700 underline" href="/">Back to the translator</a>
        </p>
      </header>

      <Card
        title="Patients"
        actions={(
          <>
            <Field label="Server">
              <select className={inputClass} value={serverId} onChange={(e) => setServerId(e.target.value)} disabled={busy}>
                {SERVERS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Filter">
              <input className={inputClass} placeholder="Name or identifier" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </Field>
            <Button className="self-end" onClick={load} disabled={busy}>Reload</Button>
          </>
        )}
      >
        <Status message={message} />
        {patients && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  {['Name', 'Born', 'Sex', 'Identifiers', 'Server id', 'Updated'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => <PatientRow key={`${serverId}/${p.id}`} patient={p} baseUrl={server.url} />)}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
