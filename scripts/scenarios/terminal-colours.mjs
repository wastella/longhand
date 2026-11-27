export const description = "The terminal's 16 ANSI colours as text and as backgrounds";

const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

export default async function (page) {
  await page.waitForFunction(() => document.querySelector('#terminal .xterm-rows')?.textContent.includes('running-stats %'));
  const row = (base, label) =>
    `${label.padEnd(7)}` +
    names.map((name, i) => `\x1b[${base + i}m${name.padEnd(9)}\x1b[0m`).join('') +
    '  ' +
    names.map((_, i) => `\x1b[${base + 10 + i}m  \x1b[0m`).join(' ');
  await page.evaluate(
    (text) => window.__termWrite(text),
    `\r\n${row(30, 'normal')}\r\n${row(90, 'bright')}\r\n\x1b[2mdim text, as shell hints print it\x1b[0m\r\n`,
  );
}
