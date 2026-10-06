// Behind the scenes: a live log of what the issuer, the verifier and this app do while the patient
// signs in and shares. It arrives over Vite's dev-server WebSocket (see server/events.js).
// since: the sign-in's time on the server; earlier events (someone else's) are not shown. Only server
// timestamps are compared: the browser's clock can differ (WSL vs Windows).
import { useEffect, useRef, useState } from 'react';
import { Button, Card } from './ui.jsx';

const SOURCES = {
  issuer: { label: 'walt.id issuer', className: 'bg-violet-100 text-violet-800' },
  verifier: { label: 'walt.id verifier', className: 'bg-amber-100 text-amber-800' },
  app: { label: 'app', className: 'bg-blue-100 text-blue-800' },
};

export default function EventLog({ since }) {
  const [events, setEvents] = useState([]);
  const [clearedAt, setClearedAt] = useState(0);
  const [connected, setConnected] = useState(true);
  const bottom = useRef(null);

  useEffect(() => {
    const hot = import.meta.hot;
    if (!hot) return undefined; // only `npm run dev` has the wallet routes and the log
    const add = (incoming) => setEvents((all) => [...all, ...incoming.filter((e) => !all.some((a) => a.at === e.at && a.text === e.text))]);
    const onEvent = (event) => add([event]);
    const onConnect = () => {
      setConnected(true);
      hot.send('wallet:events-hello'); // replay the recent events, also after a dev server restart
    };
    hot.on('wallet:event', onEvent);
    hot.on('wallet:events', add);
    hot.on('vite:ws:connect', onConnect);
    hot.on('vite:ws:disconnect', () => setConnected(false));
    onConnect();
    return () => {
      hot.off('wallet:event', onEvent);
      hot.off('wallet:events', add);
      hot.off('vite:ws:connect', onConnect);
    };
  }, []);

  const shown = events.filter((e) => e.at >= since && e.at > clearedAt);
  // Braces: an effect may only return a cleanup function, and newer browsers return a Promise from scrollIntoView.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [shown.length]);

  return (
    <Card className="flex h-full flex-col" title="Behind the scenes" actions={<Button onClick={() => setClearedAt(shown.at(-1)?.at ?? clearedAt)}>Clear</Button>}>
      <p className="mb-3 text-xs text-slate-500">
        Live events from the issuer, the verifier and this app.{!connected && ' Not connected: is the dev server running?'}
      </p>
      <ol className="max-h-[28rem] min-h-0 flex-1 space-y-1.5 overflow-auto text-sm lg:max-h-none">
        {shown.map((e) => (
          <li key={`${e.at}-${e.text}`} className="flex gap-2">
            <span className="shrink-0 font-mono text-xs leading-5 text-slate-400">{new Date(e.at).toLocaleTimeString()}</span>
            <span className={`h-fit shrink-0 rounded px-1.5 text-xs leading-5 ${SOURCES[e.source]?.className ?? ''}`}>{SOURCES[e.source]?.label ?? e.source}</span>
            <span className={e.ok ? '' : 'text-red-700'}>{e.ok ? '' : '✗ '}{e.text}</span>
          </li>
        ))}
        {shown.length === 0 && <li className="text-slate-500">Nothing yet.</li>}
        <li ref={bottom} />
      </ol>
    </Card>
  );
}
