// One server's connection, as the client library wants it: JSON messages out and in. The backend
// (lsp.rs) frames them onto the server's standard input and output.
//
// The server may also ask the editor things. The library refuses every such request, and a
// refused `workspace/configuration` leaves Pyright analysing with the wrong Python, so requests
// are answered here and never reach the library.

import { invoke } from '../backend.js';

// The backend stops reading a server whose messages pile up unacknowledged, so one that floods
// is held back by its own output. Acknowledging in batches keeps that from costing a call each.
const ACK_BYTES = 64 * 1024;
const ACK_MS = 100;
const METHOD_NOT_FOUND = -32601;

/**
 * The connection to server `id`. `answer(method, params)` returns the result of a request the
 * server makes, or undefined to refuse it. Returns the library's transport, plus
 * `receive(message, bytes)` for what the backend delivers and `close()`.
 */
export function createTransport(id, answer) {
  const handlers = new Set();
  let unacked = 0;
  let timer = null;
  let closed = false;

  // A server that has gone away is reported by its lsp:exit event, not by these calls failing.
  const call = (command, args) => closed || invoke(command, { id, ...args }).catch(() => {});
  const send = (message) => call('lsp_send', { message });

  function acknowledge() {
    clearTimeout(timer);
    timer = null;
    if (unacked) call('lsp_ack', { bytes: unacked });
    unacked = 0;
  }

  function reply(request) {
    const result = answer(request.method, request.params);
    const outcome = result === undefined ? { error: { code: METHOD_NOT_FOUND, message: 'Longhand does not do that' } } : { result };
    send(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...outcome }));
  }

  return {
    send,
    subscribe: (handler) => handlers.add(handler),
    unsubscribe: (handler) => handlers.delete(handler),
    receive(message, bytes) {
      if (closed) return;
      unacked += bytes;
      if (unacked >= ACK_BYTES) acknowledge();
      else timer ??= setTimeout(acknowledge, ACK_MS);
      let parsed;
      try {
        parsed = JSON.parse(message);
      } catch {
        return;
      }
      if (parsed === null || typeof parsed !== 'object') return;
      if (parsed.method && 'id' in parsed) return reply(parsed);
      for (const handler of [...handlers]) {
        // One message the client cannot make sense of must not hold up the ones after it.
        try {
          handler(message);
        } catch (error) {
          console.error('A language server message could not be handled:', error);
        }
      }
    },
    close() {
      closed = true;
      clearTimeout(timer);
      handlers.clear();
    },
  };
}
