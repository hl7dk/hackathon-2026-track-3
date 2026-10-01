// Step 2: the record in the wallet, and once converted, what would be sent.
import RecordView from './RecordView.jsx';
import { Card, Json } from './ui.jsx';

function Tabs({ view, setView, hasConverted }) {
  const tab = (id, label, disabled) => (
    <button
      key={id}
      disabled={disabled}
      onClick={() => setView(id)}
      className={`border-b-2 px-3 py-1.5 text-sm disabled:opacity-40 ${view === id ? 'border-blue-700 font-medium text-blue-700' : 'border-transparent text-slate-600'}`}
    >
      {label}
    </button>
  );
  return (
    <div className="mb-4 flex border-b border-slate-200">
      {tab('original', 'In my wallet')}
      {tab('converted', 'Converted', !hasConverted)}
    </div>
  );
}

export default function DataPanel({ bundle, view, setView, hasConverted }) {
  return (
    <Card step="2" title="My data">
      <Tabs view={view} setView={setView} hasConverted={hasConverted} />
      <RecordView bundle={bundle} />
      <Json value={bundle} />
    </Card>
  );
}
