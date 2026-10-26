import { describe, it, expect } from 'vitest';
import { teamItems, teamLabel } from '../src/dash/team';
import { DashStore } from '../src/dash/store';
import { ROSTER } from '../src/roster';

const byId = (store: DashStore) => new Map(teamItems(store).map((t) => [t.id, t]));

describe('teamLabel', () => {
  it('joins the name and the ring label with an em dash', () => {
    expect(teamLabel('Scout', 'working')).toBe('Scout — Working');
    expect(teamLabel('Quill', 'waiting')).toBe('Quill — Waiting on you');
    expect(teamLabel('Echo', 'idle')).toBe('Echo — Idle');
    expect(teamLabel('Ledger', 'parked')).toBe('Ledger — Parked');
    expect(teamLabel('Atlas', 'failed')).toBe('Atlas — Run failed');
  });
});

describe('teamItems', () => {
  it('lists all 15 in roster order with distinct two-letter initials', () => {
    const items = teamItems(new DashStore());
    expect(items.map((t) => t.id)).toEqual(ROSTER.map((a) => a.id));
    expect(items).toHaveLength(15);
    expect(new Set(items.map((t) => t.initials)).size).toBe(15);
    for (const t of items) expect(t.initials).toHaveLength(2);
  });

  it('starts everyone idle except the parked pair', () => {
    const items = byId(new DashStore());
    expect(items.get('scout')).toMatchObject({ status: 'idle', label: 'Scout — Idle' });
    expect(items.get('ledger')).toMatchObject({ status: 'parked', label: 'Ledger — Parked' });
    expect(items.get('keeper')).toMatchObject({ status: 'parked', label: 'Keeper — Parked' });
  });

  it('reflects working, waiting and failed from the store', () => {
    const store = new DashStore();
    store.accept({ type: 'run_started', runId: 'r1', agent: 'scout', task: 'Find leads' }, 7);
    store.accept({ type: 'run_started', runId: 'r2', agent: 'quill', task: 'Write' }, 7);
    store.accept({ type: 'draft_submitted', runId: 'r2', agent: 'quill', draftId: 'd1', kind: 'email', summary: 'Hello' }, 7.1);
    store.accept({ type: 'sentinel_result', draftId: 'd1', pass: true, reasons: [] }, 7.2);
    store.accept({ type: 'awaiting_approval', draftId: 'd1', agent: 'quill' }, 7.3);
    store.accept({ type: 'run_started', runId: 'r3', agent: 'atlas', task: 'Check a site' }, 7.4);
    store.accept({ type: 'run_finished', runId: 'r3', agent: 'atlas', status: 'failed', costUsd: 0.02 }, 7.5);
    const items = byId(store);
    expect(items.get('scout')).toMatchObject({ status: 'working', label: 'Scout — Working' });
    expect(items.get('quill')).toMatchObject({ status: 'waiting', label: 'Quill — Waiting on you' });
    expect(items.get('atlas')).toMatchObject({ status: 'failed', label: 'Atlas — Run failed' });
    expect(items.get('echo')).toMatchObject({ status: 'idle', label: 'Echo — Idle' });
  });
});
