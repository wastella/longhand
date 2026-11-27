// A terminal that prints one prompt and ignores input.

const mock = window.__mock;
const prompt = '\x1b[2mrunning-stats\x1b[0m % ';

Object.assign(mock.commands, {
  term_start: () => {
    setTimeout(() => mock.emit('term:data', { id: 1, data: `${prompt}uv run python -c "from stats.running import RunningStats"\r\n${prompt}` }), 50);
    return 1;
  },
});
