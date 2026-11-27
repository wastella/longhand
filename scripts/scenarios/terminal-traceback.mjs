export const description = 'A traceback in the terminal, with a file location hovered';

const traceback = [
  'uv run python stats/running.py',
  'Traceback (most recent call last):',
  '  File "/demo/running-stats/stats/running.py", line 19, in variance',
  '    return self.sum_sq / (self.count - 1)',
  'ZeroDivisionError: float division by zero',
  'tests/test_running.py:15: in test_variance   docs: https://docs.python.org/3/library/exceptions.html',
  '',
].join('\r\n');

export const options = { termOutput: traceback };

/**
 * Moves the mouse over `text` in the terminal in front (the middle of its first character) and
 * returns that point. Also used by tests/ui/terminal.test.mjs.
 */
export async function hoverTerminalText(page, text) {
  const handle = await page.waitForFunction(
    (text) => {
      const view = [...document.querySelectorAll('#terminal .term-view')].find((v) => !v.hidden);
      for (const row of view?.querySelectorAll('.xterm-rows > div') || []) {
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        let seen = '';
        const nodes = [];
        while (walker.nextNode()) (nodes.push([walker.currentNode, seen.length]), (seen += walker.currentNode.data));
        const at = seen.indexOf(text);
        if (at < 0) continue;
        const [node, offset] = nodes.findLast(([, start]) => start <= at);
        const range = document.createRange();
        range.setStart(node, at - offset);
        range.setEnd(node, at - offset + 1);
        const box = range.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      }
      return null;
    },
    {},
    text,
  );
  const point = await handle.jsonValue();
  await page.mouse.move(point.x - 40, point.y);
  await page.mouse.move(point.x, point.y);
  await page.waitForSelector('.term-link-hint:not([hidden])');
  return point;
}

export default async function (page) {
  await hoverTerminalText(page, 'running.py", line 19');
}
