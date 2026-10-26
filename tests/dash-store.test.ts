import { describe, it, expect } from 'vitest';
import { DashStore, demoBody } from '../src/dash/store';
import { DEMO_DAY } from '../src/demo/script';
import type { AgentEvent, DraftKind } from '../src/events';
import { ROSTER } from '../src/roster';
import type { AgentId } from '../src/types';

const start = (agent: AgentId, runId = `${agent}-1`, task = 'Working'): AgentEvent =>
  ({ type: 'run_started', runId, agent, task });
const progress = (agent: AgentId, runId = `${agent}-1`, text = 'Step', done?: number, total?: number): AgentEvent =>
  ({ type: 'progress', runId, agent, text, ...(done !== undefined && { done }), ...(total !== undefined && { total }) });
const submit = (draftId = 'quill-d2', agent: AgentId = 'quill', runId = `${agent}-1`, summary = 'First email to a café', kind: DraftKind = 'email'): AgentEvent =>
  ({ type: 'draft_submitted', runId, agent, draftId, kind, summary });
const verdict = (draftId: string, pass: boolean, reasons: string[] = []): AgentEvent =>
  ({ type: 'sentinel_result', draftId, pass, reasons });
const awaiting = (draftId: string, agent: AgentId = 'quill'): AgentEvent => ({ type: 'awaiting_approval', draftId, agent });
const approve = (draftId: string, mode: 'item' | 'plan' | 'whatsapp' = 'item'): AgentEvent => ({ type: 'approved', draftId, mode });
const reject = (draftId: string): AgentEvent => ({ type: 'rejected', draftId });
const sent = (draftId: string, channel: 'email' | 'instagram' | 'facebook' | 'linkedin' | 'whatsapp' = 'email'): AgentEvent =>
  ({ type: 'sent', draftId, channel });
const finish = (agent: AgentId, runId = `${agent}-1`, status: 'ok' | 'failed' = 'ok', costUsd = 0.1): AgentEvent =>
  ({ type: 'run_finished', runId, agent, status, costUsd });

/** A store with run quill-1 open and the draft quill-d2 brought to the given step. */
function storeAt(step: 'checking' | 'passed' | 'returned' | 'waiting' | 'approved' | 'sent'): DashStore {
  const s = new DashStore();
  s.accept(start('quill'), 9);
  s.accept(submit(), 9.1);
  if (step === 'checking') return s;
  if (step === 'returned') {
    s.accept(verdict('quill-d2', false, ['No opt-out line']), 9.2);
    return s;
  }
  s.accept(verdict('quill-d2', true), 9.2);
  if (step === 'passed') return s;
  s.accept(awaiting('quill-d2'), 9.3);
  if (step === 'waiting') return s;
  s.accept(approve('quill-d2'), 10);
  if (step === 'approved') return s;
  s.accept(sent('quill-d2'), 10.5);
  return s;
}

/** Everything observable, so a rejected event can be shown to change nothing. */
function snapshot(s: DashStore) {
  return JSON.stringify({
    drafts: s.drafts(),
    activity: s.activity(),
    spend: [...s.spendToday()],
    status: ROSTER.map((a) => [a.id, s.statusOf(a.id), s.progressOf(a.id)]),
  });
}

/** Asserts `accept` refuses the event and the store (and its subscribers) never notice. */
function expectRefused(s: DashStore, e: AgentEvent, label: string = e.type) {
  let calls = 0;
  const off = s.subscribe(() => calls++);
  const before = snapshot(s);
  expect(s.accept(e, 12), label).toBe(false);
  expect(snapshot(s), `${label} changed the store`).toBe(before);
  expect(calls, `${label} notified`).toBe(0);
  off();
}

describe('DashStore gate', () => {
  it('sentinel_result is refused unless the draft is checking', () => {
    expectRefused(new DashStore(), verdict('nope', true));
    expectRefused(storeAt('waiting'), verdict('quill-d2', false, ['late']));
    expectRefused(storeAt('returned'), verdict('quill-d2', true));
    expectRefused(storeAt('sent'), verdict('quill-d2', true));
  });

  it('awaiting_approval is refused unless the draft is checking with a passed result', () => {
    expectRefused(new DashStore(), awaiting('nope'));
    expectRefused(storeAt('checking'), awaiting('quill-d2'));
    expectRefused(storeAt('returned'), awaiting('quill-d2'));
    expectRefused(storeAt('waiting'), awaiting('quill-d2'));
    expectRefused(storeAt('sent'), awaiting('quill-d2'));
  });

  it('approved and rejected are refused unless the draft is waiting', () => {
    for (const e of [approve('quill-d2'), reject('quill-d2')]) {
      expectRefused(new DashStore(), e);
      expectRefused(storeAt('checking'), e);
      expectRefused(storeAt('passed'), e);
      expectRefused(storeAt('returned'), e);
      expectRefused(storeAt('approved'), e);
      expectRefused(storeAt('sent'), e);
    }
  });

  it('sent is refused unless the draft is approved', () => {
    expectRefused(new DashStore(), sent('nope'));
    expectRefused(storeAt('checking'), sent('quill-d2'));
    expectRefused(storeAt('waiting'), sent('quill-d2'));
    expectRefused(storeAt('sent'), sent('quill-d2', 'linkedin'));
    const rejected = storeAt('waiting');
    rejected.accept(reject('quill-d2'), 10);
    expectRefused(rejected, sent('quill-d2'));
  });

  it('a second approved and a second sent for the same draft are refused (Review Focus 1)', () => {
    const s = storeAt('waiting');
    expect(s.accept(approve('quill-d2'), 10)).toBe(true);
    expectRefused(s, approve('quill-d2', 'whatsapp'), 'second approved');
    expect(s.draft('quill-d2')).toMatchObject({ status: 'approved', mode: 'item' });
    expect(s.accept(sent('quill-d2'), 10.5)).toBe(true);
    expectRefused(s, sent('quill-d2', 'linkedin'), 'second sent');
    expect(s.draft('quill-d2')).toMatchObject({ status: 'sent', channel: 'email', at: 10.5 });
  });

  it('progress and run_finished that name a different agent than the open run are refused', () => {
    const s = new DashStore();
    s.accept(start('quill', 'r1'), 9);
    s.accept(progress('quill', 'r1', 'Reading notes'), 9.1);
    expectRefused(s, progress('scout', 'r1', 'Hijack'), 'progress for another agent');
    expectRefused(s, finish('scout', 'r1', 'ok', 1), 'run_finished for another agent');
    expect(s.statusOf('quill')).toBe('working');
    expect(s.statusOf('scout')).toBe('idle');
    expect(s.progressOf('quill')).toEqual({ text: 'Reading notes' });
    expect(s.spendToday().size).toBe(0);
    // The run's real owner can still close it.
    expect(s.accept(finish('quill', 'r1', 'ok', 0.2), 9.5)).toBe(true);
    expect(s.statusOf('quill')).toBe('idle');
    expect(s.progressOf('quill')).toBeUndefined();
    expect([...s.spendToday()]).toEqual([['quill', 0.2]]);
  });

  it('progress for an unknown run opens it implicitly (a viewer that joined mid-run)', () => {
    const s = new DashStore();
    expect(s.accept(progress('scout', 'late', 'Researching and grading leads', 4, 10), 7.6)).toBe(true);
    expect(s.statusOf('scout')).toBe('working');
    expect(s.progressOf('scout')).toEqual({ text: 'Researching and grading leads', done: 4, total: 10 });
    expect(s.activity().map((a) => a.text)).toEqual(['Scout: Researching and grading leads (4/10)']);
    // It is a real open run now: it can be finished and its cost counts.
    expect(s.accept(finish('scout', 'late', 'ok', 0.18), 8)).toBe(true);
    expect(s.statusOf('scout')).toBe('idle');
    expect(s.progressOf('scout')).toBeUndefined();
    expect(s.spendToday().get('scout')).toBeCloseTo(0.18);
  });

  it('run_finished for an unknown run records its cost and result and opens nothing', () => {
    const s = new DashStore();
    s.accept(start('echo'), 8);
    let calls = 0;
    s.subscribe(() => calls++);
    expect(s.accept(finish('scout', 'late', 'failed', 0.07), 8.5)).toBe(true);
    expect(calls).toBe(1);
    expect(s.statusOf('scout')).toBe('failed');
    expect(s.spendToday().get('scout')).toBeCloseTo(0.07);
    expect(s.statusOf('echo')).toBe('working'); // nobody else's run was touched
    expect(s.activity().map((a) => a.text)).toEqual(['Echo started: Working', 'Scout failed']);

    expect(s.accept(finish('pulse', 'late2', 'ok', 0.03), 9)).toBe(true);
    expect(s.statusOf('pulse')).toBe('idle');
    expect(s.spendToday().get('pulse')).toBeCloseTo(0.03);
    expect(s.activity()[2].text).toBe('Pulse finished');
  });

  it('a run that already finished is not reopened or counted twice', () => {
    const s = new DashStore();
    s.accept(start('scout'), 7);
    s.accept(finish('scout', 'scout-1', 'ok', 0.18), 8);
    expectRefused(s, finish('scout', 'scout-1', 'ok', 0.18), 'second run_finished');
    expectRefused(s, progress('scout', 'scout-1'), 'progress after the run ended');
    expect(s.spendToday().get('scout')).toBeCloseTo(0.18);
    // An unknown run that was finished directly is closed for good too.
    s.accept(finish('echo', 'late', 'ok', 0.1), 9);
    expectRefused(s, finish('echo', 'late', 'ok', 0.1), 'second run_finished of an unknown run');
    expectRefused(s, progress('echo', 'late'), 'progress after an unknown run ended');
  });

  it('any event for a parked agent is refused, and the agent stays parked', () => {
    const s = new DashStore();
    expectRefused(s, start('ledger'));
    expectRefused(s, progress('ledger'));
    expectRefused(s, submit('ledger-d1', 'ledger'));
    expectRefused(s, awaiting('ledger-d1', 'ledger'));
    expectRefused(s, finish('ledger'));
    expect(s.statusOf('ledger')).toBe('parked');
    expect(s.statusOf('keeper')).toBe('parked');
    expect(s.drafts()).toEqual([]);
  });

  it('a draft_submitted for a draft that is not returned is a duplicate and is refused', () => {
    expectRefused(storeAt('checking'), submit());
    expectRefused(storeAt('waiting'), submit());
    expectRefused(storeAt('sent'), submit());
  });

  it('ignores values that are not events, without throwing', () => {
    const s = new DashStore();
    for (const junk of [null, undefined, 42, 'run_started', {}, { type: 'run_started' }, { type: 'bogus' }, []]) {
      expect(s.accept(junk as unknown as AgentEvent, 12)).toBe(false);
    }
    expect(s.activity()).toEqual([]);
  });
});

describe('DashStore drafts', () => {
  it('runs the full quill-d2 path: checking, returned, checking, waiting, approved, sent', () => {
    const s = new DashStore();
    s.accept(start('quill'), 9);
    expect(s.accept(submit('quill-d2', 'quill', 'quill-1', 'First email: missing booking button'), 9.23)).toBe(true);
    expect(s.draft('quill-d2')).toMatchObject({
      id: 'quill-d2', agent: 'quill', runId: 'quill-1', kind: 'email', status: 'checking', reasons: [], at: 9.23,
    });
    expect(s.draft('quill-d2')!.body).toBe(demoBody('email', 'First email: missing booking button', 'quill'));

    expect(s.accept(verdict('quill-d2', false, ['No opt-out line', 'Claims a result we cannot back up']), 9.33)).toBe(true);
    expect(s.draft('quill-d2')).toMatchObject({
      status: 'returned', reasons: ['No opt-out line', 'Claims a result we cannot back up'], at: 9.33,
    });

    expect(s.accept(submit('quill-d2', 'quill', 'quill-1', 'Revised: opt-out added'), 9.73)).toBe(true);
    expect(s.draft('quill-d2')).toMatchObject({ status: 'checking', reasons: [], summary: 'Revised: opt-out added', at: 9.73 });
    expect(s.draft('quill-d2')!.body).toBe(demoBody('email', 'Revised: opt-out added', 'quill'));
    expect(s.drafts()).toHaveLength(1);

    expect(s.accept(verdict('quill-d2', true), 9.83)).toBe(true);
    expect(s.draft('quill-d2')!.status).toBe('checking');
    expect(s.accept(awaiting('quill-d2'), 9.85)).toBe(true);
    expect(s.draft('quill-d2')).toMatchObject({ status: 'waiting', at: 9.85 });

    expect(s.accept(approve('quill-d2', 'whatsapp'), 10.3)).toBe(true);
    expect(s.draft('quill-d2')).toMatchObject({ status: 'approved', mode: 'whatsapp', at: 10.3 });

    expect(s.accept(sent('quill-d2', 'email'), 10.5)).toBe(true);
    expect(s.draft('quill-d2')).toMatchObject({ status: 'sent', mode: 'whatsapp', channel: 'email', at: 10.5 });
  });

  it('rejected closes a waiting draft', () => {
    const s = storeAt('waiting');
    expect(s.accept(reject('quill-d2'), 10)).toBe(true);
    expect(s.draft('quill-d2')).toMatchObject({ status: 'rejected', at: 10 });
  });

  it('draft() returns undefined for an unknown id, and records are copies', () => {
    const s = storeAt('waiting');
    expect(s.draft('nope')).toBeUndefined();
    const rec = s.draft('quill-d2')!;
    rec.status = 'sent';
    rec.reasons.push('x');
    s.drafts()[0].body = 'tampered';
    expect(s.draft('quill-d2')).toMatchObject({ status: 'waiting', reasons: [] });
    expect(s.draft('quill-d2')!.body).not.toBe('tampered');
  });

  it('drafts() filters by status, agent and kind, in submission order', () => {
    const s = new DashStore();
    s.accept(start('quill'), 9);
    s.accept(start('pulse'), 9);
    s.accept(submit('a', 'quill'), 9.1);
    s.accept(submit('b', 'pulse', 'pulse-1', 'Reply to a comment', 'comment'), 9.2);
    s.accept(submit('c', 'quill'), 9.3);
    s.accept(verdict('c', true), 9.4);
    s.accept(awaiting('c'), 9.5);
    const ids = (f?: Parameters<DashStore['drafts']>[0]) => s.drafts(f).map((d) => d.id);
    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(ids({ status: 'checking' })).toEqual(['a', 'b']);
    expect(ids({ status: 'waiting' })).toEqual(['c']);
    expect(ids({ agent: 'quill' })).toEqual(['a', 'c']);
    expect(ids({ kind: 'comment' })).toEqual(['b']);
    expect(ids({ agent: 'quill', status: 'checking' })).toEqual(['a']);
    expect(ids({ agent: 'quill', kind: 'comment' })).toEqual([]);
  });

  it('editBody changes a waiting draft and nothing else', () => {
    const s = storeAt('waiting');
    const before = s.draft('quill-d2')!;
    expect(s.editBody('quill-d2', 'My own wording.')).toBe(true);
    expect(s.draft('quill-d2')).toEqual({ ...before, body: 'My own wording.' });
  });

  it('editBody notifies subscribers once when it succeeds, adds no activity, and keeps at', () => {
    const s = storeAt('waiting');
    const activity = s.activity().length;
    const at = s.draft('quill-d2')!.at;
    let calls = 0;
    s.subscribe(() => calls++);
    expect(s.editBody('quill-d2', 'My own wording.')).toBe(true);
    expect(calls).toBe(1);
    expect(s.activity()).toHaveLength(activity);
    expect(s.draft('quill-d2')!.at).toBe(at);
  });

  it('editBody does not notify when it is refused', () => {
    const s = storeAt('approved');
    let calls = 0;
    s.subscribe(() => calls++);
    expect(s.editBody('quill-d2', 'new')).toBe(false);
    expect(s.editBody('nope', 'new')).toBe(false);
    expect(calls).toBe(0);
  });

  it('editBody is refused in every other state and for unknown drafts', () => {
    for (const step of ['checking', 'passed', 'returned', 'approved', 'sent'] as const) {
      const s = storeAt(step);
      const body = s.draft('quill-d2')!.body;
      expect(s.editBody('quill-d2', 'new'), step).toBe(false);
      expect(s.draft('quill-d2')!.body, step).toBe(body);
    }
    const rejected = storeAt('waiting');
    rejected.accept(reject('quill-d2'), 10);
    expect(rejected.editBody('quill-d2', 'new')).toBe(false);
    expect(new DashStore().editBody('nope', 'new')).toBe(false);
  });
});

describe('DashStore.statusOf', () => {
  it('is parked > failed > waiting > working > idle', () => {
    const s = new DashStore();
    expect(s.statusOf('quill')).toBe('idle');

    s.accept(start('quill'), 9);
    expect(s.statusOf('quill')).toBe('working');

    s.accept(submit(), 9.1);
    s.accept(verdict('quill-d2', true), 9.2);
    expect(s.statusOf('quill')).toBe('working'); // still being checked, not yet waiting for approval
    s.accept(awaiting('quill-d2'), 9.3);
    expect(s.statusOf('quill')).toBe('waiting'); // waiting beats working

    s.accept(finish('quill', 'quill-1', 'failed'), 9.5);
    expect(s.statusOf('quill')).toBe('failed'); // failed beats waiting

    s.accept(start('quill', 'quill-2'), 9.6);
    expect(s.statusOf('quill')).toBe('waiting'); // a new run clears failed; the draft still waits

    s.accept(approve('quill-d2'), 9.7);
    expect(s.statusOf('quill')).toBe('working');

    s.accept(finish('quill', 'quill-2', 'ok'), 9.8);
    expect(s.statusOf('quill')).toBe('idle');

    expect(s.statusOf('ledger')).toBe('parked');
  });

  it('parked comes from the roster given to the constructor', () => {
    const roster = ROSTER.map((a) => (a.id === 'scout' ? { ...a, parked: true } : a));
    const s = new DashStore(roster);
    expect(s.statusOf('scout')).toBe('parked');
    expect(s.accept(start('scout'), 7)).toBe(false);
  });

  it('a failed run is shown as failed until the next run_started, even with other agents busy', () => {
    const s = new DashStore();
    s.accept(start('scout'), 7);
    s.accept(start('echo'), 7);
    s.accept(finish('scout', 'scout-1', 'failed'), 7.5);
    expect(s.statusOf('scout')).toBe('failed');
    expect(s.statusOf('echo')).toBe('working');
    s.accept(start('scout', 'scout-2'), 8);
    expect(s.statusOf('scout')).toBe('working');
  });
});

describe('DashStore progress, spend, activity', () => {
  it('progressOf follows the open run and clears when it ends or restarts', () => {
    const s = new DashStore();
    expect(s.progressOf('scout')).toBeUndefined();
    s.accept(start('scout'), 7.5);
    expect(s.progressOf('scout')).toBeUndefined();
    s.accept(progress('scout', 'scout-1', 'Researching and grading leads', 3, 10), 7.6);
    expect(s.progressOf('scout')).toEqual({ text: 'Researching and grading leads', done: 3, total: 10 });
    s.accept(progress('scout', 'scout-1', 'Almost there'), 7.7);
    expect(s.progressOf('scout')).toEqual({ text: 'Almost there' });
    s.accept(finish('scout'), 8);
    expect(s.progressOf('scout')).toBeUndefined();
  });

  it('lastProgressOf keeps the latest accepted progress after the run ends, is replaced by the next, and reset clears it', () => {
    const s = new DashStore();
    expect(s.lastProgressOf('scout')).toBeUndefined();
    s.accept(start('scout'), 7.5);
    expect(s.lastProgressOf('scout')).toBeUndefined();
    s.accept(progress('scout', 'scout-1', 'Researching and grading leads', 3, 10), 7.6);
    expect(s.lastProgressOf('scout')).toEqual({ text: 'Researching and grading leads', done: 3, total: 10 });
    s.accept(progress('scout', 'scout-1', 'Researching and grading leads', 10, 10), 7.9);
    s.accept(finish('scout'), 8);
    expect(s.progressOf('scout')).toBeUndefined();
    expect(s.lastProgressOf('scout')).toEqual({ text: 'Researching and grading leads', done: 10, total: 10 });
    s.accept(start('scout', 'scout-2'), 9);
    s.accept(progress('scout', 'scout-2', 'Fresh run', 1, 5), 9.1);
    expect(s.lastProgressOf('scout')).toEqual({ text: 'Fresh run', done: 1, total: 5 });
    expect(s.lastProgressOf('echo')).toBeUndefined();
    s.reset();
    expect(s.lastProgressOf('scout')).toBeUndefined();
  });

  it('lastProgressOf ignores a rejected progress and hands back a copy', () => {
    const s = new DashStore();
    s.accept(start('scout'), 7.5);
    s.accept(progress('scout', 'scout-1', 'Grading', 2, 10), 7.6);
    s.accept(progress('echo', 'scout-1', 'Wrong agent for this run', 9, 9), 7.7); // rejected: run belongs to scout
    const got = s.lastProgressOf('scout');
    expect(got).toEqual({ text: 'Grading', done: 2, total: 10 });
    got!.done = 99;
    expect(s.lastProgressOf('scout')?.done).toBe(2);
  });

  it('spendToday sums run_finished costs per agent, and starts empty', () => {
    const s = new DashStore();
    expect(s.spendToday().size).toBe(0);
    s.accept(start('courier', 'c1'), 10);
    s.accept(finish('courier', 'c1', 'ok', 0.02), 11);
    s.accept(start('courier', 'c2'), 11);
    s.accept(finish('courier', 'c2', 'failed', 0.01), 12);
    s.accept(start('scout'), 7);
    s.accept(finish('scout', 'scout-1', 'ok', 0.18), 8);
    expect(s.spendToday().get('courier')).toBeCloseTo(0.03);
    expect(s.spendToday().get('scout')).toBeCloseTo(0.18);
    expect(s.spendToday().has('quill')).toBe(false);
  });

  it('spendToday returns a copy', () => {
    const s = new DashStore();
    s.accept(start('scout'), 7);
    s.accept(finish('scout', 'scout-1', 'ok', 0.18), 8);
    s.spendToday().set('scout', 99);
    expect(s.spendToday().get('scout')).toBeCloseTo(0.18);
  });

  it('every accepted event appends one readable entry, in order', () => {
    const s = new DashStore();
    s.accept(start('quill', 'quill-1', 'Writing first emails'), 9);
    s.accept(progress('quill', 'quill-1', 'Reading site notes', 2, 5), 9.05);
    s.accept(submit('quill-d2', 'quill', 'quill-1', 'First email to a café'), 9.1);
    s.accept(verdict('quill-d2', false, ['No opt-out line']), 9.2);
    s.accept(submit('quill-d2', 'quill', 'quill-1', 'First email to a café'), 9.3);
    s.accept(verdict('quill-d2', true), 9.4);
    s.accept(awaiting('quill-d2'), 9.5);
    s.accept(approve('quill-d2'), 10);
    s.accept(sent('quill-d2'), 10.5);
    s.accept(finish('quill', 'quill-1', 'ok', 0.3), 11);
    const log = s.activity();
    expect(log.map((a) => [a.at, a.agent])).toEqual([
      [9, 'quill'], [9.05, 'quill'], [9.1, 'quill'], [9.2, 'sentinel'], [9.3, 'quill'],
      [9.4, 'sentinel'], [9.5, 'quill'], [10, 'quill'], [10.5, 'courier'], [11, 'quill'],
    ]);
    expect(log.map((a) => a.text)).toEqual([
      'Quill started: Writing first emails',
      'Quill: Reading site notes (2/5)',
      'Quill submitted an email: First email to a café',
      'Sentinel sent back an email from Quill: No opt-out line',
      'Quill redrafted an email: First email to a café',
      'Sentinel passed an email from Quill',
      'Quill\'s email is waiting for approval',
      'Approved Quill\'s email',
      'Courier sent Quill\'s email by email',
      'Quill finished: Writing first emails',
    ]);
  });

  it('describes failed runs, plan approvals, WhatsApp approvals and rejections', () => {
    const s = new DashStore();
    s.accept(start('muse', 'muse-1', 'Planning'), 15);
    s.accept(submit('p1', 'muse', 'muse-1', 'Next week', 'plan'), 15.5);
    s.accept(verdict('p1', true), 15.6);
    s.accept(awaiting('p1', 'muse'), 15.7);
    s.accept(approve('p1', 'plan'), 16);
    s.accept(submit('p2', 'muse', 'muse-1', 'Another', 'post'), 16.1);
    s.accept(verdict('p2', true), 16.2);
    s.accept(awaiting('p2', 'muse'), 16.3);
    s.accept(reject('p2'), 16.4);
    s.accept(submit('p3', 'muse', 'muse-1', 'Third', 'post'), 16.5);
    s.accept(verdict('p3', true), 16.6);
    s.accept(awaiting('p3', 'muse'), 16.7);
    s.accept(approve('p3', 'whatsapp'), 16.8);
    s.accept(finish('muse', 'muse-1', 'failed'), 17);
    const texts = s.activity().map((a) => a.text);
    expect(texts).toContain('Approved Muse\'s plan as a whole');
    expect(texts).toContain('Approved Muse\'s post from WhatsApp');
    expect(texts).toContain('Rejected Muse\'s post');
    expect(texts[texts.length - 1]).toBe('Muse failed: Planning');
  });

  it('activity() returns a snapshot', () => {
    const s = new DashStore();
    s.accept(start('scout'), 7);
    const first = s.activity();
    s.accept(progress('scout'), 7.1);
    expect(first).toHaveLength(1);
    expect(s.activity()).toHaveLength(2);
  });
});

describe('DashStore.subscribe and reset', () => {
  it('fires once per accepted event, never for a refused one, and stops after unsubscribe', () => {
    const s = new DashStore();
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.accept(start('scout'), 7);
    s.accept(progress('scout'), 7.1);
    expect(calls).toBe(2);
    s.accept(sent('nope'), 7.2);
    s.accept(progress('ledger', 'ledger-1'), 7.3);
    expect(calls).toBe(2);
    off();
    s.accept(progress('scout'), 7.4);
    expect(calls).toBe(2);
  });

  it('the store is already updated when a subscriber is called', () => {
    const s = new DashStore();
    const seen: string[] = [];
    s.subscribe(() => seen.push(s.statusOf('scout')));
    s.accept(start('scout'), 7);
    s.accept(finish('scout'), 8);
    expect(seen).toEqual(['working', 'idle']);
  });

  it('a throwing subscriber does not stop the others or break accept', () => {
    const s = new DashStore();
    let later = 0;
    s.subscribe(() => {
      throw new Error('boom');
    });
    s.subscribe(() => later++);
    expect(() => s.accept(start('scout'), 7)).not.toThrow();
    expect(s.accept(progress('scout'), 7.1)).toBe(true);
    expect(later).toBe(2);
  });

  it('a subscriber may unsubscribe itself while being called', () => {
    const s = new DashStore();
    let a = 0;
    let b = 0;
    const offA = s.subscribe(() => {
      a++;
      offA();
    });
    s.subscribe(() => b++);
    s.accept(start('scout'), 7);
    s.accept(progress('scout'), 7.1);
    expect([a, b]).toEqual([1, 2]);
  });

  it('reset() empties drafts, runs, spend, failures and activity, and notifies subscribers (Review Focus 2)', () => {
    const s = storeAt('waiting');
    s.accept(finish('quill', 'quill-1', 'failed', 0.5), 9.5);
    let calls = 0;
    s.subscribe(() => calls++);
    s.reset();
    expect(calls).toBe(1);
    expect(s.drafts()).toEqual([]);
    expect(s.draft('quill-d2')).toBeUndefined();
    expect(s.spendToday().size).toBe(0);
    expect(s.activity()).toEqual([]);
    expect(s.statusOf('quill')).toBe('idle');
    expect(s.progressOf('quill')).toBeUndefined();
    expect(s.statusOf('ledger')).toBe('parked');
    // The old run is forgotten, finished or not, so the same run id can be used again on the next day...
    expect(s.accept(progress('quill', 'quill-1'), 9)).toBe(true);
    // ...and nothing leaks into it: the same draft id starts afresh.
    s.accept(start('quill'), 9);
    expect(s.accept(submit(), 9.1)).toBe(true);
    expect(s.draft('quill-d2')!.status).toBe('checking');
    expect(s.accept(awaiting('quill-d2'), 9.2)).toBe(false); // the old "passed" verdict did not survive
  });
});

describe('DashStore.hasOpenRun', () => {
  it('is true after run_started and false after run_finished', () => {
    const s = new DashStore();
    expect(s.hasOpenRun('quill')).toBe(false);
    s.accept(start('quill'), 9);
    expect(s.hasOpenRun('quill')).toBe(true);
    expect(s.hasOpenRun('linx')).toBe(false);
    s.accept(finish('quill'), 10);
    expect(s.hasOpenRun('quill')).toBe(false);
  });

  it('is true for a run opened implicitly by progress, and false once it finishes', () => {
    const s = new DashStore();
    s.accept(progress('scout', 'scout-9', 'Searching', 1, 3), 9);
    expect(s.hasOpenRun('scout')).toBe(true);
    s.accept(finish('scout', 'scout-9'), 9.5);
    expect(s.hasOpenRun('scout')).toBe(false);
  });

  it('stays true while the agent has a waiting draft, and is false after reset', () => {
    const s = storeAt('waiting');
    expect(s.statusOf('quill')).toBe('waiting');
    expect(s.hasOpenRun('quill')).toBe(true);
    s.reset();
    expect(s.hasOpenRun('quill')).toBe(false);
  });
});

describe('DashStore with DEMO_DAY', () => {
  const feed = () => {
    const s = new DashStore();
    const refused: string[] = [];
    for (const { atHour, event } of DEMO_DAY) {
      if (!s.accept(event, atHour)) refused.push(`${atHour} ${JSON.stringify(event)}`);
    }
    return { s, refused };
  };

  it('accepts every event of the day, in order', () => {
    expect(feed().refused).toEqual([]);
  });

  it('ends with nothing waiting: 12 drafts sent, the plan approved, nobody mid-run', () => {
    const { s } = feed();
    expect(s.drafts({ status: 'waiting' })).toHaveLength(0);
    expect(s.drafts({ status: 'sent' })).toHaveLength(12);
    expect(s.drafts({ status: 'approved' }).map((d) => d.id)).toEqual(['muse-plan1']);
    expect(s.drafts()).toHaveLength(13);
    for (const a of ROSTER) expect(s.statusOf(a.id), a.id).toBe(a.parked ? 'parked' : 'idle');
    expect(s.activity()).toHaveLength(DEMO_DAY.length);
  });

  it('records Sentinel sending quill-d2 back once, and its total spend', () => {
    const { s } = feed();
    expect(s.activity().filter((a) => a.text.startsWith('Sentinel sent back'))).toHaveLength(1);
    expect(s.draft('quill-d2')).toMatchObject({ status: 'sent', reasons: [] });
    const total = [...s.spendToday().values()].reduce((x, y) => x + y, 0);
    expect(total).toBeCloseTo(
      DEMO_DAY.reduce((sum, { event }) => sum + (event.type === 'run_finished' ? event.costUsd : 0), 0),
    );
  });

  it('is repeatable after reset (the loop restart)', () => {
    const { s } = feed();
    const first = snapshot(s);
    s.reset();
    for (const { atHour, event } of DEMO_DAY) expect(s.accept(event, atHour)).toBe(true);
    expect(snapshot(s)).toBe(first);
  });
});

describe('demoBody', () => {
  const kinds: DraftKind[] = ['email', 'post', 'comment', 'linkedin', 'proposal', 'plan'];
  const agents: AgentId[] = ['quill', 'echo', 'linx', 'pulse', 'muse', 'forge'];

  it('is deterministic and carries the summary', () => {
    for (const kind of kinds) {
      const body = demoBody(kind, 'A short summary', 'quill');
      expect(demoBody(kind, 'A short summary', 'quill')).toBe(body);
      expect(body).toContain('A short summary');
    }
  });

  it('is generic: no addresses, links, phone numbers or digits', () => {
    for (const kind of kinds) {
      for (const agent of agents) {
        const body = demoBody(kind, 'A short summary', agent);
        expect(body, `${kind}/${agent}`).not.toMatch(/@|https?:|www\.|\.com|\+\d|\d/);
      }
    }
  });

  it('is two to four sentences after its heading line', () => {
    for (const kind of kinds) {
      for (const agent of agents) {
        const [, ...rest] = demoBody(kind, 'A short summary', agent).split('\n');
        const sentences = rest.join(' ').match(/[.!?](?=\s|$)/g) ?? [];
        expect(sentences.length, `${kind}/${agent}`).toBeGreaterThanOrEqual(2);
        expect(sentences.length, `${kind}/${agent}`).toBeLessThanOrEqual(4);
      }
    }
  });

  it('never doubles its heading label (the summary may already carry it)', () => {
    const labels = /Connection note|Reply to|Post idea|Proposal|Plan/gi;
    const summaries = new Map<DraftKind, string[]>();
    for (const { event } of DEMO_DAY) {
      if (event.type === 'draft_submitted') summaries.set(event.kind, [...(summaries.get(event.kind) ?? []), event.summary]);
    }
    summaries.set('linkedin', [...(summaries.get('linkedin') ?? []), 'Connection note: local business owner']);
    summaries.set('comment', [...(summaries.get('comment') ?? []), 'Reply to a new comment']);
    for (const [kind, list] of summaries) {
      for (const summary of list) {
        const first = demoBody(kind, summary, 'quill').split('\n')[0];
        expect(first.match(labels)?.length ?? 0, first).toBeLessThanOrEqual(1);
      }
    }
    expect(demoBody('linkedin', 'Connection note: x', 'linx').split('\n')[0]).toBe('Connection note: x');
    expect(demoBody('comment', 'Reply to a new comment', 'pulse').split('\n')[0]).toBe('Reply to a new comment');
    expect(demoBody('linkedin', 'Shared interest', 'linx').split('\n')[0]).toBe('Connection note: Shared interest');
  });

  it('differs by kind, and an inbox answer reads differently from a first email', () => {
    expect(new Set(kinds.map((k) => demoBody(k, 'S', 'quill'))).size).toBe(kinds.length);
    expect(demoBody('email', 'S', 'echo')).not.toBe(demoBody('email', 'S', 'quill'));
  });
});
