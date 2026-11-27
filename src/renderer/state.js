// State shared by every area, and the events areas use to tell each other what happened.
//
// Events (name: payload):
//   workspace:opened   { path, name, config, courseRules, log }  a folder was opened; reset per-folder state
//   workspace:ready    (none)                                     every area finished handling workspace:opened
//   editor:active      path | null                                the file shown in the editor changed
//   editor:saved       path                                       a file was written to disk
//   editor:cursor      { path, line, col, selection: { fromLine, toLine } | null } | null
//   tests:finished     the result object of the backend's tests:done event (see tests/index.js)
//   tests:selected     a test result | null                       the test shown in the test panel changed
//   tutor:finished     { ev: { type, cancelled?, code?, message? }, text }  a conversation answer ended (done, error or stopped)
//   usage:changed      { today, total }                           the folder's usage counts changed
//   auth:changed       { installed, loggedIn, plan }              the tutor's connection status is known
//   panel:toggled      { id, visible }                            a side or bottom panel was shown or hidden
//   text-size:changed  size in px                                 the code text size changed
//   files:changed      [path]                                     files changed on disk outside the editor (the
//                                                                 terminal, git, a script); paths are relative,
//                                                                 and '' means anything may have changed
//
// Reserved for work in progress, so areas agree on the names before they exist:
//   theme:changed      'dark' | 'light'                           the colour theme changed; re-read tokens

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

/**
 * Notifies every subscriber, in the order they subscribed. Resolves when all their handlers have.
 * One area's handler failing must not stop the others from hearing the event (a folder change
 * that reached only some areas would leave them pointing at different folders), so failures are
 * logged and the rest still run.
 */
export function emit(event, payload) {
  const settle = async (handler) => {
    try {
      await handler(payload);
    } catch (error) {
      console.error(`A handler for "${event}" failed:`, error);
    }
  };
  return Promise.all([...(handlers.get(event) || [])].map(settle));
}
