// A Markdown handout in the pane: headings, math, code, a table, a picture from the folder and
// one from the web (named, not loaded).
export const description = 'The handout pane with a Markdown handout';

const handout = `# Assignment 1: Running statistics

Implement \`RunningStats\` in [stats/running.py](stats/running.py). See [Grading](#grading) for how it is marked.

## Problem 1: the mean

Keep the mean up to date with each new value $x_n$:

$$\\mu_n = \\mu_{n-1} + \\frac{x_n - \\mu_{n-1}}{n}$$

\`\`\`python
def push(self, x: float) -> None:
    ...
\`\`\`

![The update, drawn](figures/update.png)

![A diagram from the course site](https://example.com/diagram.png)

## Grading

| Test | Points |
| ---- | ------ |
| \`test_mean\` | 2 |
| \`test_variance\` | 3 |

Questions go to the [course forum](https://example.com/forum).
`;

export const options = {
  files: { 'HANDOUT.md': handout },
  views: { 'figures/update.png': { png: true } },
};

export default async function (page) {
  await page.click('#tree .node[data-path="stats"]');
  await page.click('#tree .node[data-path="stats/running.py"]');
  await page.waitForSelector('.cm-content');
  await page.click('#toggle-handout-panel');
  await page.waitForSelector('#handout .md-doc img[src]');
}
