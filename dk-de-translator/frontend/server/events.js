// The live log on the page: events from walt.id's issuer and verifier and from the wallet routes.
// They go to the browser over Vite's own dev-server WebSocket (custom events), not a request of
// their own: a long-lived request per tab would use up the browser's 6 connections per host.
//   'wallet:event'        server -> all tabs, one new event
//   'wallet:events-hello' tab -> server on load; answered with 'wallet:events', the recent ones
export function createEventLog(limit = 100) {
  const events = [];
  let ws = null;

  return {
    // source: 'issuer' | 'verifier' (walt.id) | 'app' (the wallet routes)
    emit(source, text, ok = true) {
      const event = { at: Date.now(), source, text, ok };
      events.push(event);
      if (events.length > limit) events.shift();
      ws?.send('wallet:event', event);
    },

    attach(server) {
      ws = server.ws;
      ws.on('wallet:events-hello', (data, client) => client.send('wallet:events', events));
    },
  };
}
