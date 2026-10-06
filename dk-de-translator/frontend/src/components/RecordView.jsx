// A bundle as one table per resource type.
// onDelete(resource): if given, every row but the Patient's gets a Delete button.
import { SECTIONS, resolver } from '../lib/display.js';
import { ConfirmDelete } from './ui.jsx';

function Cell({ value }) {
  if (!Array.isArray(value)) return value ?? '';
  return value.map(([label, code]) => (
    <div key={`${label}|${code}`}>
      <span className="text-slate-500">{label}</span> <code className="text-xs">{code}</code>
    </div>
  ));
}

export default function RecordView({ bundle, onDelete, busy }) {
  const resources = (bundle.entry ?? []).map((e) => e.resource);
  const resolve = resolver(bundle);
  const known = new Set(SECTIONS.map((s) => s.type));
  const other = resources.filter((r) => !known.has(r.resourceType));

  return (
    <div className="space-y-5">
      {SECTIONS.map((section) => {
        const rows = resources.filter((r) => r.resourceType === section.type);
        if (!rows.length) return null;
        return (
          <div key={section.type}>
            <h3 className="mb-1 font-medium">
              {section.title} <span className="text-sm font-normal text-slate-500">({rows.length})</span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    {section.head.map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}
                    {/* Wide enough for Delete? and Cancel, so confirming does not shift the columns. */}
                    {onDelete && <th className="w-44" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id ?? i} className="border-b border-slate-100 align-top">
                      {section.row(r, resolve).map((c, j) => <td key={j} className="px-2 py-1.5"><Cell value={c} /></td>)}
                      {onDelete && (
                        <td className="w-44 whitespace-nowrap px-2 py-1.5 text-right">
                          {r.resourceType !== 'Patient' && <ConfirmDelete disabled={busy} onDelete={() => onDelete(r)} />}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {other.length > 0 && (
        <p className="text-sm text-slate-500">Also included: {other.map((r) => r.resourceType).join(', ')}</p>
      )}
    </div>
  );
}
