import { describe, it, expect } from 'vitest';
import { createDemoActions, SEND_CHANNEL, SEND_DELAY_MS, RUN_STEP_MS } from '../src/dash/actions';
import { DashStore } from '../src/dash/store';
import { DEMO_DAY } from '../src/demo/script';
import type { AgentEvent, DraftKind } from '../src/events';
import { ROSTER } from '../src/roster';
import type { AgentId } from '../src/types';

/** A store wired like main.ts (events go through `accept`), a recording emit and a fake `later` clock. */
function rig(opts: { paused?: (a: AgentId) => boolean; hour?: () => number } = {}) {
  const store = new DashStore();
  const emitted: AgentEvent[] = [];
  const timers: { at: number; fn: () => void }[] = [];
  let now = 0;
  const hour = opts.hour ?? (() => 9);
  const emit = (e: AgentEvent) => {
    emitted.push(e);
    store.accept(e, hour());
  };
  const actions = createDemoActions({
    store,
    emit,
    later: (ms, fn) => void timers.push({ at: now + ms, fn }),
    paused: opts.paused,
  });
  /** Runs every timer due within `ms` more, in time order (including ones those timers schedule). */
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      now = due.at;
      due.fn();
    }
    now = end;
  };
  return { store, actions, emitted, advance };
}

/** Brings a draft to `waiting` through the store directly (not through `emit`). */
function waitingDraft(store: DashStore, draftId: string, kind: DraftKind = 'email', agent: AgentId = 'quill'): void {
  const runId = `${agent}-seed`;
  store.accept({ type: 'run_started', runId, agent, task: 'Seed' }, 8);
  store.accept({ type: 'draft_submitted', runId, agent, draftId, kind, summary: 'Seeded draft' }, 8.1);
  store.accept({ type: 'sentinel_result', draftId, pass: true, reasons: [] }, 8.2);
  store.accept({ type: 'awaiting_approval', draftId, agent }, 8.3);
}

describe('constants', () => {
  it('maps each draft kind to its send channel (plans are not sent)', () => {
    expect(SEND_CHANNEL).toEqual({
      email: 'email',
      proposal: 'email',
      post: 'instagram',
      comment: 'instagram',
      linkedin: 'linkedin',
      plan: null,
    });
    expect(SEND_DELAY_MS).toBe(3000);
    expect(RUN_STEP_MS).toBe(1500);
  });
});

describe('approve', () => {
  it('emits approved, then sent after 3000 ms on the kind\'s channel', () => {
    const { store, actions, emitted, advance } = rig();
    waitingDraft(store, 'd1', 'email');
    expect(actions.approve('d1')).toBe(true);
    expect(emitted).toEqual([{ type: 'approved', draftId: 'd1', mode: 'item' }]);
    advance(SEND_DELAY_MS - 1);
    expect(emitted).toHaveLength(1);
    advance(1);
    expect(emitted).toEqual([
      { type: 'approved', draftId: 'd1', mode: 'item' },
      { type: 'sent', draftId: 'd1', channel: 'email' },
    ]);
    expect(store.draft('d1')?.status).toBe('sent');
  });

  it.each([
    ['email', 'email'],
    ['proposal', 'email'],
    ['post', 'instagram'],
    ['comment', 'instagram'],
    ['linkedin', 'linkedin'],
  ] as const)('a %s draft is sent on %s', (kind, channel) => {
    const { store, actions, emitted, advance } = rig();
    waitingDraft(store, 'd1', kind);
    actions.approve('d1');
    advance(SEND_DELAY_MS);
    expect(emitted[1]).toEqual({ type: 'sent', draftId: 'd1', channel });
  });

  it('passes the approval mode through', () => {
    const { store, actions, emitted } = rig();
    waitingDraft(store, 'd1');
    actions.approve('d1', 'whatsapp');
    expect(emitted[0]).toEqual({ type: 'approved', draftId: 'd1', mode: 'whatsapp' });
    expect(store.draft('d1')?.mode).toBe('whatsapp');
  });

  it('a plan draft is approved but never sent', () => {
    const { store, actions, emitted, advance } = rig();
    waitingDraft(store, 'p1', 'plan', 'muse');
    expect(actions.approve('p1', 'plan')).toBe(true);
    advance(60_000);
    expect(emitted).toEqual([{ type: 'approved', draftId: 'p1', mode: 'plan' }]);
    expect(store.draft('p1')?.status).toBe('approved');
  });

  it('emits nothing for a draft that is not waiting, unknown, or already approved', () => {
    const { store, actions, emitted, advance } = rig();
    store.accept({ type: 'run_started', runId: 'quill-seed', agent: 'quill', task: 'Seed' }, 8);
    store.accept({ type: 'draft_submitted', runId: 'quill-seed', agent: 'quill', draftId: 'chk', kind: 'email', summary: 'x' }, 8.1);
    expect(actions.approve('chk')).toBe(false); // still being checked
    expect(actions.approve('nope')).toBe(false);
    waitingDraft(store, 'd1');
    expect(actions.approve('d1')).toBe(true);
    emitted.length = 0;
    expect(actions.approve('d1')).toBe(false); // second click
    advance(10_000);
    expect(emitted.filter((e) => e.type === 'approved')).toEqual([]);
    expect(emitted.filter((e) => e.type === 'sent')).toHaveLength(1); // from the first approve only
  });
});

describe('reject', () => {
  it('emits rejected for a waiting draft, nothing otherwise', () => {
    const { store, actions, emitted, advance } = rig();
    waitingDraft(store, 'd1');
    expect(actions.reject('d1')).toBe(true);
    expect(emitted).toEqual([{ type: 'rejected', draftId: 'd1' }]);
    expect(store.draft('d1')?.status).toBe('rejected');
    expect(actions.reject('d1')).toBe(false);
    expect(actions.reject('nope')).toBe(false);
    advance(10_000);
    expect(emitted).toHaveLength(1);
  });
});

describe('approveAll', () => {
  it('approves every waiting draft the predicate matches, with the given mode, and returns the count', () => {
    const { store, actions, emitted, advance } = rig();
    waitingDraft(store, 'q1', 'email', 'quill');
    waitingDraft(store, 'q2', 'email', 'quill');
    waitingDraft(store, 'm1', 'plan', 'muse');
    waitingDraft(store, 'm2', 'post', 'muse');
    const n = actions.approveAll((d) => d.kind === 'plan' || d.agent === 'muse', 'plan');
    expect(n).toBe(2);
    expect(emitted.filter((e) => e.type === 'approved').map((e) => (e as { draftId: string; mode: string }).draftId).sort()).toEqual(['m1', 'm2']);
    expect(emitted.every((e) => e.type !== 'approved' || e.mode === 'plan')).toBe(true);
    expect(store.draft('q1')?.status).toBe('waiting');
    advance(SEND_DELAY_MS);
    // m1 is a plan (no send); m2 is a post (instagram)
    expect(emitted.filter((e) => e.type === 'sent')).toEqual([{ type: 'sent', draftId: 'm2', channel: 'instagram' }]);
  });

  it('skips drafts that are not waiting and returns 0 when nothing matches', () => {
    const { store, actions } = rig();
    waitingDraft(store, 'q1');
    actions.approve('q1');
    expect(actions.approveAll(() => true, 'item')).toBe(0);
  });
});

describe('Review Focus 1: a user approval beats the script', () => {
  it('after the user approves quill-d1 at 09:30, the script\'s own approved and sent for it are refused', () => {
    let h = 6;
    const { store, actions, advance } = rig({ hour: () => h });
    const rest: typeof DEMO_DAY = [];
    for (const step of DEMO_DAY) {
      if (step.atHour <= 9.5) {
        h = step.atHour;
        store.accept(step.event, h);
      } else rest.push(step);
    }
    expect(store.draft('quill-d1')?.status).toBe('waiting');

    h = 9.5;
    expect(actions.approve('quill-d1')).toBe(true);
    advance(SEND_DELAY_MS);
    expect(store.draft('quill-d1')?.status).toBe('sent');

    const scriptApproved = rest.find((s) => s.event.type === 'approved' && s.event.draftId === 'quill-d1');
    const scriptSent = rest.find((s) => s.event.type === 'sent' && s.event.draftId === 'quill-d1');
    expect(scriptApproved).toBeDefined();
    expect(scriptSent).toBeDefined();
    const logBefore = store.activity().length;
    expect(store.accept(scriptApproved!.event, scriptApproved!.atHour)).toBe(false);
    expect(store.accept(scriptSent!.event, scriptSent!.atHour)).toBe(false);
    expect(store.activity()).toHaveLength(logBefore);

    // the rest of the script still plays normally (no other event is refused for this)
    for (const step of rest) {
      if (step === scriptApproved || step === scriptSent) continue;
      expect(store.accept(step.event, step.atHour), JSON.stringify(step.event)).toBe(true);
    }
  });
});

describe('runNow', () => {
  it('returns undefined for a parked agent and emits nothing', () => {
    const { actions, emitted, advance } = rig();
    expect(actions.runNow('ledger')).toBeUndefined();
    expect(actions.runNow('keeper')).toBeUndefined();
    advance(60_000);
    expect(emitted).toEqual([]);
  });

  it('returns undefined for a paused agent', () => {
    const { actions, emitted } = rig({ paused: (a) => a === 'quill' });
    expect(actions.runNow('quill')).toBeUndefined();
    expect(emitted).toEqual([]);
    expect(actions.runNow('scout')).toBeDefined();
  });

  it('runs a drafter: run_started, 3 progress, draft, Sentinel pass, awaiting_approval, run_finished, and ends with one waiting draft', () => {
    const { store, actions, emitted, advance } = rig();
    const role = ROSTER.find((a) => a.id === 'quill')!.role;
    const runId = actions.runNow('quill');
    expect(runId).toBe('quill-now-1');
    expect(emitted).toEqual([{ type: 'run_started', runId: 'quill-now-1', agent: 'quill', task: role }]);
    expect(store.statusOf('quill')).toBe('working');

    advance(RUN_STEP_MS * 3);
    const progress = emitted.filter((e) => e.type === 'progress');
    expect(progress.map((e) => (e.type === 'progress' ? [e.done, e.total, e.runId, e.agent] : null))).toEqual([
      [1, 3, 'quill-now-1', 'quill'],
      [2, 3, 'quill-now-1', 'quill'],
      [3, 3, 'quill-now-1', 'quill'],
    ]);

    advance(RUN_STEP_MS * 4);
    expect(emitted.map((e) => e.type)).toEqual([
      'run_started',
      'progress',
      'progress',
      'progress',
      'draft_submitted',
      'sentinel_result',
      'awaiting_approval',
      'run_finished',
    ]);
    const [, , , , draft, verdict, awaiting, finished] = emitted;
    expect(draft).toMatchObject({ type: 'draft_submitted', runId: 'quill-now-1', agent: 'quill', draftId: 'quill-now-1', kind: 'email' });
    expect(verdict).toEqual({ type: 'sentinel_result', draftId: 'quill-now-1', pass: true, reasons: [] });
    expect(awaiting).toEqual({ type: 'awaiting_approval', draftId: 'quill-now-1', agent: 'quill' });
    expect(finished).toMatchObject({ type: 'run_finished', runId: 'quill-now-1', agent: 'quill', status: 'ok' });
    expect(typeof (finished as { costUsd: number }).costUsd).toBe('number');

    const waiting = store.drafts({ status: 'waiting' });
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ id: 'quill-now-1', agent: 'quill', kind: 'email' });
    expect(store.statusOf('quill')).toBe('waiting');
    expect(store.spendToday().get('quill')).toBeGreaterThan(0);
  });

  it('a non-drafter has no draft: run_started, 3 progress, run_finished', () => {
    const { store, actions, emitted, advance } = rig();
    actions.runNow('scout');
    advance(RUN_STEP_MS * 10);
    expect(emitted.map((e) => e.type)).toEqual(['run_started', 'progress', 'progress', 'progress', 'run_finished']);
    expect(store.drafts()).toEqual([]);
    expect(store.statusOf('scout')).toBe('idle');
  });

  it('produces the same event timing step by step (one event every RUN_STEP_MS)', () => {
    const { actions, emitted, advance } = rig();
    actions.runNow('echo');
    const counts: number[] = [];
    for (let i = 0; i < 7; i++) {
      advance(RUN_STEP_MS);
      counts.push(emitted.length);
    }
    expect(counts).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it('a second runNow while the first is open returns undefined; after it ends, a new one gets a new id', () => {
    const { actions, emitted, advance } = rig();
    expect(actions.runNow('quill')).toBe('quill-now-1');
    expect(actions.runNow('quill')).toBeUndefined();
    advance(RUN_STEP_MS * 3);
    expect(actions.runNow('quill')).toBeUndefined();
    advance(RUN_STEP_MS * 10);
    expect(emitted.filter((e) => e.type === 'run_started')).toHaveLength(1);
    expect(actions.runNow('quill')).toBe('quill-now-2');
    // another agent is independent
    expect(actions.runNow('linx')).toBe('linx-now-3');
  });

  it('is refused while the script\'s run is open, even with a draft of the agent waiting', () => {
    const { store, actions, emitted } = rig();
    let h = 6;
    for (const step of DEMO_DAY) {
      if (step.atHour > 9.5) break;
      h = step.atHour;
      store.accept(step.event, h);
    }
    expect(store.draft('quill-d1')?.status).toBe('waiting');
    expect(store.statusOf('quill')).toBe('waiting');
    expect(actions.runNow('quill')).toBeUndefined();
    expect(emitted).toEqual([]);
  });

  it('is refused while the script has the agent working', () => {
    const { store, actions, emitted } = rig();
    store.accept({ type: 'run_started', runId: 'scout-1', agent: 'scout', task: 'Finding leads' }, 8);
    expect(actions.runNow('scout')).toBeUndefined();
    expect(emitted).toEqual([]);
  });

  it('gives every drafter a draft kind, and the others none', () => {
    const kinds: Partial<Record<AgentId, string>> = {};
    for (const id of ['quill', 'echo', 'linx', 'pulse', 'forge', 'muse', 'atlas'] as AgentId[]) {
      const { actions, emitted, advance } = rig();
      actions.runNow(id);
      advance(RUN_STEP_MS * 10);
      const d = emitted.find((e) => e.type === 'draft_submitted');
      expect(d, id).toBeDefined();
      kinds[id] = d && d.type === 'draft_submitted' ? d.kind : undefined;
    }
    expect(kinds.quill).toBe('email');
    expect(kinds.linx).toBe('linkedin');
    expect(kinds.muse).toBe('plan');
    expect(kinds.pulse).toBe('comment');
    expect(kinds.forge).toBe('proposal');
    for (const id of ['tempo', 'scout', 'lumen', 'sentinel', 'herald', 'courier'] as AgentId[]) {
      const { actions, emitted, advance } = rig();
      actions.runNow(id);
      advance(RUN_STEP_MS * 10);
      expect(emitted.some((e) => e.type === 'draft_submitted'), id).toBe(false);
    }
  });

  it('a throwing emit does not stop the run or throw out of the timer', () => {
    const store = new DashStore();
    const timers: { at: number; fn: () => void }[] = [];
    let n = 0;
    const actions = createDemoActions({
      store,
      emit: () => {
        n++;
        throw new Error('boom');
      },
      later: (ms, fn) => void timers.push({ at: ms, fn }),
    });
    expect(() => actions.runNow('scout')).not.toThrow();
    for (const t of timers.sort((a, b) => a.at - b.at)) expect(() => t.fn()).not.toThrow();
    expect(n).toBe(5);
    // the run counts as over, so it can start again
    expect(actions.runNow('scout')).toBe('scout-now-2');
  });
});

describe('cancelPending', () => {
  it('stops the rest of a run that is under way, and (with the store reset, as on a day restart) lets the agent run again', () => {
    const { store, actions, emitted, advance } = rig();
    actions.runNow('quill');
    advance(RUN_STEP_MS);
    expect(emitted).toHaveLength(2);
    actions.cancelPending();
    store.reset();
    advance(RUN_STEP_MS * 20);
    expect(emitted).toHaveLength(2);
    expect(actions.runNow('quill')).toBe('quill-now-2');
    advance(RUN_STEP_MS * 10);
    expect(emitted.filter((e) => e.type === 'run_finished')).toHaveLength(1);
  });

  it('drops a delayed sent', () => {
    const { store, actions, emitted, advance } = rig();
    waitingDraft(store, 'd1');
    actions.approve('d1');
    advance(SEND_DELAY_MS - 1);
    actions.cancelPending();
    advance(SEND_DELAY_MS * 2);
    expect(emitted).toEqual([{ type: 'approved', draftId: 'd1', mode: 'item' }]);
  });

  it('does not affect actions taken afterwards', () => {
    const { store, actions, emitted, advance } = rig();
    actions.cancelPending();
    waitingDraft(store, 'd1');
    actions.approve('d1');
    advance(SEND_DELAY_MS);
    expect(emitted.map((e) => e.type)).toEqual(['approved', 'sent']);
  });
});
