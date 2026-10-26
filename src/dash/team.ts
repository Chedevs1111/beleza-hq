// The team bar: all 15 as small round buttons along the bottom, each ringed to show what that person is doing.
// A compact glass pill so the office stays visible above it; it scrolls sideways when the window is narrow.
import { ROSTER } from '../roster';
import type { AgentId, ZoneId } from '../types';
import type { AgentStatus, DashStore } from './store';

/** The ring around each button. Parked is drawn dashed (island.css); the others solid. */
export const RING: Record<AgentStatus, { color: string; label: string }> = {
  working: { color: '#8b5cf6', label: 'Working' },
  waiting: { color: '#e9c26b', label: 'Waiting on you' },
  idle: { color: '#8c8798', label: 'Idle' },
  parked: { color: '#6f6a7b', label: 'Parked' },
  failed: { color: '#f0626c', label: 'Run failed' },
};

export interface TeamItem {
  id: AgentId;
  name: string;
  initials: string;
  zone: ZoneId;
  status: AgentStatus;
  /** "Scout — Working": the button's accessible name and tooltip. */
  label: string;
}

export const teamLabel = (name: string, status: AgentStatus): string => `${name} — ${RING[status].label}`;

/** Everyone in roster order with their current status. Initials are the first two letters (distinct across the roster). */
export function teamItems(store: DashStore): TeamItem[] {
  return ROSTER.map((a) => {
    const status = store.statusOf(a.id);
    return { id: a.id, name: a.name, initials: a.name.slice(0, 2), zone: a.zone, status, label: teamLabel(a.name, status) };
  });
}

export function createTeam(host: HTMLElement, deps: { store: DashStore; onPick(a: AgentId): void }): void {
  const { store, onPick } = deps;
  const nav = document.createElement('nav');
  nav.className = 'bz-team glass';
  nav.setAttribute('aria-label', 'Team');
  const buttons = new Map<AgentId, HTMLButtonElement>();

  const paint = (b: HTMLButtonElement, it: TeamItem): void => {
    b.dataset.status = it.status;
    b.style.setProperty('--ring', RING[it.status].color);
    b.setAttribute('aria-label', it.label);
    b.title = it.label;
  };

  for (const it of teamItems(store)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bz-t';
    b.dataset.zone = it.zone;
    const initials = document.createElement('span');
    initials.className = 'bz-t-initials';
    initials.textContent = it.initials;
    initials.setAttribute('aria-hidden', 'true');
    b.append(initials);
    paint(b, it);
    b.addEventListener('click', () => {
      try {
        onPick(it.id);
      } catch (err) {
        console.warn('[hq] could not open', it.id, err);
      }
    });
    buttons.set(it.id, b);
    nav.append(b);
  }
  host.append(nav);

  store.subscribe(() => {
    try {
      for (const it of teamItems(store)) {
        const b = buttons.get(it.id);
        if (b && b.dataset.status !== it.status) paint(b, it);
      }
    } catch (err) {
      console.warn('[hq] could not update the team bar', err);
    }
  });
}
