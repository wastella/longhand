// The only module that talks to the Rust backend. Everything else imports from here, so the
// interface can run against tests/mock/ in an ordinary browser.

const tauri = () => window.__TAURI__;

/** Calls a backend command (see the invoke_handler list in src-tauri/src/main.rs). */
export const invoke = (command, args) => tauri().core.invoke(command, args);

/** Subscribes to a backend event. The handler receives the event's payload. */
export const listen = (event, handler) => tauri().event.listen(event, (e) => handler(e.payload));

/** Shows a native confirmation dialog; resolves true when the user picks `action`. */
export const confirm = (message, action) => invoke('confirm', { message, action });

/** Runs `handler(event)` when the window is asked to close; `event.preventDefault()` keeps it open. */
export const onCloseRequested = (handler) => tauri().window.getCurrentWindow().onCloseRequested(handler);
