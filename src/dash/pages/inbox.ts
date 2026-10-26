// Inbox: the replies Echo has read, each with its class and, when Echo drafted an answer, where that draft stands
// and a link to it in Approvals.
import { h } from '../dom';
import type { HFn } from '../dom';
import { INBOX } from '../sample';
import type { InboxClass } from '../sample';
import { inboxRows } from '../rows';
import type { InboxRow } from '../rows';
import { chip, pageTitle } from './common';
import type { PageDeps } from './common';

const CLASS_TONE: Record<InboxClass, string> = { yes: 'ok', question: 'gold', 'not-now': 'kind', 'opt-out': 'warn' };

export function inboxItem(row: InboxRow, hf: HFn = h): HTMLElement {
  const extra: (Node | string)[] = [];
  if (row.draftLabel) extra.push(chip(row.draftLabel, row.draftStatus === 'waiting' ? 'gold' : 'kind', hf));
  if (row.draftStatus === 'waiting') {
    extra.push(hf('a', { href: '#/approvals', class: 'pg-link', 'aria-label': `Open the reply to "${row.subject}" in Approvals` }, 'Open in Approvals'));
  }
  return hf(
    'li',
    { class: 'pg-item', 'data-id': row.id },
    hf('div', { class: 'pg-card-head' }, hf('span', { class: 'pg-agent' }, row.from), chip(row.clsLabel, CLASS_TONE[row.cls], hf)),
    hf('p', { class: 'pg-item-text' }, row.subject),
    ...(extra.length > 0 ? [hf('div', { class: 'pg-actions' }, ...extra)] : []),
  );
}

export function renderInbox(host: HTMLElement, deps: PageDeps): () => void {
  const { store } = deps;
  const list = h('ul', { class: 'pg-list', role: 'list', 'aria-label': 'Messages' });
  host.replaceChildren(h('section', { class: 'pg' },
    h('header', { class: 'pg-head' }, h('div', { class: 'pg-head-text' }, pageTitle('Inbox'), h('p', { class: 'pg-sub' }, `${INBOX.length} messages Echo has read`))),
    list,
  ));
  let last = '';
  const draw = (): void => {
    const rows = inboxRows(INBOX, store);
    const key = JSON.stringify(rows);
    if (key === last) return;
    last = key;
    list.replaceChildren(...rows.map((r) => inboxItem(r)));
  };
  draw();
  const unsubscribe = store.subscribe(() => {
    try {
      draw();
    } catch (err) {
      console.warn('[hq] inbox could not update', err);
    }
  });
  return unsubscribe;
}
