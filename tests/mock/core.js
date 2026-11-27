// A stand-in for the Rust backend, so the interface runs in an ordinary browser for the
// interface tests and `npm run preview`. scripts/browser.mjs injects this file first, then
// fixture.js, then each area's file, which adds its commands to `__mock.commands`.
//
// Hooks for tests: window.__MOCK__ holds the options a test opened the page with (it may change
// them later), window.__emit(event, payload) fakes a backend event, and window.__requestClose()
// fakes the window being asked to close and resolves true if the interface let it.

const listeners = {};
const closeHandlers = [];
const emit = (event, payload) => (listeners[event] || []).forEach((handler) => handler({ payload }));
const options = (window.__MOCK__ = window.__MOCK__ || {});

window.__mock = { commands: {}, emit, options };
window.__emit = emit;

window.__TAURI__ = {
  core: { invoke: async (command, args) => (window.__mock.commands[command] ? window.__mock.commands[command](args || {}) : null) },
  event: { listen: async (event, handler) => ((listeners[event] = listeners[event] || []).push(handler), () => {}) },
  window: { getCurrentWindow: () => ({ onCloseRequested: async (handler) => (closeHandlers.push(handler), () => {}) }) },
};

window.__requestClose = async () => {
  let prevented = false;
  for (const handler of closeHandlers) await handler({ preventDefault: () => (prevented = true) });
  return !prevented;
};
