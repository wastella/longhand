// Find and replace, drawn with the app's own inputs and buttons in place of CodeMirror's panel.
// The find row is always there; the replace row appears with Cmd+Alt+F or the › toggle.

import { runScopeHandlers } from '@codemirror/view';
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from '@codemirror/search';
import { h } from '../dom.js';

// Counting stops here, so a one-letter search in a large file stays instant.
const MAX_COUNTED = 1000;
const controllers = new WeakMap();

function countMatches(state, query) {
  if (!query.search) return '';
  if (!query.valid) return 'Invalid pattern';
  const { from, to } = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0;
  let current = 0;
  for (let next = cursor.next(); !next.done && total < MAX_COUNTED; next = cursor.next()) {
    total++;
    if (next.value.from === from && next.value.to === to) current = total;
  }
  if (!total) return 'No results';
  const shown = total >= MAX_COUNTED ? `${MAX_COUNTED}+` : String(total);
  return current ? `${current} of ${shown}` : `${shown} ${total === 1 ? 'result' : 'results'}`;
}

function toggle(label, title, onChange) {
  const button = h('button', { class: 'ghost search-toggle', type: 'button', title, 'aria-label': title, 'aria-pressed': 'false' }, label);
  button.addEventListener('click', () => {
    button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
    onChange();
  });
  return button;
}

const pressed = (button) => button.getAttribute('aria-pressed') === 'true';

/** CodeMirror's `createPanel` for search: the find row, and the replace row below it. */
export function createSearchPanel(view) {
  const query = getSearchQuery(view.state);
  const commit = () => {
    const next = new SearchQuery({
      search: find.value,
      replace: replace.value,
      caseSensitive: pressed(matchCase),
      regexp: pressed(regexp),
      wholeWord: pressed(wholeWord),
    });
    if (!next.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(next) });
  };
  const input = (props) => h('input', { class: 'text-input search-field', spellcheck: 'false', autocomplete: 'off', oninput: commit, ...props });
  const find = input({ 'main-field': 'true', placeholder: 'Find', 'aria-label': 'Find', value: query.search });
  const replace = input({ placeholder: 'Replace', 'aria-label': 'Replace with', value: query.replace });
  const matchCase = toggle('Aa', 'Match case', commit);
  const wholeWord = toggle('W', 'Whole word', commit);
  const regexp = toggle('.*', 'Regular expression', commit);
  const count = h('span', { class: 'search-count', 'aria-live': 'polite' });
  const action = (label, title, run) => h('button', { class: 'ghost', type: 'button', title, 'aria-label': title, onclick: () => run(view) }, label);
  const expand = h(
    'button',
    { class: 'ghost search-expand', type: 'button', title: 'Replace (⌘⌥F)', 'aria-label': 'Show replace', 'aria-expanded': 'false' },
    '›',
  );
  const replaceRow = h(
    'div',
    { class: 'search-row', hidden: true },
    replace,
    h('button', { type: 'button', onclick: () => replaceNext(view) }, 'Replace'),
    h('button', { type: 'button', onclick: () => replaceAll(view) }, 'Replace all'),
  );
  const dom = h(
    'div',
    { class: 'search-panel', role: 'search' },
    h(
      'div',
      { class: 'search-row' },
      expand,
      find,
      matchCase,
      wholeWord,
      regexp,
      count,
      action('↑', 'Previous match (⇧Enter)', findPrevious),
      action('↓', 'Next match (Enter)', findNext),
      action('×', 'Close (Esc)', closeSearchPanel),
    ),
    replaceRow,
  );

  const showReplace = (shown) => {
    replaceRow.hidden = !shown;
    expand.setAttribute('aria-expanded', String(shown));
    expand.classList.toggle('open', shown);
  };
  expand.addEventListener('click', () => showReplace(replaceRow.hidden));

  dom.addEventListener('keydown', (e) => {
    if (runScopeHandlers(view, e, 'search-panel')) return e.preventDefault();
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (e.target === find) (e.shiftKey ? findPrevious : findNext)(view);
    else if (e.target === replace) (e.metaKey || e.ctrlKey ? replaceAll : replaceNext)(view);
  });

  let frame = 0;
  const recount = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const text = countMatches(view.state, getSearchQuery(view.state));
      count.textContent = text;
      count.classList.toggle('bad', text === 'Invalid pattern');
    });
  };
  const sync = (q) => {
    if (find.value !== q.search) find.value = q.search;
    if (replace.value !== q.replace) replace.value = q.replace;
    matchCase.setAttribute('aria-pressed', String(q.caseSensitive));
    wholeWord.setAttribute('aria-pressed', String(q.wholeWord));
    regexp.setAttribute('aria-pressed', String(q.regexp));
  };
  sync(query);
  controllers.set(view, { showReplace, replace });

  return {
    dom,
    top: true,
    mount: () => (find.select(), recount()),
    update(update) {
      for (const tr of update.transactions) for (const effect of tr.effects) if (effect.is(setSearchQuery)) sync(effect.value);
      if (update.docChanged || update.selectionSet || update.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)))) recount();
    },
    destroy: () => (cancelAnimationFrame(frame), controllers.delete(view)),
  };
}

/** Opens find with the replace row showing, and puts the cursor in the replacement. */
export function openReplace(view) {
  openSearchPanel(view);
  const panel = controllers.get(view);
  if (!panel) return false;
  panel.showReplace(true);
  panel.replace.focus();
  panel.replace.select();
  return true;
}
