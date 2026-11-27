// Named actions that menu items (src-tauri/src/menu.rs) and other areas can trigger. Each area
// registers its own commands when it mounts. A command that also needs a menu item or a keyboard
// shortcut gets one line in menu.rs, the one place where shortcuts can be checked for clashes.

const commands = new Map();

/** Makes `run` the handler for the command `id`. Each id can be registered once. */
export function registerCommand(id, run) {
  if (commands.has(id)) throw new Error(`Command "${id}" is already registered`);
  commands.set(id, run);
}

/** Runs the command `id` with `args` and returns its result. Unknown ids do nothing. */
export function runCommand(id, ...args) {
  return commands.get(id)?.(...args);
}
