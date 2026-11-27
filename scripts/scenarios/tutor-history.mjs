import { askTutor } from '../browser.mjs';

export const description = 'Earlier conversations in this folder';

const thread = (id, title, updated, count) => ({
  id,
  kind: 'conversation',
  title,
  created: updated,
  updated,
  messages: Array.from({ length: count }, (_, i) => ({ role: i % 2 ? 'tutor' : 'student', text: i ? 'An answer.' : title, at: updated })),
});

export const options = {
  tutor: {
    threads: {
      'conv-a': thread('conv-a', 'Why does my causal mask let position 0 see position 3?', '2026-11-25T15:20:00Z', 6),
      'conv-b': thread(
        'conv-b',
        'What is the difference between AdamW and Adam with L2 regularisation, and why does the decoupling matter?',
        '2026-11-26T09:05:00Z',
        4,
      ),
    },
  },
};

export default async function (page) {
  await askTutor(page, 'What is a residual stream?');
  await page.click('#show-history');
  await page.waitForSelector('#history-list .thread');
}
