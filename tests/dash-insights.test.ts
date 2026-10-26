import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APPROVAL_DAYS_KEY, MAX_APPROVAL_DAYS, MINUTES_BY_HAND, approvalCounts, cleanCounts, formatMinutes, localToday,
  recordApprovalDay, recordIfApproval, streak, timeSaved,
} from '../src/dash/insights';
import { RECAP_SIZE, drawRecap, recapData, recapLines } from '../src/dash/recap';
import { DashStore } from '../src/dash/store';
import { DEMO_DAY } from '../src/demo/script';
import type { AgentEvent, DraftKind } from '../src/events';
import type { AgentId } from '../src/types';

const submit = (draftId: string, agent: AgentId, kind: DraftKind, summary: string): AgentEvent =>
  ({ type: 'draft_submitted', runId: `${agent}-1`, agent, draftId, kind, summary });

/** Brings one draft to `end`: 'waiting' | 'approved' | 'sent' | 'rejected'. */
function draftTo(store: DashStore, id: string, agent: AgentId, kind: DraftKind, summary: string, end: 'waiting' | 'approved' | 'sent' | 'rejected'): void {
  store.accept(submit(id, agent, kind, summary), 9);
  store.accept({ type: 'sentinel_result', draftId: id, pass: true, reasons: [] }, 9.1);
  store.accept({ type: 'awaiting_approval', draftId: id, agent }, 9.2);
  if (end === 'waiting') return;
  if (end === 'rejected') { store.accept({ type: 'rejected', draftId: id }, 9.3); return; }
  store.accept({ type: 'approved', draftId: id, mode: 'item' }, 9.3);
  if (end === 'sent') store.accept({ type: 'sent', draftId: id, channel: 'email' }, 9.4);
}

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
}

afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------- time saved

describe('MINUTES_BY_HAND', () => {
  it('has the stated minutes per kind', () => {
    expect(MINUTES_BY_HAND).toEqual({ email: 12, proposal: 45, post: 20, linkedin: 10, comment: 4, plan: 90 });
  });
});

describe('timeSaved', () => {
  it('is zero for an empty store', () => {
    const t = timeSaved(new DashStore());
    expect(t.minutes).toBe(0);
    expect(t.byAgent.size).toBe(0);
  });

  it('counts approved and sent drafts, not waiting or rejected ones', () => {
    const s = new DashStore();
    draftTo(s, 'a', 'quill', 'email', 'x', 'sent');
    draftTo(s, 'b', 'quill', 'email', 'x', 'approved');
    draftTo(s, 'c', 'quill', 'email', 'x', 'waiting');
    draftTo(s, 'd', 'quill', 'email', 'x', 'rejected');
    expect(timeSaved(s).minutes).toBe(24);
  });

  it('weights by kind and totals per agent', () => {
    const s = new DashStore();
    draftTo(s, 'a', 'quill', 'email', 'x', 'sent');
    draftTo(s, 'b', 'quill', 'proposal', 'x', 'approved');
    draftTo(s, 'c', 'muse', 'plan', 'x', 'approved');
    draftTo(s, 'd', 'linx', 'linkedin', 'x', 'sent');
    draftTo(s, 'e', 'lumen', 'post', 'x', 'sent');
    draftTo(s, 'f', 'echo', 'comment', 'x', 'sent');
    const t = timeSaved(s);
    expect(t.minutes).toBe(12 + 45 + 90 + 10 + 20 + 4);
    expect(t.byAgent.get('quill')).toBe(57);
    expect(t.byAgent.get('muse')).toBe(90);
    expect(t.byAgent.get('linx')).toBe(10);
    expect(t.byAgent.get('lumen')).toBe(20);
    expect(t.byAgent.get('echo')).toBe(4);
    expect([...t.byAgent.values()].reduce((a, b) => a + b, 0)).toBe(t.minutes);
  });

  it('is deterministic over the demo day and never negative', () => {
    const s = new DashStore();
    for (const step of DEMO_DAY) s.accept(step.event, step.atHour);
    const t = timeSaved(s);
    expect(t.minutes).toBeGreaterThan(0);
    expect(timeSaved(s).minutes).toBe(t.minutes);
  });
});

describe('formatMinutes', () => {
  it('reads minutes under an hour, hours and minutes above', () => {
    expect(formatMinutes(0)).toBe('0 min');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(135)).toBe('2 h 15 min');
  });
});

// ---------------------------------------------------------------- streak

describe('streak', () => {
  const today = '2026-10-26';

  it('is 0 for no days', () => {
    expect(streak([], today)).toBe(0);
  });

  it('counts consecutive days ending today', () => {
    expect(streak(['2026-10-24', '2026-10-25', '2026-10-26'], today)).toBe(3);
  });

  it('keeps the run alive when only today is missing (yesterday counts)', () => {
    expect(streak(['2026-10-24', '2026-10-25'], today)).toBe(2);
  });

  it('is 0 when the last approval was before yesterday', () => {
    expect(streak(['2026-10-23', '2026-10-24'], today)).toBe(0);
  });

  it('stops at a gap', () => {
    expect(streak(['2026-10-20', '2026-10-21', '2026-10-24', '2026-10-25', '2026-10-26'], today)).toBe(3);
  });

  it('counts a day once however many approvals it had, in any order', () => {
    expect(streak(['2026-10-26', '2026-10-25', '2026-10-26', '2026-10-25', '2026-10-24'], today)).toBe(3);
  });

  it('crosses month and year ends', () => {
    expect(streak(['2026-12-30', '2026-12-31', '2027-01-01'], '2027-01-01')).toBe(3);
    expect(streak(['2026-02-28', '2026-03-01'], '2026-03-01')).toBe(2); // 2026 is not a leap year: no 29 Feb between
    expect(streak(['2026-02-27', '2026-03-01'], '2026-03-01')).toBe(1);
    expect(streak(['2028-02-28', '2028-02-29', '2028-03-01'], '2028-03-01')).toBe(3);
  });

  it('ignores junk and future days', () => {
    expect(streak(['nope', '2026-13-40', '2026-10-27', '2026-10-26'], today)).toBe(1);
  });

  it('is 0 for a junk today', () => {
    expect(streak(['2026-10-26'], 'today')).toBe(0);
  });
});

// ---------------------------------------------------------------- approval days

describe('localToday', () => {
  it('is the local calendar date as ISO', () => {
    expect(localToday(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
    expect(localToday(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

const isoDay = (i: number): string => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);

describe('cleanCounts', () => {
  it('keeps real ISO days with whole positive counts and drops everything else', () => {
    expect(cleanCounts({
      '2026-10-01': 3, '2026-10-02': 1, 'x': 2, '2026-02-30': 4, '2026-10-1': 5,
      '2026-10-03': 0, '2026-10-04': -2, '2026-10-05': 1.5, '2026-10-06': '7', '2026-10-07': null, '2026-10-08': Number.NaN,
    })).toEqual({ '2026-10-01': 3, '2026-10-02': 1 });
    expect(cleanCounts('nope')).toEqual({});
    expect(cleanCounts(null)).toEqual({});
    expect(cleanCounts(7)).toEqual({});
  });

  it('migrates the old array format by counting each day, dropping junk entries', () => {
    expect(cleanCounts(['2026-10-01', 'x', 5, null, '2026-10-01', '2026-02-30', '2026-10-02', '2026-10-1', '2026-10-01']))
      .toEqual({ '2026-10-01': 3, '2026-10-02': 1 });
    expect(cleanCounts([])).toEqual({});
  });

  it('caps at 400 distinct days, dropping the oldest days first', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 401; i++) counts[isoDay(i)] = i + 1;
    const out = cleanCounts(counts);
    expect(Object.keys(out)).toHaveLength(MAX_APPROVAL_DAYS);
    expect(out[isoDay(0)]).toBeUndefined();
    expect(out[isoDay(1)]).toBe(2);
    expect(out[isoDay(400)]).toBe(401);
    // the same by day, not by position in the stored object
    const shuffled: Record<string, number> = {};
    for (let i = 400; i >= 0; i--) shuffled[isoDay(i)] = 1;
    expect(cleanCounts(shuffled)[isoDay(0)]).toBeUndefined();
  });
});

describe('approval days storage', () => {
  it('reads nothing when empty, blocked or junk', () => {
    vi.stubGlobal('localStorage', memory());
    expect(approvalCounts()).toEqual({});
    vi.stubGlobal('localStorage', memory({ [APPROVAL_DAYS_KEY]: '{{{' }));
    expect(approvalCounts()).toEqual({});
    vi.stubGlobal('localStorage', memory({ [APPROVAL_DAYS_KEY]: '"2026-10-26"' }));
    expect(approvalCounts()).toEqual({});
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(approvalCounts()).toEqual({});
  });

  it('records the injected day as a per-day count under its key', () => {
    const m = memory();
    vi.stubGlobal('localStorage', m);
    expect(recordApprovalDay(() => '2026-10-26')).toEqual({ '2026-10-26': 1 });
    expect(recordApprovalDay(() => '2026-10-26')).toEqual({ '2026-10-26': 2 });
    expect(recordApprovalDay(() => '2026-10-27')).toEqual({ '2026-10-26': 2, '2026-10-27': 1 });
    expect(JSON.parse(m.data[APPROVAL_DAYS_KEY])).toEqual({ '2026-10-26': 2, '2026-10-27': 1 });
    expect(approvalCounts()).toEqual({ '2026-10-26': 2, '2026-10-27': 1 });
  });

  it('keeps every earlier day when 500 approvals land on one day', () => {
    const m = memory();
    vi.stubGlobal('localStorage', m);
    for (let i = 1; i <= 5; i++) recordApprovalDay(() => `2026-10-${String(20 + i).padStart(2, '0')}`); // 21..25
    for (let i = 0; i < 500; i++) recordApprovalDay(() => '2026-10-26');
    const counts = approvalCounts();
    expect(Object.keys(counts).sort()).toEqual(['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']);
    expect(counts['2026-10-26']).toBe(500);
    expect(streak(Object.keys(counts), '2026-10-26')).toBe(6);
  });

  it('drops the oldest day when a 401st distinct day arrives', () => {
    const full: Record<string, number> = {};
    for (let i = 0; i < 400; i++) full[isoDay(i)] = 1;
    const m = memory({ [APPROVAL_DAYS_KEY]: JSON.stringify(full) });
    vi.stubGlobal('localStorage', m);
    const out = recordApprovalDay(() => '2026-10-26');
    expect(Object.keys(out)).toHaveLength(MAX_APPROVAL_DAYS);
    expect(out[isoDay(0)]).toBeUndefined();
    expect(out[isoDay(1)]).toBe(1);
    expect(out['2026-10-26']).toBe(1);
    expect(Object.keys(JSON.parse(m.data[APPROVAL_DAYS_KEY]))).toHaveLength(MAX_APPROVAL_DAYS);
  });

  it('migrates an old array in storage on read and on the next record', () => {
    const m = memory({ [APPROVAL_DAYS_KEY]: JSON.stringify(['2026-10-24', '2026-10-24', '2026-10-25', 'junk', 7]) });
    vi.stubGlobal('localStorage', m);
    expect(approvalCounts()).toEqual({ '2026-10-24': 2, '2026-10-25': 1 });
    expect(recordApprovalDay(() => '2026-10-26')).toEqual({ '2026-10-24': 2, '2026-10-25': 1, '2026-10-26': 1 });
    expect(JSON.parse(m.data[APPROVAL_DAYS_KEY])).toEqual({ '2026-10-24': 2, '2026-10-25': 1, '2026-10-26': 1 });
  });

  it('drops junk already stored when it records', () => {
    const m = memory({ [APPROVAL_DAYS_KEY]: JSON.stringify({ '2026-10-25': 2, 'nope': 4, '2026-10-24': -1, '2026-02-30': 1 }) });
    vi.stubGlobal('localStorage', m);
    expect(recordApprovalDay(() => '2026-10-26')).toEqual({ '2026-10-25': 2, '2026-10-26': 1 });
    expect(JSON.parse(m.data[APPROVAL_DAYS_KEY])).toEqual({ '2026-10-25': 2, '2026-10-26': 1 });
  });

  it('refuses a junk day and never throws when storage is blocked', () => {
    const m = memory();
    vi.stubGlobal('localStorage', m);
    expect(recordApprovalDay(() => 'tomorrow')).toEqual({});
    expect(m.data[APPROVAL_DAYS_KEY]).toBeUndefined();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(() => recordApprovalDay(() => '2026-10-26')).not.toThrow();
  });

  it('records only for an approved event', () => {
    const m = memory();
    vi.stubGlobal('localStorage', m);
    recordIfApproval({ type: 'rejected', draftId: 'a' }, () => '2026-10-26');
    recordIfApproval({ type: 'sent', draftId: 'a', channel: 'email' }, () => '2026-10-26');
    expect(m.data[APPROVAL_DAYS_KEY]).toBeUndefined();
    recordIfApproval({ type: 'approved', draftId: 'a', mode: 'item' }, () => '2026-10-26');
    expect(JSON.parse(m.data[APPROVAL_DAYS_KEY])).toEqual({ '2026-10-26': 1 });
  });
});

// ---------------------------------------------------------------- recap

describe('recapData', () => {
  it('is all zero for an empty store', () => {
    expect(recapData(new DashStore(), {})).toEqual({ approved: 0, denied: 0, sent: 0, minutesSaved: 0, highlights: [] });
  });

  it('counts approved (approved or sent), denied and sent drafts and the minutes saved', () => {
    const s = new DashStore();
    draftTo(s, 'a', 'quill', 'email', 'First email to a café', 'sent');
    draftTo(s, 'b', 'quill', 'email', 'Second email to a gym', 'approved');
    draftTo(s, 'c', 'muse', 'plan', 'Next week plan', 'rejected');
    draftTo(s, 'd', 'muse', 'post', 'A post', 'waiting');
    const d = recapData(s, {});
    expect(d.approved).toBe(2);
    expect(d.denied).toBe(1);
    expect(d.sent).toBe(1);
    expect(d.minutesSaved).toBe(24);
  });

  it('names the busiest agent by approved drafts, the earlier roster agent on a tie', () => {
    const s = new DashStore();
    draftTo(s, 'a', 'quill', 'email', 'x', 'sent');
    draftTo(s, 'b', 'quill', 'email', 'x', 'sent');
    draftTo(s, 'c', 'muse', 'post', 'x', 'sent');
    expect(recapData(s, {}).busiestAgent).toBe('quill');
    draftTo(s, 'd', 'muse', 'post', 'x', 'sent');
    expect(recapData(s, {}).busiestAgent).toBe('quill'); // 2 vs 2: quill comes before muse in the roster
  });

  it('has no busiest agent when nothing was approved', () => {
    const s = new DashStore();
    draftTo(s, 'a', 'quill', 'email', 'x', 'waiting');
    expect('busiestAgent' in recapData(s, {})).toBe(false);
  });

  it('picks the day with most approvals, the latest on a tie, and none for no days', () => {
    const s = new DashStore();
    expect(recapData(s, { '2026-10-24': 3, '2026-10-25': 2, '2026-10-26': 1 }).busiestDay).toBe('2026-10-24');
    expect(recapData(s, { '2026-10-24': 2, '2026-10-25': 2, '2026-10-26': 1 }).busiestDay).toBe('2026-10-25'); // tie: the latest
    expect(recapData(s, { '2026-10-26': 500, '2026-10-25': 3 }).busiestDay).toBe('2026-10-26');
    expect('busiestDay' in recapData(s, {})).toBe(false);
    expect('busiestDay' in recapData(s, { junk: 4, '2026-10-26': 0 })).toBe(false);
  });

  it('keeps up to three recent sent summaries as highlights', () => {
    const s = new DashStore();
    for (let i = 0; i < 5; i++) draftTo(s, `d${i}`, 'quill', 'email', `Email number ${i}`, 'sent');
    const h = recapData(s, {}).highlights;
    expect(h).toHaveLength(3);
    expect(h.every((x) => x.startsWith('Email number'))).toBe(true);
  });
});

describe('recapLines', () => {
  const store = (() => {
    const s = new DashStore();
    draftTo(s, 'a', 'quill', 'email', 'First email to Cafe Rosa', 'sent');
    draftTo(s, 'b', 'quill', 'email', 'Reply to Dr Moyo about the quote', 'sent');
    draftTo(s, 'c', 'muse', 'plan', 'Next week for Rosa Bakery', 'rejected');
    return s;
  })();
  const data = recapData(store, { '2026-10-26': 1 });
  const summaries = ['First email to Cafe Rosa', 'Reply to Dr Moyo about the quote', 'Next week for Rosa Bakery'];

  it('shows the numbers and the sent summaries when client names are shown', () => {
    const lines = recapLines(data, { hideClients: false });
    const text = lines.join('\n');
    expect(text).toContain('2'); // approved
    expect(text).toContain('Quill');
    expect(text).toContain('First email to Cafe Rosa');
    expect(lines.every((l) => typeof l === 'string' && l.length > 0)).toBe(true);
  });

  it('carries no draft summary or target at all when client names are hidden', () => {
    const lines = recapLines(data, { hideClients: true });
    const text = lines.join('\n');
    for (const sm of summaries) expect(text).not.toContain(sm);
    for (const word of ['Cafe', 'Rosa', 'Moyo', 'Bakery']) expect(text).not.toContain(word);
    expect(text).toContain('Quill'); // the team is not a client
  });

  it('hides every summary even when the data holds extra highlights', () => {
    const lines = recapLines({ ...data, highlights: ['Secret Client Ltd', 'Another Client'] }, { hideClients: true });
    expect(lines.join('\n')).not.toMatch(/Secret|Another Client/);
  });

  it('draws the same lines for an empty week without throwing', () => {
    const lines = recapLines(recapData(new DashStore(), {}), { hideClients: true });
    expect(lines.length).toBeGreaterThan(2);
  });

  it('never shows the ISO day raw, and carries the privacy footer', () => {
    const text = recapLines(data, { hideClients: true }).join('\n');
    expect(text).not.toContain('2026-10-26');
    expect(text.toLowerCase()).toContain('never sent anywhere');
  });
});

describe('drawRecap', () => {
  /** A canvas whose 2D context records every fillText and answers everything else with a harmless stub. */
  function fakeCanvas() {
    const drawn: string[] = [];
    const gradient = { addColorStop: () => undefined };
    const ctx = new Proxy({}, {
      get: (_t, prop) => {
        if (prop === 'fillText') return (t: string) => void drawn.push(t);
        if (prop === 'measureText') return (t: string) => ({ width: t.length * 10 });
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
        return () => undefined;
      },
      set: () => true,
    });
    const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
    return { canvas, drawn };
  }

  const s = new DashStore();
  draftTo(s, 'a', 'quill', 'email', 'First email to Cafe Rosa', 'sent');
  const data = recapData(s, { '2026-10-26': 1 });

  it('sizes the card 1080 x 1080 and draws only text that recapLines lists', () => {
    for (const hideClients of [false, true]) {
      const { canvas, drawn } = fakeCanvas();
      drawRecap(canvas, data, { hideClients });
      expect(canvas.width).toBe(RECAP_SIZE);
      expect(canvas.height).toBe(RECAP_SIZE);
      const lines = recapLines(data, { hideClients });
      const allowed = new Set([...lines, ...lines.map((l) => l.toUpperCase()), 'b']);
      for (const t of drawn) expect(allowed.has(t)).toBe(true);
      expect(drawn.join('\n').includes('Cafe Rosa')).toBe(!hideClients);
    }
  });

  it('does nothing, without throwing, when 2D drawing is not available', () => {
    const canvas = { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => drawRecap(canvas, data, { hideClients: false })).not.toThrow();
  });
});
