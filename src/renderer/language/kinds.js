// Which language server looks after which files, and how a student installs one that is missing.
// Longhand never installs or bundles a server: it uses what is on the machine (lsp.rs finds it).

const isMac = /Mac/.test(navigator.platform);

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
  clang: {
    label: 'C and C++',
    install: isMac ? 'xcode-select --install' : 'sudo apt install clangd',
    note: isMac ? 'clangd comes with Apple’s command-line developer tools.' : 'On other systems, install clangd with your package manager.',
  },
  java: {
    label: 'Java',
    install: 'brew install jdtls',
    note: 'This is the Eclipse language server for Java. It needs a JDK, which Homebrew installs with it.',
  },
  typescript: {
    label: 'JavaScript and TypeScript',
    install: 'npm install -g typescript-language-server typescript',
    note: 'It needs Node.js, which you already have if you run JavaScript in the terminal.',
  },
  rust: {
    label: 'Rust',
    install: 'rustup component add rust-analyzer',
    note: 'rust-analyzer comes with rustup, the Rust installer.',
  },
  go: {
    label: 'Go',
    install: 'go install golang.org/x/tools/gopls@latest',
    note: 'gopls is the Go team’s language server.',
  },
};

/** File extension -> [server kind, the language id the protocol uses, the language's name]. */
const LANGUAGES = {
  py: ['python', 'python', 'Python'],
  pyi: ['python', 'python', 'Python'],
  c: ['clang', 'c', 'C'],
  h: ['clang', 'c', 'C'],
  cc: ['clang', 'cpp', 'C++'],
  cpp: ['clang', 'cpp', 'C++'],
  cxx: ['clang', 'cpp', 'C++'],
  hh: ['clang', 'cpp', 'C++'],
  hpp: ['clang', 'cpp', 'C++'],
  hxx: ['clang', 'cpp', 'C++'],
  java: ['java', 'java', 'Java'],
  js: ['typescript', 'javascript', 'JavaScript'],
  mjs: ['typescript', 'javascript', 'JavaScript'],
  cjs: ['typescript', 'javascript', 'JavaScript'],
  jsx: ['typescript', 'javascriptreact', 'JavaScript'],
  ts: ['typescript', 'typescript', 'TypeScript'],
  mts: ['typescript', 'typescript', 'TypeScript'],
  cts: ['typescript', 'typescript', 'TypeScript'],
  tsx: ['typescript', 'typescriptreact', 'TypeScript'],
  rs: ['rust', 'rust', 'Rust'],
  go: ['go', 'go', 'Go'],
};

/** What looks after the file at `path`: { kind, languageId, name }, or null for a file no server reads. */
export function languageOf(path) {
  const name = path.split('/').pop();
  const entry = name.includes('.') && LANGUAGES[name.split('.').pop().toLowerCase()];
  return entry ? { kind: entry[0], languageId: entry[1], name: entry[2] } : null;
}
