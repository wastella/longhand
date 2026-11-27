// Remembers which files were open in each folder, and where the cursor was in each, so reopening
// the folder brings the student back to where they were. Kept in the webview's local storage:
// it is a convenience, and losing it loses nothing but the tabs.

const key = (folder) => `longhand.openFiles:${folder}`;
// Writing on every cursor move would be wasteful; a short pause is enough.
const WRITE_DELAY_MS = 400;

let timer = 0;
let pending = null;

function write() {
  clearTimeout(timer);
  if (!pending) return;
  const { folder, files, active } = pending;
  pending = null;
  try {
    localStorage.setItem(key(folder), JSON.stringify({ files, active }));
  } catch {
    // Storage full or unavailable: the tabs simply will not come back.
  }
}

/** Records `files` ([{ path, cursor }]) and the active path for `folder`, after a short pause. */
export function rememberTabs(folder, files, active) {
  pending = { folder, files, active };
  clearTimeout(timer);
  timer = setTimeout(write, WRITE_DELAY_MS);
}

/** Writes a pending record now, before the folder is left or the window closes. */
export const flushTabs = write;

/** What was open in `folder` last time: { files: [{ path, cursor }], active }, or null. */
export function recallTabs(folder) {
  try {
    const saved = JSON.parse(localStorage.getItem(key(folder)));
    return Array.isArray(saved?.files) ? saved : null;
  } catch {
    return null;
  }
}
