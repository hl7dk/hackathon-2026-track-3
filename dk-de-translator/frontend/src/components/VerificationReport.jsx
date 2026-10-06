// What a source's verifier checked when the patient shared: each check, who ran it, and
// which claims the verifier actually got. Shown for refusals too, so you can see what failed.
export default function VerificationReport({ verifier, verification }) {
  const ok = verification.status === 'SUCCESSFUL' && verification.checks.every((c) => c.ok);
  return (
    <div className={`mt-3 rounded-md border px-3 py-3 text-sm ${ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
      <p className="mb-2">
        <strong>{ok ? `Verified by ${verifier}` : `Refused by ${verifier}`}</strong>
        {verification.sessionId && <span className="text-slate-500"> · walt.id session <code className="text-xs">{verification.sessionId}</code></span>}
      </p>
      <ul className="space-y-0.5">
        {verification.checks.map((c) => (
          <li key={c.label} className="flex gap-2">
            <span className={c.ok ? 'text-green-700' : 'text-red-700'}>{c.ok ? '✓' : '✗'}</span>
            <span>
              {c.label} <span className="text-xs text-slate-500">({c.by})</span>
              {c.detail && <span className="block text-xs text-red-700">{c.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-slate-600">The verifier got: {verification.disclosed.join(', ') || 'nothing'}</p>
    </div>
  );
}
