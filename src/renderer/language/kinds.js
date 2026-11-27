// Which language server looks after which files, and how a student installs one that is missing.
// Longhand never installs or bundles a server: it uses what is on the machine (lsp.rs finds it).
// Python only for now; another language is an entry in each table here and a `Kind` in
// src-tauri/src/lsp/discover.rs.

/**
 * The servers, by the backend's name for each kind. `install` is the one command that installs
 * it and `note` what else is worth knowing first.
 */
export const KINDS = {
  python: {
    label: 'Python',
    install: 'uv tool install basedpyright',
    note: 'Without uv, “pip install basedpyright” does the same. Pyright and python-lsp-server work too.',
  },
};

/** File extension -> [server kind, the language id the protocol uses, the language's name]. */
const LANGUAGES = {
  py: ['python', 'python', 'Python'],
  pyi: ['python', 'python', 'Python'],
};

/** What looks after the file at `path`: { kind, languageId, name }, or null for a file no server reads. */
export function languageOf(path) {
  const name = path.split('/').pop();
  const entry = name.includes('.') && LANGUAGES[name.split('.').pop().toLowerCase()];
  return entry ? { kind: entry[0], languageId: entry[1], name: entry[2] } : null;
}
