// Clone Repository (clone.rs). options.clone: { progress: [[stage, percent], …] sent before the
// answer, error: { code, message } to fail with, slow: true to wait until cancelled }.
// window.__clones lists the arguments of every clone_start.

const mock = window.__mock;
const options = mock.options.clone || {};
window.__clones = [];
const cancels = new Map();

Object.assign(mock.commands, {
  clone_location: () => '/Users/student',
  clone_choose: () => mock.options.pick ?? null,
  clone_cancel: ({ id }) => cancels.get(id)?.(),
  clone_start: ({ id, url, parent, name }) => {
    window.__clones.push({ url, parent, name });
    return new Promise((resolve, reject) => {
      cancels.set(id, () => reject({ code: 'cancelled', message: 'The clone was cancelled.' }));
      for (const [stage, percent] of options.progress || []) mock.emit('clone:progress', { id, stage, percent });
      if (options.slow) return;
      setTimeout(() => (options.error ? reject(options.error) : resolve({ path: `${parent}/${name}` })), 50);
    });
  },
});
