// Insights data: how much time the team's approved work saved, and the run of days with at least one approval.
// Pure (no three.js, no DOM). Approval days are remembered in this browser only; every storage access is guarded.
import type { AgentEvent, DraftKind } from '../events';
import type { AgentId } from '../types';
import type { DashStore } from './store';

/** What one finished draft of each kind would take a person by hand, in minutes. */
export const MINUTES_BY_HAND: Partial<Record<DraftKind, number>> = { email: 12, proposal: 45, post: 20, linkedin: 10, comment: 4, plan: 90 };

/** Sent or approved drafts times the minutes by kind, in total and per agent. */
export function timeSaved(store: DashStore): { minutes: number; byAgent: Map<AgentId, number> } {
  const byAgent = new Map<AgentId, number>();
  let minutes = 0;
  for (const d of store.drafts()) {
    if (d.status !== 'sent' && d.status !== 'approved') continue;
    const m = MINUTES_BY_HAND[d.kind] ?? 0;
    if (m <= 0) continue;
    minutes += m;
    byAgent.set(d.agent, (byAgent.get(d.agent) ?? 0) + m);
  }
  return { minutes, byAgent };
}

/** 0 min, 45 min, 1 h, 2 h 15 min. */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Days since 1970-01-01 for a real ISO calendar date, else undefined (2026-02-30 and 2026-10-1 are not dates). */
export function dayNumber(iso: string): number | undefined {
  if (typeof iso !== 'string' || !ISO_DAY.test(iso)) return undefined;
  const [y, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return undefined;
  return Math.round(t / 86_400_000);
}

/**
 * Days in a row with at least one approval, counted back from `today`. A day with no approval yet today does not break
 * the run (yesterday counts), a gap does. Duplicates, junk and future days are ignored.
 */
export function streak(days: readonly string[], today: string): number {
  const end = dayNumber(today);
  if (end === undefined) return 0;
  const have = new Set<number>();
  for (const d of days) {
    const n = dayNumber(d);
    if (n !== undefined && n <= end) have.add(n);
  }
  let cursor = have.has(end) ? end : end - 1;
  let run = 0;
  while (have.has(cursor)) {
    run += 1;
    cursor -= 1;
  }
  return run;
}

export const APPROVAL_DAYS_KEY = 'beleza.hq.approvalDays';
export const MAX_APPROVAL_DAYS = 400;

/** The local calendar date as YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Approvals per local calendar day, keyed by ISO date. */
export type ApprovalCounts = Record<string, number>;

/**
 * Real ISO days with whole positive counts only; anything else is dropped. The old format (an array with one date per
 * approval) is read by counting each date. At most the latest 400 distinct days are kept, oldest dropped first, so a
 * burst of approvals on one day never pushes earlier days out.
 */
export function cleanCounts(raw: unknown): ApprovalCounts {
  const found = new Map<string, number>();
  if (Array.isArray(raw)) {
    for (const d of raw) {
      if (typeof d === 'string' && dayNumber(d) !== undefined) found.set(d, (found.get(d) ?? 0) + 1);
    }
  } else if (typeof raw === 'object' && raw !== null) {
    for (const [d, n] of Object.entries(raw)) {
      if (dayNumber(d) !== undefined && typeof n === 'number' && Number.isSafeInteger(n) && n > 0) found.set(d, n);
    }
  }
  const days = [...found.keys()].sort((x, y) => (dayNumber(x) ?? 0) - (dayNumber(y) ?? 0));
  const out: ApprovalCounts = {};
  for (const d of days.slice(Math.max(0, days.length - MAX_APPROVAL_DAYS))) out[d] = found.get(d) ?? 0;
  return out;
}

/** Approvals per day as remembered in this browser. Blocked storage or junk reads as nothing. */
export function approvalCounts(): ApprovalCounts {
  try {
    const raw = localStorage.getItem(APPROVAL_DAYS_KEY);
    return raw ? cleanCounts(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/** Adds one approval on `today()` (injected so tests are deterministic) and returns the counts now held. */
export function recordApprovalDay(today: () => string = localToday): ApprovalCounts {
  const day = today();
  const have = approvalCounts();
  if (dayNumber(day) === undefined) return have;
  const next = cleanCounts({ ...have, [day]: (have[day] ?? 0) + 1 });
  try {
    localStorage.setItem(APPROVAL_DAYS_KEY, JSON.stringify(next));
  } catch {
    // not remembered; the streak simply starts again next visit
  }
  return next;
}

/** Call with every event the store accepted: an approval is what counts toward the streak. Never throws. */
export function recordIfApproval(e: AgentEvent, today: () => string = localToday): void {
  if (e.type !== 'approved') return;
  try {
    recordApprovalDay(today);
  } catch (err) {
    console.warn('[hq] could not note the approval day', err);
  }
}
