import { describe, it, expect } from 'vitest';
import { cuesFor, islandView, shownMood } from '../src/dash/island';
import { mascotSvg } from '../src/dash/mascot';
import type { MascotMood } from '../src/dash/mascot';
import { RING } from '../src/dash/team';
import { DashStore } from '../src/dash/store';
import type { AgentStatus } from '../src/dash/store';
import type { DraftKind } from '../src/events';
import type { AgentId } from '../src/types';

/** Brings a draft to `waiting` at demo hour `at`. */
function waiting(store: DashStore, draftId: string, at: number, opts: { agent?: AgentId; kind?: DraftKind; summary?: string } = {}): void {
  const agent = opts.agent ?? 'quill';
  const runId = `${draftId}-run`;
  store.accept({ type: 'run_started', runId, agent, task: 'Seed' }, at - 0.3);
  store.accept({ type: 'draft_submitted', runId, agent, draftId, kind: opts.kind ?? 'email', summary: opts.summary ?? `Summary of ${draftId}` }, at - 0.2);
  store.accept({ type: 'sentinel_result', draftId, pass: true, reasons: [] }, at - 0.1);
  store.accept({ type: 'awaiting_approval', draftId, agent }, at);
  store.accept({ type: 'run_finished', runId, agent, status: 'ok', costUsd: 0.01 }, at);
}

/** Takes a waiting draft all the way to `sent` at demo hour `at`. */
function sent(store: DashStore, draftId: string, at: number): void {
  store.accept({ type: 'approved', draftId, mode: 'item' }, at - 0.01);
  store.accept({ type: 'sent', draftId, channel: 'email' }, at);
}

describe('islandView', () => {
  it('dozes when nothing is happening', () => {
    const v = islandView(new DashStore(), 9);
    expect(v.mood).toBe('doze');
    expect(v.waiting).toBe(0);
    expect(v.draft).toBeUndefined();
    expect(v.agent).toBeUndefined();
    expect(v.line.length).toBeGreaterThan(0);
  });

  it('is bright for a working agent, with its counter', () => {
    const store = new DashStore();
    store.accept({ type: 'run_started', runId: 'r1', agent: 'scout', task: 'Find leads' }, 7);
    store.accept({ type: 'progress', runId: 'r1', agent: 'scout', text: 'Grading leads', done: 4, total: 10 }, 7.1);
    const v = islandView(store, 7.2);
    expect(v.mood).toBe('bright');
    expect(v.line).toBe('Scout · 4/10');
    expect(v.sub).toBe('Grading leads');
    expect(v.agent).toBe('scout');
    expect(v.waiting).toBe(0);
  });

  it('shows a progress line without a counter when there is none', () => {
    const store = new DashStore();
    store.accept({ type: 'run_started', runId: 'r1', agent: 'echo', task: 'Read the inbox' }, 7);
    store.accept({ type: 'progress', runId: 'r1', agent: 'echo', text: 'Reading replies' }, 7.1);
    const v = islandView(store, 7.2);
    expect(v.mood).toBe('bright');
    expect(v.line).toBe('Echo · Reading replies');
  });

  it('is bright for an agent whose run has started but not reported progress', () => {
    const store = new DashStore();
    store.accept({ type: 'run_started', runId: 'r1', agent: 'muse', task: "Plan next week's content" }, 7);
    const v = islandView(store, 7.05);
    expect(v.mood).toBe('bright');
    expect(v.agent).toBe('muse');
    expect(v.line).toContain('Muse');
  });

  it('shows the newest waiting draft as an envelope', () => {
    const store = new DashStore();
    waiting(store, 'd1', 8, { agent: 'quill', summary: 'First email: a café site' });
    waiting(store, 'd2', 8.5, { agent: 'linx', kind: 'linkedin', summary: 'Connection note' });
    const v = islandView(store, 8.6);
    expect(v.mood).toBe('envelope');
    expect(v.draft?.id).toBe('d2');
    expect(v.agent).toBe('linx');
    expect(v.line).toBe('Linx · LinkedIn note');
    expect(v.sub).toBe('Connection note');
    expect(v.waiting).toBe(2);
  });

  it('counts every waiting draft but not the ones already decided', () => {
    const store = new DashStore();
    waiting(store, 'd1', 8);
    waiting(store, 'd2', 8.2);
    waiting(store, 'd3', 8.4);
    store.accept({ type: 'rejected', draftId: 'd2' }, 8.5);
    const v = islandView(store, 8.6);
    expect(v.waiting).toBe(2);
    expect(v.draft?.id).toBe('d3');
  });

  it('prefers a waiting draft over a working agent', () => {
    const store = new DashStore();
    waiting(store, 'd1', 8);
    store.accept({ type: 'run_started', runId: 'r2', agent: 'scout', task: 'Find leads' }, 8.1);
    store.accept({ type: 'progress', runId: 'r2', agent: 'scout', text: 'Grading', done: 1, total: 10 }, 8.2);
    expect(islandView(store, 8.3).mood).toBe('envelope');
  });

  it('cheers for 0.12 demo hours after something is sent, then goes back to what it was', () => {
    const store = new DashStore();
    waiting(store, 'd1', 9);
    waiting(store, 'd2', 9.1);
    sent(store, 'd1', 9.2);
    const during = islandView(store, 9.2 + 0.1);
    expect(during.mood).toBe('cheer');
    expect(during.draft?.id).toBe('d1');
    expect(during.waiting).toBe(1);
    expect(during.line.toLowerCase()).toContain('sent');
    const after = islandView(store, 9.2 + 0.13);
    expect(after.mood).toBe('envelope');
    expect(after.draft?.id).toBe('d2');
  });

  it('cheers across midnight too', () => {
    const store = new DashStore();
    waiting(store, 'd1', 23.9);
    sent(store, 'd1', 23.99);
    expect(islandView(store, 0.005).mood).toBe('cheer');
    expect(islandView(store, 0.2).mood).toBe('doze');
  });

  it('does not cheer before the send happened', () => {
    const store = new DashStore();
    waiting(store, 'd1', 9);
    sent(store, 'd1', 9.2);
    expect(islandView(store, 9.1).mood).toBe('doze');
  });

  it('hands back a copy of the draft and leaves markup in the text as it is', () => {
    const store = new DashStore();
    waiting(store, 'd1', 8, { summary: '<img src=x onerror=alert(1)> & more' });
    const v = islandView(store, 8.1);
    expect(v.sub).toBe('<img src=x onerror=alert(1)> & more');
    v.draft!.reasons.push('changed');
    expect(store.draft('d1')!.reasons).toEqual([]);
  });
});

describe('shownMood', () => {
  it('is calm while open with nothing waiting', () => {
    const store = new DashStore();
    expect(shownMood(islandView(store, 9), true)).toBe('calm');
  });

  it('lets the cheer show while open with nothing waiting (approving from the island)', () => {
    const store = new DashStore();
    waiting(store, 'd1', 9);
    sent(store, 'd1', 9.2);
    const v = islandView(store, 9.25);
    expect(v.waiting).toBe(0);
    expect(shownMood(v, true)).toBe('cheer');
    expect(shownMood(islandView(store, 9.2 + 0.13), true)).toBe('calm');
  });

  it('is the view mood when closed, or open with something waiting', () => {
    const store = new DashStore();
    expect(shownMood(islandView(store, 9), false)).toBe('doze');
    waiting(store, 'd1', 9);
    expect(shownMood(islandView(store, 9.1), true)).toBe('envelope');
  });
});

describe('RING', () => {
  const STATUSES: AgentStatus[] = ['idle', 'working', 'waiting', 'parked', 'failed'];

  it('covers every status with a colour and a label', () => {
    expect(Object.keys(RING).sort()).toEqual([...STATUSES].sort());
    for (const s of STATUSES) {
      expect(RING[s].color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(RING[s].label.length).toBeGreaterThan(0);
    }
  });

  it('uses the agreed labels', () => {
    expect(Object.fromEntries(STATUSES.map((s) => [s, RING[s].label]))).toEqual({
      working: 'Working',
      waiting: 'Waiting on you',
      idle: 'Idle',
      parked: 'Parked',
      failed: 'Run failed',
    });
  });

  it('keeps working amethyst and waiting gold apart from the rest', () => {
    expect(RING.working.color.toLowerCase()).toBe('#8b5cf6');
    expect(RING.waiting.color.toLowerCase()).toBe('#e9c26b');
    expect(new Set(STATUSES.map((s) => RING[s].color.toLowerCase())).size).toBeGreaterThanOrEqual(4);
  });
});

describe('mascotSvg', () => {
  const MOODS: MascotMood[] = ['bright', 'envelope', 'cheer', 'doze', 'calm'];

  it('is a static, decorative svg with two eyes for every mood', () => {
    for (const m of MOODS) {
      const svg = mascotSvg(m);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain(`data-mood="${m}"`);
      expect(svg.match(/mascot-eye/g)?.length).toBe(2);
      expect(svg).not.toMatch(/<script|onload|onerror|href=/i);
    }
  });

  it('looks different for each mood', () => {
    expect(new Set(MOODS.map(mascotSvg)).size).toBe(MOODS.length);
  });
});

describe('cuesFor', () => {
  const none = { freshDraft: false, sent: false, endedOk: false, failed: false, approved: false, started: false };

  it('is silent when nothing happened', () => {
    expect(cuesFor(none)).toEqual([]);
  });

  it('chimes attention alone when a run finishes with a new draft (no done on top)', () => {
    expect(cuesFor({ ...none, freshDraft: true, endedOk: true })).toEqual(['attention']);
  });

  it('ticks done when a run ends well with nothing new waiting', () => {
    expect(cuesFor({ ...none, endedOk: true })).toEqual(['done']);
  });

  it('keeps the send whoosh next to an attention chime', () => {
    expect(cuesFor({ ...none, freshDraft: true, endedOk: true, sent: true })).toEqual(['attention', 'sent']);
  });

  it('has a cue for a start, an approval and a failure', () => {
    expect(cuesFor({ ...none, started: true })).toEqual(['think']);
    expect(cuesFor({ ...none, approved: true })).toEqual(['proud']);
    expect(cuesFor({ ...none, failed: true })).toEqual(['annoyed']);
  });
});
