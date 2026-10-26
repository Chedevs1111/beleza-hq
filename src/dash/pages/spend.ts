// Spend: what each agent has cost today in the demo day, a month estimate, and the total. Rand figures use a fixed
// demo rate that is stated under the table.
import { h } from '../dom';
import { ROSTER } from '../../roster';
import type { Agent, AgentId } from '../../types';
import type { DashStore } from '../store';
import { pageTitle } from './common';
import type { PageDeps } from './common';

export const USD_ZAR = 18.5;
export const WORKING_DAYS = 22;

export interface SpendRow {
  agent: AgentId;
  name: string;
  today: number;
  /** today x WORKING_DAYS: an estimate, not a forecast. */
  month: number;
}

/** One row per agent in roster order (an agent with no spend shows zero). */
export function spendRows(store: DashStore, roster: readonly Agent[]): SpendRow[] {
  const today = store.spendToday();
  return roster.map((a) => {
    const t = today.get(a.id) ?? 0;
    return { agent: a.id, name: a.name, today: t, month: t * WORKING_DAYS };
  });
}

export const formatUsd = (usd: number): string => `$${usd.toFixed(2)}`;
export const formatZar = (usd: number): string => `R${(usd * USD_ZAR).toFixed(2)}`;

const money = (usd: number, cls = 'pg-num'): HTMLElement =>
  h('td', { class: cls }, h('span', { class: 'pg-usd' }, formatUsd(usd)), h('span', { class: 'pg-zar' }, formatZar(usd)));

export function renderSpend(host: HTMLElement, deps: PageDeps): () => void {
  const { store } = deps;
  const body = h('tbody');
  const foot = h('tfoot');
  const monthHead = h('th', { scope: 'col', class: 'pg-num' }, 'Month', h('span', { class: 'pg-th-sub' }, 'Demo estimate (22 working days)'));
  const head = h('tr', {}, h('th', { scope: 'col' }, 'Agent'), h('th', { scope: 'col', class: 'pg-num' }, 'Today'), monthHead);
  const table = h('table', { class: 'pg-table pg-spend' }, h('caption', { class: 'pg-sr' }, 'What each agent has spent'), h('thead', {}, head), body, foot);
  const scroll = h('div', { class: 'pg-scroll', tabindex: '0', role: 'region', 'aria-label': 'Spend table' }, table);
  const sub = h('p', { class: 'pg-sub' });
  host.replaceChildren(h('section', { class: 'pg' },
    h('header', { class: 'pg-head' }, h('div', { class: 'pg-head-text' }, pageTitle('Spend'), sub)),
    scroll,
    h('p', { class: 'pg-note' }, `Month figures are today's spend × ${WORKING_DAYS} working days: a demo estimate, not a bill. Rand are converted at a fixed demo rate of R${USD_ZAR.toFixed(2)} to the dollar.`),
  ));

  let last = '';
  const draw = (): void => {
    const rows = spendRows(store, ROSTER);
    const key = rows.map((r) => r.today).join('|');
    if (key === last) return;
    last = key;
    const totalToday = rows.reduce((a, r) => a + r.today, 0);
    body.replaceChildren(...rows.map((r) => h('tr', { class: 'pg-tr', 'data-id': r.agent }, h('th', { scope: 'row', class: 'pg-th-row' }, r.name), money(r.today), money(r.month))));
    foot.replaceChildren(h('tr', { class: 'pg-total' }, h('th', { scope: 'row', class: 'pg-th-row' }, 'Total'), money(totalToday), money(totalToday * WORKING_DAYS)));
    sub.textContent = `${formatUsd(totalToday)} (${formatZar(totalToday)}) so far today`;
  };
  draw();
  return store.subscribe(() => {
    try {
      draw();
    } catch (err) {
      console.warn('[hq] spend could not update', err);
    }
  });
}
