// Which patients a server holds, and what each one's record contains.
// Served at /patients.html by `npm run dev`; reads the servers through the same proxy as the main page.
// On servers with allowDelete in config.yml a patient can be deleted, to run the demo again.
import { useEffect, useState } from 'react';
import { SERVERS, SYSTEM_LABELS } from '../lib/config.js';
import RecordView from '../components/RecordView.jsx';
import { Button, Card, Field, Json, Status, inputClass, runStep } from '../components/ui.jsx';

const FHIR_JSON = { Accept: 'application/fhir+json' };

// All entries of a search, following paging links through baseUrl (HAPI writes absolute links).
async function fetchAll(baseUrl, path, headers = {}) {
  const entries = [];
  let next = `${baseUrl}/${path}`;
  while (next) {
    const res = await fetch(next, { headers: { ...FHIR_JSON, ...headers } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${next}`);
    const page = await res.json();
    entries.push(...(page.entry ?? []));
    next = page.link?.find((l) => l.relation === 'next')?.url?.replace(/^https?:\/\/[^/]+\/fhir/, baseUrl);
  }
  return entries;
}

// Shared resources other patients may point at stay; deleting them would make the transaction fail.
const SHARED = ['Practitioner', 'PractitionerRole', 'Organization', 'Location', 'Medication'];

// Deletes the patient and everything in their record in one transaction. Returns the number of resources deleted.
async function deletePatient(baseUrl, id) {
  const entry = (await fetchAll(baseUrl, `Patient/${id}/$everything?_count=200`))
    .filter((e) => !SHARED.includes(e.resource.resourceType))
    .map((e) => ({ request: { method: 'DELETE', url: `${e.resource.resourceType}/${e.resource.id}` } }));
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/fhir+json', ...FHIR_JSON },
    body: JSON.stringify({ resourceType: 'Bundle', type: 'transaction', entry }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const issues = body?.issue?.map((i) => i.diagnostics).filter(Boolean).join('; ');
    throw new Error(`${res.status} ${res.statusText}${issues ? `: ${issues}` : ''}`);
  }
  return entry.length;
}

const name = (p) => p.name?.map((n) => [...(n.given ?? []), n.family].join(' ')).join(', ') || '(no name)';
// One line per address: street, postcode and city, country.
const addresses = (p) => (p.address ?? []).map((a) => a.text
  ?? [...(a.line ?? []), [a.postalCode, a.city].filter(Boolean).join(' '), a.country].filter(Boolean).join(', '));

function PatientRow({ patient, server, onDeleted }) {
  const baseUrl = server.url;
  const [record, setRecord] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const remove = (e) => {
    e.stopPropagation();
    if (!confirming) return setConfirming(true);
    setConfirming(false);
    setOpen(true);
    runStep(setMessage, setBusy, `Deleting ${name(patient)}…`, async () => {
      const n = await deletePatient(baseUrl, patient.id);
      onDeleted(`Deleted ${name(patient)} (${n} resources) from ${server.label}.`);
    });
  };

  // One resource of the record; HAPI refuses it while other resources still point at it.
  const removeResource = (r) => runStep(setMessage, setBusy, `Deleting ${r.resourceType}/${r.id}…`, async () => {
    const res = await fetch(`${baseUrl}/${r.resourceType}/${r.id}`, { method: 'DELETE', headers: FHIR_JSON });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const issues = body?.issue?.map((i) => i.diagnostics).filter(Boolean).join('; ');
      throw new Error(`${res.status} ${res.statusText}${issues ? `: ${issues}` : ''}`);
    }
    setRecord((cur) => ({ ...cur, entry: cur.entry.filter((e) => e.resource !== r) }));
    setMessage({ text: `Deleted ${r.resourceType}/${r.id}.`, kind: 'ok' });
  });

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
          {addresses(patient).map((a) => <div key={a}>{a}</div>)}
          {(patient.telecom ?? []).map((t) => <div key={`${t.system}|${t.value}`} className="text-slate-500">{t.value}</div>)}
        </td>
        <td className="px-2 py-1.5">
          {(patient.identifier ?? []).map((i) => (
            <div key={`${i.system}|${i.value}`}>
              <span className="text-slate-500">{SYSTEM_LABELS[i.system] ?? i.system}</span> <code className="text-xs">{i.value}</code>
            </div>
          ))}
        </td>
        <td className="px-2 py-1.5"><code className="text-xs text-slate-500">{patient.id}</code></td>
        <td className="px-2 py-1.5 text-slate-500">{patient.meta?.lastUpdated?.slice(0, 10)}</td>
        <td className="w-64 whitespace-nowrap px-2 py-1.5 text-right">
          {server.allowDelete && (
            <span className="inline-flex gap-1">
              <Button danger={confirming} disabled={busy} onClick={remove}>
                {confirming ? 'Delete everything?' : 'Delete'}
              </Button>
              {confirming && <Button onClick={(e) => { e.stopPropagation(); setConfirming(false); }}>Cancel</Button>}
            </span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={8} className="px-4 py-3">
            {/* w-0 min-w-full: the record fills the row without widening the table (long raw FHIR lines scroll inside). */}
            <div className="w-0 min-w-full">
              <Status message={message} />
              {record && (
                <>
                  <p className="mb-3 text-sm text-slate-600">
                    {counts.length ? counts.map(([t, n]) => `${n} ${t}`).join(' · ') : 'Only the Patient resource, nothing else.'}
                  </p>
                  <RecordView bundle={record} busy={busy} onDelete={server.allowDelete ? removeResource : undefined} />
                  <Json value={record} />
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function DashboardApp() {
  const [serverId, setServerId] = useState(SERVERS[0].id);
  const [patients, setPatients] = useState(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const server = SERVERS.find((s) => s.id === serverId);

  // done: what happened before the reload, e.g. a deletion, shown in front of the count.
  const load = (done = '') => runStep(setMessage, setBusy, `Reading patients from ${server.label}…`, async () => {
    setPatients(null);
    // no-cache: HAPI otherwise may answer from its search cache, still listing a deleted patient.
    const entries = await fetchAll(server.url, 'Patient?_count=200', { 'Cache-Control': 'no-cache' });
    setPatients(entries.map((e) => e.resource));
    setMessage({ text: `${done ? `${done} ` : ''}${entries.length} patient${entries.length === 1 ? '' : 's'} on ${server.label}.`, kind: 'ok' });
  });

  useEffect(() => { load(); }, [serverId]); // eslint-disable-line react-hooks/exhaustive-deps

  const needle = filter.trim().toLowerCase();
  const shown = (patients ?? []).filter((p) => !needle
    || name(p).toLowerCase().includes(needle)
    || (p.identifier ?? []).some((i) => i.value?.includes(needle)));

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-slate-500">
          Click a patient to see their record.
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
            <Button className="self-end" onClick={() => load()} disabled={busy}>Reload</Button>
          </>
        )}
      >
        <Status message={message} />
        {patients && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  {['Name', 'Born', 'Sex', 'Lives at', 'Identifiers', 'Server id', 'Updated', ''].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => <PatientRow key={`${serverId}/${p.id}`} patient={p} server={server} onDeleted={load} />)}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
