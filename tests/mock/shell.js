// Start-up, opening folders, app settings, recent folders, the layout, the usage log, dialogs and
// the shortcut list.
//
// Options: `init` overrides what app_init returns (for example { openDir: null, recents: [...] }
// for the welcome screen); `pick` is the folder the picker returns (null: cancelled); `missing`
// lists folders that no longer exist; `slowOpen` delays workspace_open by that many ms. window.__prefs
// shows what was saved: { settings, layout, recents, theme }; window.__quit is set once app_quit
// runs, and window.__opened counts workspace_open calls.

const mock = window.__mock;
const connected = { installed: true, loggedIn: true, plan: 'max' };
const init = { openDir: mock.workspace.path, lastWorkspace: null, settings: {}, layout: null, recents: [], version: '0.1.0', ...mock.options.init };
const prefs = (window.__prefs = { settings: { ...init.settings }, layout: init.layout, recents: init.recents, theme: null });
const missing = new Set(mock.options.missing || []);

// The same table menu.rs builds from the menu bar; tests/ui/shell.test.mjs fails if they differ.
const shortcuts = [
  ['settings', 'Longhand', 'Settings…', 'CmdOrCtrl+,'],
  ['quit', 'Longhand', 'Quit Longhand', 'CmdOrCtrl+Q'],
  ['open-folder', 'File', 'Open Folder…', 'CmdOrCtrl+O'],
  ['new-file', 'File', 'New File…', 'CmdOrCtrl+N'],
  ['quick-open', 'File', 'Go to File…', 'CmdOrCtrl+P'],
  ['save', 'File', 'Save', 'CmdOrCtrl+S'],
  ['close-tab', 'File', 'Close Tab', 'CmdOrCtrl+W'],
  ['find-in-files', 'File', 'Find in Files…', 'CmdOrCtrl+Shift+F'],
  ['toggle-files', 'View', 'Show or Hide Files', 'CmdOrCtrl+B'],
  ['toggle-bottom', 'View', 'Show or Hide Terminal and Tests', 'CmdOrCtrl+J'],
  ['toggle-tutor', 'View', 'Show or Hide Tutor', 'CmdOrCtrl+L'],
  ['focus-files', 'View', 'Go to Files', 'CmdOrCtrl+1'],
  ['focus-editor', 'View', 'Go to Editor', 'CmdOrCtrl+2'],
  ['focus-terminal', 'View', 'Go to Terminal', 'CmdOrCtrl+3'],
  ['focus-tutor', 'View', 'Go to Tutor', 'CmdOrCtrl+4'],
  ['zoom-in', 'View', 'Bigger Text', 'CmdOrCtrl+='],
  ['zoom-out', 'View', 'Smaller Text', 'CmdOrCtrl+-'],
  ['zoom-reset', 'View', 'Default Text Size', 'CmdOrCtrl+0'],
  ['run-file', 'Run', 'Run File', 'CmdOrCtrl+R'],
  ['new-terminal', 'Run', 'New Terminal', 'Ctrl+Shift+`'],
  ['run-tests-file', 'Run', 'Run Tests in Current File', 'CmdOrCtrl+T'],
  ['run-tests', 'Run', 'Run All Tests', 'CmdOrCtrl+Shift+T'],
  ['ask-selection', 'Tutor', 'Explain Selection', 'CmdOrCtrl+E'],
  ['review-file', 'Tutor', 'Review Current File', 'CmdOrCtrl+Shift+R'],
  ['new-conversation', 'Tutor', 'New Conversation', 'CmdOrCtrl+Shift+N'],
].map(([id, menu, label, keys]) => ({ id, menu, label, keys }));

function checkFolder(dir) {
  if (missing.has(dir)) throw `${dir} no longer exists. It may have been moved or deleted.`;
}

async function openFolder(dir) {
  checkFolder(dir);
  window.__opened = (window.__opened || 0) + 1;
  if (mock.options.slowOpen) await new Promise((resolve) => setTimeout(resolve, mock.options.slowOpen));
  const name = dir.split('/').pop();
  prefs.recents = [{ path: dir, shortPath: dir, name, openedAt: new Date().toISOString(), exists: true }, ...prefs.recents.filter((r) => r.path !== dir)];
  setTimeout(() => mock.emit('workspace:opened', { ...mock.workspace, path: dir, name }));
}

Object.assign(mock.commands, {
  app_init: () => ({ ...init, auth: mock.options.auth || connected, smoke: false }),
  auth_status: () => mock.options.auth || connected,
  workspace_choose: () => mock.options.pick ?? null,
  folder_check: ({ dir }) => checkFolder(dir),
  workspace_open: ({ dir }) => openFolder(dir),
  app_quit: () => void (window.__quit = true),
  config_set: ({ patch }) => ({ ...mock.workspace.config, ...patch }),
  log_summary: () => ({ today: { ask: 4, reveal: 0, tests: 5 }, total: { ask: 4, reveal: 0, tests: 5 } }),
  log_record: () => ({ today: { ask: 4, reveal: 1, tests: 5 }, total: { ask: 4, reveal: 1, tests: 5 } }),
  // Tests set `confirm: false` to play a student who backs out of a confirmation.
  confirm: ({ message }) => ((window.__confirmed = message), mock.options.confirm !== false),
  settings_set: ({ patch }) => Object.assign(prefs.settings, patch),
  recents_list: () => prefs.recents.map((r) => ({ ...r, exists: !missing.has(r.path) })),
  recent_forget: ({ path }) => (prefs.recents = prefs.recents.filter((r) => r.path !== path)),
  layout_save: ({ layout }) => void (prefs.layout = layout),
  window_set_theme: ({ theme }) => void (prefs.theme = theme),
  shortcuts_list: () => shortcuts,
});
