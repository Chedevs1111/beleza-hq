// Content: Muse's week by day, and the post, LinkedIn and comment drafts with where each one stands.
// `filter` (an agent id from #/content?agent=muse) narrows both.
import { h } from '../dom';
import type { HFn } from '../dom';
import { ROSTER } from '../../roster';
import { SCHEDULE } from '../sample';
import type { ScheduleItem } from '../sample';
import { contentItems } from '../rows';
import type { ContentDraft } from '../rows';
import { agentFilter, chip, pageTitle } from './common';
import type { PageDeps } from './common';

const CHANNEL_LABEL: Record<ScheduleItem['channel'], string> = {
  email: 'Email',
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
};

const STATUS_TONE: Record<ContentDraft['status'], string> = {
  checking: 'kind',
  returned: 'warn',
  waiting: 'gold',
  approved: 'ok',
  rejected: 'warn',
  sent: 'ok',
};

export function weekItem(item: ScheduleItem, hf: HFn = h): HTMLElement {
  return hf(
    'li',
    { class: 'pg-day' },
    hf('span', { class: 'pg-day-name' }, item.day),
    chip(CHANNEL_LABEL[item.channel], 'kind', hf),
    hf('span', { class: 'pg-hook' }, item.hook),
  );
}

export function draftItem(d: ContentDraft, hf: HFn = h): HTMLElement {
  return hf(
    'li',
    { class: 'pg-item', 'data-id': d.id },
    hf('div', { class: 'pg-card-head' },
      hf('span', { class: 'pg-agent' }, d.agentName),
      chip(d.kindLabel, 'kind', hf),
      chip(d.statusLabel, STATUS_TONE[d.status], hf),
      hf('span', { class: 'pg-time' }, d.time),
    ),
    hf('p', { class: 'pg-item-text' }, d.summary),
  );
}

export function renderContent(host: HTMLElement, deps: PageDeps): () => void {
  const { store } = deps;
  const filter = agentFilter(deps.filter); // only a name on the roster narrows the page
  const who = filter ? ROSTER.find((a) => a.id === filter)?.name : undefined;

  const weekList = h('ol', { class: 'pg-week', 'aria-label': "Muse's week" });
  const weekSection = h('section', { class: 'pg-block' }, h('h2', { class: 'pg-h2 bz-display' }, "Muse's week"), weekList);
  const draftList = h('ul', { class: 'pg-list', role: 'list', 'aria-label': 'Posts and replies' });
  const noDrafts = h('p', { class: 'pg-empty' }, 'No posts or replies yet. They show up here as the team drafts them.');
  const draftSection = h('section', { class: 'pg-block' }, h('h2', { class: 'pg-h2 bz-display' }, 'Posts and replies'), draftList, noDrafts);
  const note = who
    ? h('p', { class: 'pg-sub' }, `Showing ${who}'s work. `, h('a', { href: '#/content', class: 'pg-link' }, 'Show everyone'))
    : h('p', { class: 'pg-sub' }, 'Next week as planned, and what has been drafted.');
  host.replaceChildren(h('section', { class: 'pg' }, h('header', { class: 'pg-head' }, h('div', { class: 'pg-head-text' }, pageTitle('Content'), note)), weekSection, draftSection));

  let last = '';
  const draw = (): void => {
    const items = contentItems(store, SCHEDULE, filter);
    const key = JSON.stringify(items);
    if (key === last) return;
    last = key;
    weekSection.hidden = items.week.length === 0;
    weekList.replaceChildren(...items.week.map((w) => weekItem(w)));
    draftList.replaceChildren(...items.drafts.map((d) => draftItem(d)));
    draftList.hidden = items.drafts.length === 0;
    noDrafts.hidden = items.drafts.length > 0;
  };
  draw();
  const unsubscribe = store.subscribe(() => {
    try {
      draw();
    } catch (err) {
      console.warn('[hq] content could not update', err);
    }
  });
  return unsubscribe;
}
