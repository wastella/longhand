// Keeps the Python server in step with the folder's environment. The server reads what can be
// imported once, when it starts. After packages are installed it is told to look again (Pyright
// re-reads its settings, and with them the environment), and when the folder has only now got
// an environment of its own, it is started again inside it.

import { invoke } from '../backend.js';
import { restart, serverOf, settingsOf, timing } from './servers.js';

/** Paths whose change means the environment may have: the environment itself and what declares it. */
const ENVIRONMENT = /(^|\/)(\.venv|venv|site-packages)(\/|$)|(^|\/)(pyproject\.toml|uv\.lock|requirements[^/]*\.txt|pyrightconfig\.json)$/;
const INTERPRETERS = ['.venv/bin/python', 'venv/bin/python'];

let timer = null;

async function environmentChanged(server) {
  const running = () => serverOf('python') === server && server.status === 'running';
  if (!running()) return;
  if (!server.python) {
    const found = await invoke('doc_stat', { paths: INTERPRETERS }).catch(() => []);
    if (!running()) return;
    if (found.some((file) => file.mtime != null)) return restart('python');
  }
  server.client.notification('workspace/didChangeConfiguration', { settings: settingsOf(server) });
}

/** Files changed on disk outside the editor (`paths` as files:changed gives them). */
export function filesChanged(paths) {
  const server = serverOf('python');
  if (server?.status !== 'running' || !paths.some((path) => path === '' || ENVIRONMENT.test(path))) return;
  clearTimeout(timer);
  timer = setTimeout(() => environmentChanged(server), timing.environment);
}
