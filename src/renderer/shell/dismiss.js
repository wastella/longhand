// Escape closes whichever popup is open, wherever the focus is: a popup that has lost the focus
// (to a click that it did not see, or to another window) must not be left stranded on screen.
// Sheets do the same themselves (sheet.js).

const popups = [];

/**
 * Registers a popup: `isOpen()` says whether it is showing, `close()` puts it away. On Escape
 * the most recently registered open popup closes, ahead of the editor's and terminal's own
 * Escape, and nothing else sees the key.
 */
export function closeOnEscape(isOpen, close) {
  popups.push({ isOpen, close });
}

document.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Escape') return;
    const popup = popups.findLast((entry) => entry.isOpen());
    if (!popup) return;
    e.preventDefault();
    e.stopPropagation();
    popup.close();
  },
  true,
);
