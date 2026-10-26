// The island's status pills: four small facts (what waits for you, what runs next, today's spend, Scout's leads) and the
// brief alert that says a run just ended. Pure (no DOM): the island draws what these return.
import { ROSTER } from '../roster';
import { DEMO_DAY } from '../demo/script';
import { formatZar } from './pages/spend';
import type { DashStore } from './store';

export type PillId = 'spend' | 'leads' | 'waiting' | 'next';

export interface PillView {
  id: PillId;
  label: string;
  value: string;
  tone: 'calm' | 'busy' | 'warn' | 'bad';
}

export const PILL_IDS: readonly PillId[] = ['spend', 'leads', 'waiting', 'next'];
export const DEFAULT_PILLS: PillId[] = ['waiting', 'next', 'spend', 'leads'];

export const isPillId = (x: unknown): x is PillId => typeof x === 'string' && (PILL_IDS as readonly string[]).includes(x);

/** Keeps only known ids, each once, in the order given. */
export function cleanPillOrder(ids: readonly unknown[]): PillId[] {
  const out: PillId[] = [];
  for (const id of ids) if (isPillId(id) && !out.includes(id)) out.push(id);
  return out;
}

const clock = (hour: number): string => {
  const mins = Math.round(hour * 60) % (24 * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
};

const nameOf = (id: string): string => ROSTER.find((a) => a.id === id)?.name ?? id;

/** The next run still to start today, from the scripted day. */
function nextRun(hour: number): { agent: string; at: number } | undefined {
  for (const s of DEMO_DAY) if (s.event.type === 'run_started' && s.atHour > hour) return { agent: s.event.agent, at: s.atHour };
  return undefined;
}

function view(id: PillId, store: DashStore, hour: number): PillView {
  switch (id) {
    case 'spend': {
      let usd = 0;
      for (const v of store.spendToday().values()) usd += v;
      return { id, label: 'Spend', value: formatZar(usd), tone: 'calm' };
    }
    case 'leads':
      return { id, label: 'Leads', value: String(store.lastProgressOf('scout')?.done ?? 0), tone: store.hasOpenRun('scout') ? 'busy' : 'calm' };
    case 'waiting': {
      const n = store.drafts({ status: 'waiting' }).length;
      return { id, label: 'Waiting', value: String(n), tone: n > 0 ? 'warn' : 'calm' };
    }
    case 'next': {
      const n = nextRun(hour);
      return { id, label: 'Next', value: n ? `${nameOf(n.agent)} ${clock(n.at)}` : '—', tone: 'calm' };
    }
  }
}

/** The pills to show, in `order`. Unknown ids are dropped and a repeat shows once. */
export function pillViews(store: DashStore, hour: number, order: PillId[]): PillView[] {
  return cleanPillOrder(order).map((id) => view(id, store, hour));
}

// ---- the brief "<Name> finished" alert

export interface PillAlert {
  text: string;
  tone: 'calm' | 'bad';
}

export const ALERT_MS = 2000;

export const runAlert = (name: string, failed: boolean): PillAlert =>
  failed ? { text: `${name} failed`, tone: 'bad' } : { text: `${name} finished`, tone: 'calm' };

/**
 * Alerts shown one at a time, two seconds each, in arrival order. The clock is injected. Each alert's turn is counted
 * from when the one before it ended, not from when anyone looked, so a late look still lands on the right one.
 */
export class AlertQueue {
  private items: PillAlert[] = [];
  private startedAt = 0;

  constructor(private readonly now: () => number, private readonly ttl: number = ALERT_MS) {}

  push(alert: PillAlert): void {
    this.advance();
    if (this.items.length === 0) this.startedAt = this.now();
    this.items.push(alert);
  }

  current(): PillAlert | undefined {
    this.advance();
    return this.items[0];
  }

  /** Milliseconds the showing alert has left; 0 when none is showing. */
  msLeft(): number {
    this.advance();
    return this.items.length === 0 ? 0 : this.startedAt + this.ttl - this.now();
  }

  clear(): void {
    this.items = [];
  }

  private advance(): void {
    while (this.items.length > 0 && this.now() - this.startedAt >= this.ttl) {
      this.items.shift();
      this.startedAt += this.ttl;
    }
  }
}
