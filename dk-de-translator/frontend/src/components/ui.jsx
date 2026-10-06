// Small shared building blocks.
import { useState } from 'react';

export function PlaceholderBadge() {
  return (
    <span className="rounded border border-dashed border-amber-500 bg-amber-50 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-amber-800">
      Placeholder
    </span>
  );
}

// placeholder: the card stands in for what the wallet / consent group builds.
export function Card({ title, step, actions, placeholder, className = '', children }) {
  const frame = placeholder ? 'border-2 border-dashed border-amber-400' : 'border border-slate-200';
  return (
    <section className={`rounded-lg bg-white p-5 shadow-sm ${frame} ${className}`}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          {step && <span className="grid size-6 place-items-center rounded-full bg-blue-700 text-sm text-white">{step}</span>}
          {title}
          {placeholder && <PlaceholderBadge />}
        </h2>
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

// danger: for a step that cannot be undone, e.g. confirming a delete.
export function Button({ primary, danger, className = '', ...props }) {
  const look = danger
    ? 'border-red-700 bg-red-700 text-white hover:bg-red-800'
    : primary
      ? 'border-blue-700 bg-blue-700 text-white hover:bg-blue-800'
      : 'border-slate-300 bg-white hover:bg-slate-50';
  return <button className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-default disabled:opacity-50 ${look} ${className}`} {...props} />;
}

export function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-slate-600">
      {label}
      {children}
    </label>
  );
}

export const inputClass = 'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 disabled:bg-slate-100';

// kind: '' | 'ok' | 'err'
export function Status({ message }) {
  if (!message?.text) return null;
  const color = { ok: 'text-green-700', err: 'text-red-700' }[message.kind] ?? 'text-slate-600';
  return <p className={`mt-3 text-sm ${color}`}>{message.text}</p>;
}

export function Json({ value, label = 'Raw FHIR' }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm text-slate-600">{label}</summary>
      <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-slate-100 p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

// Runs an async step, reporting progress and errors through setMessage.
export async function runStep(setMessage, setBusy, busyText, fn) {
  setBusy(true);
  setMessage({ text: busyText });
  try {
    await fn();
  } catch (err) {
    console.error(err);
    const hint = err instanceof TypeError ? ' (server down, or CORS blocked the request)' : '';
    setMessage({ text: `${err.message}${hint}`, kind: 'err' });
  } finally {
    setBusy(false);
  }
}

// A delete that asks once more before it runs. onDelete is called on the second click.
export function ConfirmDelete({ onDelete, disabled, label = 'Delete', confirmLabel = 'Delete?' }) {
  const [confirming, setConfirming] = useState(false);
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <span className="inline-flex gap-1">
      <Button
        danger={confirming}
        disabled={disabled}
        onClick={stop(() => (confirming ? (setConfirming(false), onDelete()) : setConfirming(true)))}
      >
        {confirming ? confirmLabel : label}
      </Button>
      {confirming && <Button onClick={stop(() => setConfirming(false))}>Cancel</Button>}
    </span>
  );
}
