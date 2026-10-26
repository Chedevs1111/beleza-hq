// Leads: a table of the leads Scout found, with a grade chip and a status chip on each row and a grade filter.
import { h } from '../dom';
import type { HFn } from '../dom';
import { LEADS } from '../sample';
import type { Grade } from '../sample';
import { leadRows } from '../rows';
import type { LeadRow } from '../rows';
import { chip, pageTitle } from './common';
import type { PageDeps } from './common';

const STATUS_TONE: Record<LeadRow['status'], string> = {
  new: 'new',
  checked: 'kind',
  emailed: 'gold',
  replied: 'ok',
  'do-not-contact': 'warn',
};

export function leadRow(row: LeadRow, hf: HFn = h): HTMLElement {
  return hf(
    'tr',
    { class: 'pg-tr', 'data-id': row.id },
    hf('th', { scope: 'row', class: 'pg-th-row' }, row.business),
    hf('td', {}, row.category),
    hf('td', {}, row.area),
    hf('td', {}, chip(`Grade ${row.grade}`, `grade-${row.grade.toLowerCase()}`, hf)),
    hf('td', {}, chip(row.statusLabel, STATUS_TONE[row.status], hf)),
    hf('td', {}, row.agentName),
  );
}

const FILTERS: { label: string; grade?: Grade }[] = [{ label: 'All' }, { label: 'A', grade: 'A' }, { label: 'B', grade: 'B' }, { label: 'C', grade: 'C' }];

export function renderLeads(host: HTMLElement, _deps: PageDeps): () => void {
  let grade: Grade | undefined;

  const count = h('p', { class: 'pg-sub', role: 'status', 'aria-live': 'polite' });
  const buttons = FILTERS.map((f) => {
    const b = h('button', { type: 'button', class: 'pg-btn pg-filter', 'aria-pressed': 'false', 'aria-label': f.grade ? `Grade ${f.grade} only` : 'All grades' }, f.label);
    b.addEventListener('click', () => {
      grade = f.grade;
      draw();
    });
    return b;
  });
  const group = h('div', { class: 'pg-filters', role: 'group', 'aria-label': 'Filter by grade' }, ...buttons);
  const body = h('tbody');
  const head = h('tr', {}, ...['Business', 'Category', 'Area', 'Grade', 'Status', 'Found by'].map((t) => h('th', { scope: 'col' }, t)));
  const table = h('table', { class: 'pg-table' }, h('caption', { class: 'pg-sr' }, 'Leads found by Scout'), h('thead', {}, head), body);
  const scroll = h('div', { class: 'pg-scroll', tabindex: '0', role: 'region', 'aria-label': 'Leads table' }, table);
  host.replaceChildren(h('section', { class: 'pg' },
    h('header', { class: 'pg-head' }, h('div', { class: 'pg-head-text' }, pageTitle('Leads'), count), group),
    scroll,
  ));

  function draw(): void {
    const rows = leadRows(LEADS, grade);
    body.replaceChildren(...rows.map((r) => leadRow(r)));
    count.textContent = grade ? `${rows.length} grade ${grade} leads` : `${rows.length} leads`;
    FILTERS.forEach((f, i) => buttons[i].setAttribute('aria-pressed', String(f.grade === grade)));
  }
  draw();
  return () => {};
}
