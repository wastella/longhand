// The test pane: results on the left, failures first, and the selected test's output on the right.

import { emptyState, h } from '../dom.js';
import { askTutorAbout } from '../tutor/index.js';

export const badge = h('span', { id: 'tests-badge' });
const list = h('div', { id: 'tests-list' });
const detail = h('pre', { id: 'tests-detail' });
export const pane = h('div', { id: 'tests', class: 'bottom-pane' }, list, detail);

const failed = (test) => test.status === 'FAILED' || test.status === 'ERROR';

export function showWaiting() {
  list.replaceChildren(emptyState('Run the tests to see results here.'));
  detail.textContent = '';
  badge.textContent = '';
}

export function showRunning() {
  badge.textContent = '…';
  badge.className = '';
  list.replaceChildren(emptyState('Running…'));
  detail.textContent = '';
}

export const showCommand = (command) => (detail.textContent = `$ ${command}\n`);
export const showError = (message) => list.replaceChildren(emptyState(message));
export const appendOutput = (text) => (detail.textContent += text);

// Help with a failure starts from the student's own read of it.
function askAbout(test) {
  const output = (test.detail || test.message || '').slice(0, 6000);
  askTutorAbout({
    kind: 'failure',
    label: test.id.split('::').pop(),
    text: `Failing test: ${test.id}\n\nPytest output:\n${output}`,
    placeholder: 'What did you expect to happen, and what have you tried so far?',
  });
}

function testRow(test) {
  const row = h(
    'div',
    {
      class: `test list-row ${test.status}`,
      title: test.id,
      onclick: () => {
        for (const other of list.querySelectorAll('.test')) other.classList.toggle('active', other === row);
        detail.textContent = test.detail || test.message || `${test.status} ${test.id}`;
      },
    },
    h('span', { class: 'dot' }),
    h('span', { class: 'name' }, test.id.split('::').slice(1).join(' › ') || test.id),
  );
  if (failed(test)) row.append(h('button', { onclick: (e) => (e.stopPropagation(), askAbout(test)) }, 'Ask tutor'));
  return row;
}

export function showResults(result) {
  list.replaceChildren();
  if (result.cancelled) {
    badge.textContent = '';
    list.append(emptyState('Cancelled.'));
    return;
  }
  if (!result.tests.length) {
    badge.textContent = '';
    list.append(emptyState(result.summary || 'No test results. The full output is on the right.'));
    detail.textContent = result.output;
    return;
  }
  const failures = result.tests.filter(failed);
  badge.textContent = failures.length ? `${failures.length} failing` : 'passing';
  badge.className = failures.length ? 'fail' : 'pass';
  list.append(h('div', { class: 'tests-summary' }, result.summary || `${result.tests.length} tests`));
  for (const test of [...failures, ...result.tests.filter((t) => !failed(t))]) list.append(testRow(test));
  if (failures.length) list.querySelector('.test').click();
  else detail.textContent = result.output;
}
