// State shared by every area, and the events areas use to tell each other what happened.
//
// Events (name: payload):
//   workspace:opened   { path, name, config, courseRules, log }  a folder was opened; reset per-folder state
//   workspace:ready    (none)                                     every area finished handling workspace:opened
//   editor:active      path | null                                the file shown in the editor changed
//   editor:cursor      { path, line, col, selection: { fromLine, toLine } | null } | null
//   tests:finished     the result object of the backend's tests:done event
//   tutor:finished     { ev, text }                               a tutor answer ended (done, error or stopped)
//   usage:changed      { today, total }                           the folder's usage counts changed
//   auth:changed       { installed, loggedIn, plan }              the tutor's connection status is known
//   panel:toggled      { id, visible }                            a side or bottom panel was shown or hidden
//   text-size:changed  size in px                                 the code text size changed

export const state = {
  /** The open folder, as sent with workspace:opened, or null before one is opened. */
  workspace: null,
  /** The folder's settings: { policy: 'strict' | 'guided', model }. */
  config: { policy: 'strict', model: 'sonnet' },
};

const handlers = new Map();

/** Calls `handler(payload)` each time `event` is emitted. Returns a function that unsubscribes. */
export function on(event, handler) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(handler);
  return () => handlers.get(event).delete(handler);
}

/** Resolves with the payload of the next `event`. */
export function once(event) {
  return new Promise((resolve) => {
    const off = on(event, (payload) => (off(), resolve(payload)));
  });
}

/** Notifies every subscriber, in the order they subscribed. Resolves when all their handlers have. */
export function emit(event, payload) {
  return Promise.all([...(handlers.get(event) || [])].map((handler) => handler(payload)));
}
