import { describe, it, expect } from 'vitest';
import { Reactions } from '../src/reactions';
import type { Action } from '../src/reactions';
import type { AgentEvent } from '../src/events';
import { ROSTER } from '../src/roster';
import type { AgentId } from '../src/types';

const start = (agent: AgentId, runId = 'r1', task = 'find leads'): AgentEvent =>
  ({ type: 'run_started', runId, agent, task });

const submit = (runId = 'r1', draftId = 'd1'): AgentEvent =>
  ({ type: 'draft_submitted', runId, agent: 'quill', draftId, kind: 'email', summary: 'First email' });

describe('Reactions.handle', () => {
  it('run_started: walks to the seat, types, and shows the task', () => {
    const r = new Reactions();
    expect(r.handle(start('scout'))).toEqual<Action[]>([
      { kind: 'goto', agent: 'scout', target: 'seat' },
      { kind: 'state', agent: 'scout', state: 'typing' },
      { kind: 'label', agent: 'scout', text: 'find leads' },
    ]);
    expect(r.activeRun('scout')).toBe('r1');
  });

  it('run_started for an agent that is already working only relabels (one label action)', () => {
    const r = new Reactions();
    r.handle(start('scout', 'r1', 'find leads'));
    expect(r.handle(start('scout', 'r2', 'grade leads'))).toEqual<Action[]>([
      { kind: 'label', agent: 'scout', text: 'grade leads' },
    ]);
    expect(r.activeRun('scout')).toBe('r2');
  });

  it('progress: label is the text', () => {
    const r = new Reactions();
    expect(r.handle({ type: 'progress', runId: 'r1', agent: 'scout', text: 'searching' })).toEqual<Action[]>([
      { kind: 'label', agent: 'scout', text: 'searching' },
    ]);
  });

  it('progress: appends done/total when both are given', () => {
    const r = new Reactions();
    expect(r.handle({ type: 'progress', runId: 'r1', agent: 'scout', text: 'searching', done: 3, total: 10 })).toEqual<Action[]>([
      { kind: 'label', agent: 'scout', text: 'searching · 3/10' },
    ]);
  });

  it('progress: a counter on its own is not shown', () => {
    const r = new Reactions();
    expect(r.handle({ type: 'progress', runId: 'r1', agent: 'scout', text: 'searching', done: 3 })).toEqual<Action[]>([
      { kind: 'label', agent: 'scout', text: 'searching' },
    ]);
  });

  it('draft_submitted: carries the draft to Sentinel, walks back, and types again', () => {
    const r = new Reactions();
    r.handle(start('quill', 'r1', 'write email'));
    expect(r.handle(submit())).toEqual<Action[]>([
      { kind: 'state', agent: 'quill', state: 'carrying' },
      { kind: 'goto', agent: 'quill', target: 'sentinel' },
      { kind: 'goto', agent: 'quill', target: 'seat' },
      { kind: 'state', agent: 'quill', state: 'typing' },
    ]);
  });

  it('draft_submitted with an unknown runId still maps by agent', () => {
    const r = new Reactions();
    expect(r.handle(submit('never-started'))).toEqual<Action[]>([
      { kind: 'state', agent: 'quill', state: 'carrying' },
      { kind: 'goto', agent: 'quill', target: 'sentinel' },
      { kind: 'goto', agent: 'quill', target: 'seat' },
      { kind: 'state', agent: 'quill', state: 'typing' },
    ]);
  });

  it('sentinel_result with pass false: Sentinel says who the draft goes back to', () => {
    const r = new Reactions();
    r.handle(submit());
    expect(r.handle({ type: 'sentinel_result', draftId: 'd1', pass: false, reasons: ['no opt-out'] })).toEqual<Action[]>([
      { kind: 'label', agent: 'sentinel', text: 'back to Quill' },
    ]);
  });

  it('sentinel_result with pass true does nothing', () => {
    const r = new Reactions();
    r.handle(submit());
    expect(r.handle({ type: 'sentinel_result', draftId: 'd1', pass: true, reasons: [] })).toEqual([]);
  });

  it('sentinel_result for an unknown draftId does nothing', () => {
    const r = new Reactions();
    expect(r.handle({ type: 'sentinel_result', draftId: 'nope', pass: false, reasons: ['x'] })).toEqual([]);
  });

  it('awaiting_approval: marker on for the author', () => {
    const r = new Reactions();
    expect(r.handle({ type: 'awaiting_approval', draftId: 'd1', agent: 'quill' })).toEqual<Action[]>([
      { kind: 'marker', agent: 'quill', on: true },
    ]);
  });

  it('approved: marker off, then the steps and the Core pulse', () => {
    const r = new Reactions();
    r.handle(submit());
    expect(r.handle({ type: 'approved', draftId: 'd1', mode: 'item' })).toEqual<Action[]>([
      { kind: 'marker', agent: 'quill', on: false },
      { kind: 'steps_pulse' },
      { kind: 'core_pulse' },
    ]);
  });

  it('approved for an unknown draftId does nothing', () => {
    const r = new Reactions();
    expect(r.handle({ type: 'approved', draftId: 'nope', mode: 'item' })).toEqual([]);
  });

  it('approved finds the author from awaiting_approval alone', () => {
    const r = new Reactions();
    r.handle({ type: 'awaiting_approval', draftId: 'd9', agent: 'linx' });
    expect(r.handle({ type: 'approved', draftId: 'd9', mode: 'whatsapp' })).toEqual<Action[]>([
      { kind: 'marker', agent: 'linx', on: false },
      { kind: 'steps_pulse' },
      { kind: 'core_pulse' },
    ]);
  });

  it('rejected: marker off for the author', () => {
    const r = new Reactions();
    r.handle(submit());
    expect(r.handle({ type: 'rejected', draftId: 'd1' })).toEqual<Action[]>([
      { kind: 'marker', agent: 'quill', on: false },
    ]);
  });

  it('rejected for an unknown draftId does nothing', () => {
    const r = new Reactions();
    expect(r.handle({ type: 'rejected', draftId: 'nope' })).toEqual([]);
  });

  it('sent: Courier goes to the window and types, a streak leaves, the author cheers', () => {
    const r = new Reactions();
    r.handle(submit());
    expect(r.handle({ type: 'sent', draftId: 'd1', channel: 'email' })).toEqual<Action[]>([
      { kind: 'goto', agent: 'courier', target: 'courier_window' },
      { kind: 'state', agent: 'courier', state: 'typing' },
      { kind: 'streak' },
      { kind: 'state', agent: 'quill', state: 'cheering' },
    ]);
  });

  it('sent for an unknown draftId does nothing', () => {
    const r = new Reactions();
    expect(r.handle({ type: 'sent', draftId: 'nope', channel: 'email' })).toEqual([]);
  });

  it('run_finished ok: goes idle and clears the label', () => {
    const r = new Reactions();
    r.handle(start('scout'));
    expect(r.handle({ type: 'run_finished', runId: 'r1', agent: 'scout', status: 'ok', costUsd: 0.12 })).toEqual<Action[]>([
      { kind: 'state', agent: 'scout', state: 'idle' },
      { kind: 'goto', agent: 'scout', target: 'idle' },
      { kind: 'label', agent: 'scout', text: '' },
    ]);
    expect(r.activeRun('scout')).toBeUndefined();
  });

  it('run_finished failed: label says the run failed', () => {
    const r = new Reactions();
    r.handle(start('scout'));
    expect(r.handle({ type: 'run_finished', runId: 'r1', agent: 'scout', status: 'failed', costUsd: 0 })).toEqual<Action[]>([
      { kind: 'state', agent: 'scout', state: 'idle' },
      { kind: 'goto', agent: 'scout', target: 'idle' },
      { kind: 'label', agent: 'scout', text: 'run failed' },
    ]);
  });

  it('run_finished with an unknown runId still maps by agent', () => {
    const r = new Reactions();
    expect(r.handle({ type: 'run_finished', runId: 'ghost', agent: 'echo', status: 'ok', costUsd: 0 })).toEqual<Action[]>([
      { kind: 'state', agent: 'echo', state: 'idle' },
      { kind: 'goto', agent: 'echo', target: 'idle' },
      { kind: 'label', agent: 'echo', text: '' },
    ]);
  });

  it('overlapping runs: the agent only goes idle when its last run finishes', () => {
    const r = new Reactions();
    r.handle(start('scout', 'r1'));
    r.handle(start('scout', 'r2'));
    expect(r.handle({ type: 'run_finished', runId: 'r2', agent: 'scout', status: 'ok', costUsd: 0 })).toEqual([]);
    expect(r.activeRun('scout')).toBe('r1');
    expect(r.handle({ type: 'run_finished', runId: 'r1', agent: 'scout', status: 'ok', costUsd: 0 })).toHaveLength(3);
    expect(r.activeRun('scout')).toBeUndefined();
  });

  it('overlapping runs: a failure still shows even while another run is going (spec §8)', () => {
    const r = new Reactions();
    r.handle(start('scout', 'r1'));
    r.handle(start('scout', 'r2'));
    expect(r.handle({ type: 'run_finished', runId: 'r2', agent: 'scout', status: 'failed', costUsd: 0 })).toEqual<Action[]>([
      { kind: 'label', agent: 'scout', text: 'run failed' },
    ]);
    expect(r.activeRun('scout')).toBe('r1');
  });

  it('a new run after a finished one walks to the seat again', () => {
    const r = new Reactions();
    r.handle(start('scout', 'r1'));
    r.handle({ type: 'run_finished', runId: 'r1', agent: 'scout', status: 'ok', costUsd: 0 });
    expect(r.handle(start('scout', 'r2'))).toHaveLength(3);
  });
});

describe('Reactions: parked agents', () => {
  const parked: AgentEvent[] = [
    { type: 'run_started', runId: 'p1', agent: 'ledger', task: 't' },
    { type: 'progress', runId: 'p1', agent: 'ledger', text: 'x', done: 1, total: 2 },
    { type: 'draft_submitted', runId: 'p1', agent: 'keeper', draftId: 'pd', kind: 'email', summary: 's' },
    { type: 'awaiting_approval', draftId: 'pd2', agent: 'keeper' },
    { type: 'run_finished', runId: 'p1', agent: 'ledger', status: 'ok', costUsd: 0 },
  ];

  it.each(parked)('$type for a parked agent produces no actions', (e) => {
    expect(new Reactions().handle(e)).toEqual([]);
  });

  it('does not track runs or drafts for a parked agent', () => {
    const r = new Reactions();
    r.handle(parked[0]);
    r.handle(parked[2]);
    expect(r.activeRun('ledger')).toBeUndefined();
    expect(r.handle({ type: 'approved', draftId: 'pd', mode: 'item' })).toEqual([]);
  });

  it('follows the roster it is given', () => {
    const roster = ROSTER.map((a) => (a.id === 'scout' ? { ...a, parked: true } : a));
    expect(new Reactions(roster).handle(start('scout'))).toEqual([]);
  });
});

describe('Reactions: garbage in', () => {
  it.each([
    ['unknown type', { type: 'nope' }],
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a string', 'run_started'],
    ['an empty object', {}],
    ['an array', []],
    ['an unknown agent', { type: 'run_started', runId: 'r1', agent: 'bob', task: 't' }],
    ['a missing field', { type: 'run_started', runId: 'r1', agent: 'scout' }],
  ])('%s gives no actions and does not throw', (_name, input) => {
    const r = new Reactions();
    expect(() => r.handle(input)).not.toThrow();
    expect(r.handle(input)).toEqual([]);
  });

  it('garbage does not change state', () => {
    const r = new Reactions();
    r.handle({ type: 'run_started', runId: 'r1', agent: 'scout' });
    expect(r.activeRun('scout')).toBeUndefined();
  });
});
