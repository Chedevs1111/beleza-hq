// Activity: everything the team did, newest first, with an agent filter (#/activity?agent=scout) and a CSV export of
// what is on screen.
import { h } from '../dom';
import { ROSTER } from '../../roster';
import type { AgentId } from '../../types';
import { toCsv } from '../csv';
import { hourLabel } from '../rows';
import type { DashStore } from '../store';
import { agentFilter, pageTitle, safely } from './common';
import type { PageDeps } from './common';

export const CSV_FILENAME = 'beleza-activity-demo.csv';

export interface ActivityRow {
  agent: AgentId;
  agentName: string;
  text: string;
  at: number;
  time: string;
}

const nameOf = (a: AgentId): string => ROSTER.find((r) => r.id === a)?.name ?? a;

/** The store's log newest first (a later arrival wins a tie); `agent` keeps just that agent. */
export function activityRows(store: DashStore, agent?: string): ActivityRow[] {
  return store
    .activity()
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => agent === undefined || e.agent === agent)
    .sort((a, b) => b.e.at - a.e.at || b.i - a.i)
    .map(({ e }) => ({ agent: e.agent, agentName: nameOf(e.agent), text: e.text, at: e.at, time: hourLabel(e.at) }));
}

export const activityCsvRows = (rows: readonly ActivityRow[]): string[][] => [
  ['time', 'agent', 'text'],
  ...rows.map((r) => [r.time, r.agentName, r.text]),
];

/** Hands a CSV to the browser as a file. A leading byte-order mark lets spreadsheets read the dashes as UTF-8. */
function download(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: filename, hidden: '' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function renderActivity(host: HTMLElement, deps: PageDeps): () => void {
  const { store } = deps;
  let agent: string | undefined = agentFilter(deps.filter);

  const select = h('select', { class: 'pg-select', id: 'pg-act-agent', 'aria-label': 'Show activity for' },
    h('option', { value: '' }, 'All agents'),
    ...ROSTER.map((a) => h('option', { value: a.id }, a.name)),
  ) as HTMLSelectElement;
  select.value = agent ?? '';
  const exportBtn = h('button', { type: 'button', class: 'pg-btn pg-btn-gold' }, 'Export CSV');
  const count = h('p', { class: 'pg-sub' });
  const empty = h('p', { class: 'pg-empty' }, 'Nothing yet. The team’s day shows up here as it happens.');
  const body = h('tbody');
  const head = h('tr', {}, ...['Time', 'Agent', 'What happened'].map((t) => h('th', { scope: 'col' }, t)));
  const table = h('table', { class: 'pg-table pg-activity' }, h('caption', { class: 'pg-sr' }, 'Team activity, newest first'), h('thead', {}, head), body);
  const scroll = h('div', { class: 'pg-scroll', tabindex: '0', role: 'region', 'aria-label': 'Activity table' }, table);
  host.replaceChildren(h('section', { class: 'pg' },
    h('header', { class: 'pg-head' },
      h('div', { class: 'pg-head-text' }, pageTitle('Activity'), count),
      h('div', { class: 'pg-tools' }, select, exportBtn),
    ),
    empty,
    scroll,
  ));

  let shown: ActivityRow[] = [];
  let last = '';
  const draw = (force = false): void => {
    const rows = activityRows(store, agent);
    const key = `${agent ?? ''}|${rows.length}|${rows[0]?.text}|${rows[rows.length - 1]?.text}`;
    if (!force && key === last) return;
    last = key;
    shown = rows;
    body.replaceChildren(...rows.map((r) => h('tr', { class: 'pg-tr' },
      h('td', { class: 'pg-time-cell' }, r.time),
      h('th', { scope: 'row', class: 'pg-th-row' }, r.agentName),
      h('td', {}, r.text),
    )));
    empty.hidden = rows.length > 0;
    scroll.hidden = rows.length === 0;
    exportBtn.toggleAttribute('disabled', rows.length === 0);
    const who = agent ? `${nameOf(agent as AgentId)}: ` : '';
    count.textContent = `${who}${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}, newest first`;
  };
  draw(true);

  select.addEventListener('change', safely('activity filter', () => {
    agent = select.value || undefined;
    draw(true);
  }));
  exportBtn.addEventListener('click', safely('export CSV', () => download(CSV_FILENAME, toCsv(activityCsvRows(shown)))));

  return store.subscribe(() => {
    try {
      draw();
    } catch (err) {
      console.warn('[hq] activity could not update', err);
    }
  });
}
