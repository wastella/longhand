// The macOS shortcuts inside a focused terminal. Copy and paste go through the Edit menu, whose
// copy and paste events xterm.js answers itself (paste is bracketed when the shell asks for it);
// this handler only keeps Cmd combinations away from the shell and adds what the menu cannot do
// for a terminal: select all of its buffer, and clear it.

/** A key handler for `xterm.attachCustomKeyEventHandler`. Returning false keeps a key from the shell. */
export function terminalKeys(xterm) {
  return (event) => {
    if (!event.metaKey || event.ctrlKey) return true;
    if (event.type === 'keydown' && !event.altKey && !event.shiftKey) {
      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        xterm.clear();
      } else if (key === 'a') {
        event.preventDefault();
        xterm.selectAll();
      }
    }
    // Every other Cmd combination (Cmd+C with or without a selection, Cmd+V, the menu's
    // shortcuts) is left to the menu. Ctrl+C is untouched and still interrupts.
    return false;
  };
}
