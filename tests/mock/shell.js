// Start-up, the open folder, settings, the usage log and dialogs.

const mock = window.__mock;
const connected = { installed: true, loggedIn: true, plan: 'max' };

Object.assign(mock.commands, {
  app_init: () => ({ lastWorkspace: null, openDir: mock.workspace.path, auth: mock.options.auth || connected, smoke: false }),
  auth_status: () => mock.options.auth || connected,
  workspace_open: () => setTimeout(() => mock.emit('workspace:opened', mock.workspace)),
  config_set: ({ patch }) => ({ ...mock.workspace.config, ...patch }),
  log_summary: () => ({ today: { ask: 4, reveal: 0, tests: 5 }, total: { ask: 4, reveal: 0, tests: 5 } }),
  log_record: () => ({ today: { ask: 4, reveal: 1, tests: 5 }, total: { ask: 4, reveal: 1, tests: 5 } }),
  confirm: () => true,
});
