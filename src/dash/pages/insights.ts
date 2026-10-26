// Insights: how much time the team's approved work saved, your streak of days with an approval, and a weekly recap card
// you can download as a picture. Everything is counted in this browser and nothing is sent anywhere.
import { h } from '../dom';
import { ROSTER } from '../../roster';
import { approvalCounts, formatMinutes, localToday, streak, timeSaved } from '../insights';
import { RECAP_FILENAME, drawRecap, recapData, recapLines } from '../recap';
import { pageTitle, safely } from './common';
import type { PageDeps } from './common';

export const PRIVACY_NOTE = 'Counted in your browser, never sent anywhere.';

/** Hands the card to the browser as a PNG file. */
function downloadCanvas(canvas: HTMLCanvasElement): void {
  canvas.toBlob((blob) => {
    if (!blob) {
      console.warn('[hq] the recap card could not be turned into a picture');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: RECAP_FILENAME, hidden: '' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

const tile = (value: HTMLElement, label: string, extra = ''): HTMLElement =>
  h('div', { class: `ins-tile${extra}` }, value, h('span', { class: 'ins-tile-label' }, label));

export function renderInsights(host: HTMLElement, deps: PageDeps): () => void {
  const { store } = deps;
  let alive = true;

  const sub = h('p', { class: 'pg-sub' });
  const savedValue = h('span', { class: 'ins-tile-value bz-display' }, '0 min');
  const streakValue = h('span', { class: 'ins-tile-value bz-display' }, '0');
  const approvedValue = h('span', { class: 'ins-tile-value bz-display' }, '0');
  const tiles = h('div', { class: 'ins-tiles' },
    tile(savedValue, 'time saved by hand-work you skipped', ' ins-tile-hero'),
    tile(streakValue, 'day streak'),
    tile(approvedValue, 'approved'),
  );

  const agentList = h('ul', { class: 'ins-agents' });
  const agentEmpty = h('p', { class: 'pg-empty' }, 'Nothing approved yet. Time saved shows up here as you approve the team’s work.');

  const canvas = h('canvas', {
    class: 'ins-canvas',
    role: 'img',
    'aria-label': 'Your weekly recap card',
  }) as HTMLCanvasElement;
  const hide = h('input', { type: 'checkbox', id: 'ins-hide', class: 'ins-check' }) as HTMLInputElement;
  const hideLabel = h('label', { class: 'ins-hide', for: 'ins-hide' }, hide, h('span', {}, 'Hide client names'));
  const download = h('button', { type: 'button', class: 'pg-btn pg-btn-gold' }, 'Download PNG');

  host.replaceChildren(h('section', { class: 'pg' },
    h('header', { class: 'pg-head' }, h('div', { class: 'pg-head-text' }, pageTitle('Insights'), sub)),
    tiles,
    h('div', { class: 'pg-block' },
      h('h2', { class: 'pg-h2 bz-display' }, 'Where the time came from'),
      agentEmpty,
      agentList,
    ),
    h('div', { class: 'pg-block' },
      h('h2', { class: 'pg-h2 bz-display' }, 'Weekly recap'),
      h('div', { class: 'ins-card-wrap' }, canvas),
      h('div', { class: 'pg-tools ins-tools' }, hideLabel, download),
    ),
    h('p', { class: 'pg-note' }, `Time saved assumes what each kind of draft would take a person by hand: an email 12 min, a proposal 45, a post 20, a LinkedIn note 10, a comment 4, a content plan 90. ${PRIVACY_NOTE}`),
  ));

  let last = '';
  const draw = (force = false): void => {
    const counts = approvalCounts();
    const today = localToday();
    const saved = timeSaved(store);
    const run = streak(Object.keys(counts), today);
    const data = recapData(store, counts);
    const opts = { hideClients: hide.checked };
    const lines = recapLines(data, opts);
    const key = `${lines.join('|')}#${run}#${[...saved.byAgent].join(',')}`;
    if (!force && key === last) return;
    last = key;

    savedValue.textContent = formatMinutes(saved.minutes);
    streakValue.textContent = String(run);
    approvedValue.textContent = String(data.approved);
    sub.textContent = run > 0
      ? `${formatMinutes(saved.minutes)} saved so far, on a ${run}-day approval streak`
      : `${formatMinutes(saved.minutes)} saved so far. Approve a draft today to count toward your streak (the demo's scripted approvals count too).`;

    const rows = ROSTER.map((a) => ({ id: a.id, name: a.name, minutes: saved.byAgent.get(a.id) ?? 0 }))
      .filter((r) => r.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes);
    const top = rows[0]?.minutes ?? 1;
    agentList.replaceChildren(...rows.map((r) => h('li', { class: 'ins-agent', 'data-id': r.id },
      h('span', { class: 'ins-agent-name' }, r.name),
      h('span', { class: 'ins-bar', 'aria-hidden': 'true' }, h('span', { class: 'ins-bar-fill', style: `--w:${Math.max(4, Math.round((r.minutes / top) * 100))}%` })),
      h('span', { class: 'ins-agent-min' }, formatMinutes(r.minutes)),
    )));
    agentEmpty.hidden = rows.length > 0;
    agentList.hidden = rows.length === 0;

    drawRecap(canvas, data, opts);
  };
  draw(true);

  // The web fonts may land after the first draw; paint the card again once they have.
  try {
    void document.fonts?.ready.then(() => { if (alive) safely('recap redraw', () => draw(true))(); });
  } catch {
    // no font loading API: the fallback fonts already drew the card
  }

  hide.addEventListener('change', safely('hide client names', () => draw(true)));
  download.addEventListener('click', safely('download recap', () => downloadCanvas(canvas)));

  const unsub = store.subscribe(() => {
    // The approval day is noted just after the store accepts the event, so look again once that has happened.
    queueMicrotask(() => {
      if (!alive) return;
      try {
        draw();
      } catch (err) {
        console.warn('[hq] insights could not update', err);
      }
    });
  });
  return () => {
    alive = false;
    unsub();
  };
}
