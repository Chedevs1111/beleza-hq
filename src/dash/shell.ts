// The dashboard shell, built around the live 3D office. Home: the office fills the window and glass sits only at the
// edges (sidebar left, island top, team bar bottom). Every other page: a glass main column on the left and the office
// still animating in a right-hand live column (hidden under 720 px, where the page takes the screen).
// Layout lives in shell.css; this file owns routing, the DOM and the measuring that tells main.ts how to frame the world.
import { frameFor, homeInsets, viewZoom } from './frame';
import type { WorldFrame } from './frame';
import type { Layers } from './layers';
import { ease, installSprings, reducedMotion } from './motion';
import { shouldOpenWelcome } from './onboarding';
import { onboarded, setOnboarded } from './prefs';

export { frameFor } from './frame';

export type PageId = 'home' | 'approvals' | 'leads' | 'content' | 'inbox' | 'activity' | 'insights' | 'spend' | 'settings' | 'welcome';

/** `icon` is the `d` of a 24x24 stroked SVG path. */
export const NAV: { id: PageId; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { id: 'approvals', label: 'Approvals', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.5l2.7 2.7L16 9.8' },
  { id: 'leads', label: 'Leads', icon: 'M3 5h18l-7 8v6l-4 2v-8z' },
  { id: 'content', label: 'Content', icon: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6' },
  { id: 'inbox', label: 'Inbox', icon: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5' },
  { id: 'activity', label: 'Activity', icon: 'M3 12h4l3-8 4 16 3-8h4' },
  { id: 'insights', label: 'Insights', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { id: 'spend', label: 'Spend', icon: 'M12 3v18M16 7.5c0-1.7-1.8-3-4-3s-4 1.1-4 2.8 1.6 2.5 4 3.2 4 1.5 4 3.3-1.8 2.7-4 2.7-4-1.3-4-3' },
  { id: 'settings', label: 'Settings', icon: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6' },
];

/** Under 720 px the sidebar is a bottom tab bar of these four pages plus a fifth tab, More, for everything else. */
export const PHONE_TABS: readonly PageId[] = ['home', 'approvals', 'content', 'activity'];

const SETUP_LABEL = 'Set up connections';
const COMMANDS_ICON = 'M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3';
const SETUP_ICON = 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1';

/** What the More sheet lists: the pages that are not tabs, then Commands (the ⌘K bar, which a phone has no key for), then the welcome wizard. */
export function moreItems(): { id: PageId | 'commands'; label: string }[] {
  return [
    ...NAV.filter((n) => !PHONE_TABS.includes(n.id)).map(({ id, label }) => ({ id, label })),
    { id: 'commands', label: 'Commands' },
    { id: 'welcome', label: SETUP_LABEL },
  ];
}

// `welcome` is a page but not a sidebar entry: first visit, Settings and the ⌘K bar lead to it.
const PAGE_IDS: ReadonlySet<string> = new Set<string>([...NAV.map((n) => n.id), 'welcome']);

/** The query name for a page's one filter: an agent everywhere, a wizard step on the welcome page. */
const filterParam = (page: PageId): string => (page === 'welcome' ? 'step' : 'agent');

/** `#/content?agent=muse` -> `{ page: 'content', filter: 'muse' }`; `#/welcome?step=email` -> filter 'email'. Anything unknown is Home. */
export function parseRoute(hash: string): { page: PageId; filter?: string } {
  const [path, query = ''] = hash.replace(/^#/, '').split('?', 2);
  const seg = path.split('/').filter(Boolean)[0] ?? 'home';
  const page = (PAGE_IDS.has(seg) ? seg : 'home') as PageId;
  const filter = new URLSearchParams(query).get(filterParam(page));
  return filter ? { page, filter } : { page };
}

function buildHash(page: PageId, filter?: string): string {
  if (page === 'home' && !filter) return '#/';
  return `#/${page}${filter ? `?${filterParam(page)}=${encodeURIComponent(filter)}` : ''}`;
}

/** Renders a real page into the main column; returns its unmount (unsubscribe, drop layers). */
export type PageMount = (host: HTMLElement, filter?: string) => () => void;

export interface Dashboard {
  /** Holds the canvas. Full window on Home, the live column elsewhere. */
  worldHost: HTMLElement;
  clockHost: HTMLElement;
  teamHost: HTMLElement;
  islandHost: HTMLElement;
  /** The glass main column (hidden on Home). Pages render into it. */
  pageHost: HTMLElement;
  page(): PageId;
  /** Replaces a page's placeholder with a real page. Mounts at once if that page is showing. */
  setPage(id: Exclude<PageId, 'home'>, mount: PageMount): void;
  go(p: PageId, filter?: string): void;
  /** Where to put the world: shift into the clear middle, zoom out in a narrow view. */
  frame(): WorldFrame;
  /** The agent card reports the width it covers here. */
  setInset(side: 'right', px: number): void;
  setLite(on: boolean): void;
  /** Fires on route changes, window resizes and panel size changes. Returns an unsubscribe function. */
  onLayout(cb: () => void): () => void;
  /** False when the live column is hidden (a page under 720 px wide): nothing to draw. */
  worldVisible(): boolean;
}

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(d: string): SVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'bz-nav-icon');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

/** The "coming next" line each page placeholder shows until its real page lands. */
const COMING: Record<Exclude<PageId, 'home'>, string> = {
  approvals: 'Coming next: drafts and spend waiting for a decision.',
  leads: 'Coming next: new leads and where each one stands.',
  content: 'Coming next: posts in progress, scheduled and published.',
  inbox: 'Coming next: replies and messages that need a person.',
  activity: 'Coming next: everything the team did, as it happens.',
  insights: 'Coming next: time saved, your streak and a weekly recap card.',
  spend: 'Coming next: what the team has spent against its budget.',
  settings: 'Coming next: limits, rules and preferences.',
  welcome: 'Coming next: set up email, social networks and your website.',
};

export interface DashboardOptions {
  /** The Esc stack. The More sheet is a layer, so Esc (handled once, in main.ts) closes it. */
  layers?: Layers;
  /** The More sheet's Commands row: opens the ⌘K bar. */
  onCommands?: () => void;
}

export function createDashboard(root: HTMLElement, opts: DashboardOptions = {}): Dashboard {
  root.classList.add('bz-shell');
  installSprings(root);

  const worldHost = el('div', 'bz-world');
  const sidebar = el('nav', 'bz-sidebar glass');
  sidebar.setAttribute('aria-label', 'Dashboard');
  const clockHost = el('div', 'bz-clock');
  const list = el('ul', 'bz-nav');
  const links = new Map<PageId, HTMLAnchorElement>();
  for (const n of NAV) {
    const li = el('li');
    if (!PHONE_TABS.includes(n.id)) li.dataset.more = ''; // on a phone these live in the More sheet, not the tab bar
    const a = el('a', 'bz-nav-link');
    a.href = buildHash(n.id);
    a.append(icon(n.icon), el('span', 'bz-nav-label', n.label));
    a.title = n.label;
    links.set(n.id, a);
    li.append(a);
    list.append(li);
  }
  // The fifth tab (phones only; shell.css hides it on a wide window) opens the More sheet.
  const moreTab = el('button', 'bz-nav-link bz-more-tab');
  moreTab.type = 'button';
  moreTab.setAttribute('aria-haspopup', 'dialog');
  moreTab.setAttribute('aria-expanded', 'false');
  moreTab.append(icon('M5 12h.01M12 12h.01M19 12h.01'), el('span', 'bz-nav-label', 'More'));
  const moreLi = el('li', 'bz-nav-more');
  moreLi.append(moreTab);
  list.append(moreLi);
  const brand = el('div', 'bz-brand');
  brand.append(el('span', 'bz-brand-mark', 'b'), el('span', 'bz-brand-name bz-display', 'Beleza HQ'));
  sidebar.append(brand, clockHost, list);

  const islandHost = el('div', 'bz-island');
  const pageHost = el('main', 'bz-main glass');
  pageHost.hidden = true;
  const teamHost = el('div', 'bz-team-host');

  // The More sheet: a scrim and one glass panel, siblings (the scrim never fades, so nothing animates opacity or filter
  // above the panel's blur). Only the panel's own transform moves, and not under reduced motion.
  const moreWrap = el('div', 'bz-more');
  moreWrap.hidden = true;
  const moreScrim = el('button', 'bz-more-scrim');
  moreScrim.type = 'button';
  moreScrim.tabIndex = -1;
  moreScrim.setAttribute('aria-label', 'Close menu');
  const moreSheet = el('div', 'bz-more-sheet glass');
  moreSheet.setAttribute('role', 'dialog');
  moreSheet.setAttribute('aria-modal', 'true');
  moreSheet.setAttribute('aria-label', 'More');
  const moreList = el('ul', 'bz-more-list');
  const moreLinks: HTMLElement[] = [];
  for (const m of moreItems()) {
    const li = el('li');
    if (m.id === 'commands') {
      // Not a page: a button that closes the sheet and opens the command bar (focus goes back to More first, so the bar returns there).
      const b = el('button', 'bz-more-link');
      b.type = 'button';
      b.append(icon(COMMANDS_ICON), el('span', undefined, m.label));
      b.addEventListener('click', () => {
        closeMore(true);
        opts.onCommands?.();
      });
      moreLinks.push(b);
      li.append(b);
      moreList.append(li);
      continue;
    }
    const a = el('a', 'bz-more-link');
    a.href = buildHash(m.id);
    a.append(icon(m.id === 'welcome' ? SETUP_ICON : NAV.find((n) => n.id === m.id)?.icon ?? ''), el('span', undefined, m.label));
    a.addEventListener('click', () => closeMore(true)); // the same page again changes no hash, so close here as well
    moreLinks.push(a);
    li.append(a);
    moreList.append(li);
  }
  moreSheet.append(el('span', 'bz-sheet-grip'), el('h2', 'bz-more-title bz-display', 'More'), moreList);
  moreWrap.append(moreScrim, moreSheet);
  root.append(worldHost, sidebar, islandHost, pageHost, teamHost, moreWrap);

  let page: PageId = 'home';
  let filter: string | undefined;
  let rightInset = 0;
  const mounts = new Map<PageId, PageMount>();
  let unmount: (() => void) | undefined;
  const layoutListeners = new Set<() => void>();
  const emit = () => { for (const cb of [...layoutListeners]) cb(); };

  const wide = () => innerWidth >= 720;

  let moreOpen = false;
  let dropMoreLayer: (() => void) | undefined;
  /** What was made inert behind the open sheet (the sheet is modal: nothing behind it takes focus or clicks). */
  let inerted: HTMLElement[] = [];
  function closeMore(refocus: boolean): void {
    if (!moreOpen) return;
    moreOpen = false;
    dropMoreLayer?.();
    dropMoreLayer = undefined;
    for (const node of inerted) node.inert = false;
    inerted = [];
    moreWrap.hidden = true;
    moreTab.setAttribute('aria-expanded', 'false');
    if (refocus) moreTab.focus({ preventScroll: true });
  }
  function openMore(): void {
    if (moreOpen || wide()) return;
    moreOpen = true;
    dropMoreLayer = opts.layers?.push('more', () => closeMore(true));
    moreWrap.hidden = false;
    inerted = [...root.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c !== moreWrap);
    for (const node of inerted) node.inert = true;
    moreTab.setAttribute('aria-expanded', 'true');
    if (!reducedMotion()) {
      const { easing, ms } = ease('bounce');
      moreSheet.animate([{ transform: 'translateY(32px)' }, { transform: 'none' }], { duration: ms, easing });
    }
    moreLinks[0]?.focus({ preventScroll: true });
  }
  moreTab.addEventListener('click', () => (moreOpen ? closeMore(true) : openMore()));
  moreScrim.addEventListener('click', () => closeMore(true));

  // The on-screen keyboard covers the bottom of the layout viewport; sheets with a text box lift by this much (phone.css).
  try {
    const vv = window.visualViewport;
    if (vv) {
      const lift = () => document.documentElement.style.setProperty('--bz-kb', `${Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop))}px`);
      vv.addEventListener('resize', lift);
      vv.addEventListener('scroll', lift);
    }
  } catch (err) {
    console.warn('[hq] keyboard tracking unavailable', err);
  }

  function renderPlaceholder(p: Exclude<PageId, 'home'>): void {
    const label = NAV.find((n) => n.id === p)?.label ?? p;
    const title = el('h1', 'bz-page-title bz-display', label);
    title.tabIndex = -1;
    pageHost.replaceChildren(title, el('p', 'bz-page-note', COMING[p]));
    pageHost.setAttribute('aria-label', label);
  }

  /** Mounts the real page when there is one (a page that throws falls back to its placeholder), else the placeholder. */
  function unmountPage(): void {
    try {
      unmount?.();
    } catch (err) {
      console.warn('[hq] page unmount failed', err);
    }
    unmount = undefined;
  }

  function renderPage(p: Exclude<PageId, 'home'>): void {
    unmountPage();
    const mount = mounts.get(p);
    if (mount) {
      try {
        pageHost.replaceChildren();
        pageHost.setAttribute('aria-label', NAV.find((n) => n.id === p)?.label ?? p);
        unmount = mount(pageHost, filter);
        return;
      } catch (err) {
        console.warn('[hq] page could not open', err);
      }
    }
    renderPlaceholder(p);
  }

  function apply(first: boolean): void {
    const route = parseRoute(location.hash);
    const next = route.page;
    if (!first && next === page && route.filter === filter) return;
    const pageChanged = next !== page;
    page = next;
    filter = route.filter;
    root.dataset.page = page;
    for (const [id, a] of links) {
      if (id === page) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    // A page that is not a tab (Leads, Settings, the welcome wizard...) lights the More tab; navigating closes the sheet.
    moreTab.dataset.on = String(!PHONE_TABS.includes(page));
    closeMore(false);
    pageHost.hidden = page === 'home';
    if (page !== 'home') {
      renderPage(page);
      // Only the panel's own transform moves: no opacity or filter on a backdrop-filter panel.
      if (!first && pageChanged && !reducedMotion()) {
        const { easing, ms } = ease('smooth');
        pageHost.animate([{ transform: 'translateY(14px) scale(0.99)' }, { transform: 'none' }], { duration: ms, easing });
      }
      if (!first) pageHost.querySelector<HTMLElement>('.bz-page-title')?.focus({ preventScroll: true });
    } else {
      unmountPage(); // Home: a page must not keep listening to the store or hold an editor layer
    }
    emit();
  }

  const onHash = () => apply(false);
  addEventListener('hashchange', onHash);
  // First visit to the bare address: open the welcome wizard once. replaceState keeps Back from returning to a blank Home.
  try {
    if (shouldOpenWelcome(location.hash, onboarded())) {
      history.replaceState(null, '', '#/welcome');
      setOnboarded();
    }
  } catch (err) {
    console.warn('[hq] welcome could not open', err);
  }
  apply(true);

  // Anything that changes a panel's size changes the clear middle.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(emit);
    for (const node of [worldHost, sidebar, islandHost, teamHost]) ro.observe(node);
  }
  addEventListener('resize', () => {
    if (wide()) closeMore(false); // grown into the wide layout: the sheet has no home there
    emit();
  });

  function visible(node: HTMLElement): DOMRect | null {
    if (node.hidden || node.childElementCount === 0) return null;
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  }

  return {
    worldHost, clockHost, teamHost, islandHost, pageHost,
    page: () => page,
    setPage(id, mount) {
      mounts.set(id, mount);
      if (page === id) renderPage(id);
    },
    go(p, f) {
      const hash = buildHash(p, f);
      if (location.hash !== hash) location.hash = hash;
    },
    frame() {
      const w = worldHost.getBoundingClientRect();
      const width = w.width || innerWidth;
      const height = w.height || innerHeight;
      if (page !== 'home') return { ...frameFor({ width, height, left: 0, right: 0, top: 0, bottom: 0 }), zoom: viewZoom(width, height) };
      // Home: the office is the whole window; the glass at its edges is what the picture slides away from.
      // On a phone the sidebar is the tab bar along the bottom edge, not a left panel (homeInsets knows the difference).
      const insets = homeInsets({
        width, height, phone: !wide(), right: rightInset,
        sidebar: sidebar.getBoundingClientRect(),
        island: visible(islandHost),
        team: visible(teamHost),
      });
      return { ...frameFor(insets), zoom: viewZoom(width - insets.left, height) };
    },
    setInset(_side, px) {
      const v = Number.isFinite(px) && px > 0 ? Math.round(px) : 0;
      if (v === rightInset) return;
      rightInset = v;
      emit();
    },
    setLite(on) {
      root.classList.toggle('lite', on);
    },
    onLayout(cb) {
      layoutListeners.add(cb);
      return () => layoutListeners.delete(cb);
    },
    worldVisible: () => page === 'home' || wide(),
  };
}
