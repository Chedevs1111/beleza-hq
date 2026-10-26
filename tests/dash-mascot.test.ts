import { describe, expect, it } from 'vitest';
import { GREET_MS, SLEEP_MINUTES, YAWN_MINUTES, mascotSvg, moodFor } from '../src/dash/mascot';
import type { MascotMood } from '../src/dash/mascot';
import type { AgentEvent } from '../src/events';

const ALL: MascotMood[] = ['bright', 'envelope', 'cheer', 'doze', 'calm', 'greet', 'think', 'proud', 'annoyed', 'yawn', 'sleep'];

const ev = (event: AgentEvent) => ({ kind: 'event', event }) as const;
const started: AgentEvent = { type: 'run_started', runId: 'r1', agent: 'scout', task: 'Find leads' };
const finished = (status: 'ok' | 'failed'): AgentEvent => ({ type: 'run_finished', runId: 'r1', agent: 'scout', status, costUsd: 0.01 });

describe('moodFor', () => {
  it('greets when the page opens, and the greeting is brief', () => {
    expect(moodFor({ kind: 'open' }, 'calm')).toBe('greet');
    expect(moodFor({ kind: 'open' }, 'doze')).toBe('greet');
    expect(GREET_MS).toBe(1500);
  });

  it('thinks when a run starts', () => {
    expect(moodFor(ev(started), 'doze')).toBe('think');
    expect(moodFor(ev(started), 'sleep')).toBe('think');
  });

  it('is proud when something is approved, and cheers when it is sent', () => {
    expect(moodFor(ev({ type: 'approved', draftId: 'd1', mode: 'item' }), 'envelope')).toBe('proud');
    expect(moodFor(ev({ type: 'sent', draftId: 'd1', channel: 'email' }), 'proud')).toBe('cheer');
  });

  it('is annoyed when a run fails, and leaves the mood alone when it ends well', () => {
    expect(moodFor(ev(finished('failed')), 'bright')).toBe('annoyed');
    expect(moodFor(ev(finished('ok')), 'bright')).toBe('bright');
  });

  it('leaves the mood alone for events that say nothing about feelings', () => {
    const quiet: AgentEvent[] = [
      { type: 'progress', runId: 'r1', agent: 'scout', text: 'Grading', done: 1, total: 4 },
      { type: 'draft_submitted', runId: 'r1', agent: 'scout', draftId: 'd1', kind: 'email', summary: 'Hello' },
      { type: 'sentinel_result', draftId: 'd1', pass: true, reasons: [] },
      { type: 'awaiting_approval', draftId: 'd1', agent: 'scout' },
      { type: 'rejected', draftId: 'd1' },
    ];
    for (const e of quiet) expect(moodFor(ev(e), 'calm')).toBe('calm');
  });

  it('yawns after 3 idle minutes and sleeps after 6', () => {
    expect([YAWN_MINUTES, SLEEP_MINUTES]).toEqual([3, 6]);
    expect(moodFor({ kind: 'idle', minutes: 2.9 }, 'doze')).toBe('doze');
    expect(moodFor({ kind: 'idle', minutes: 3 }, 'doze')).toBe('yawn');
    expect(moodFor({ kind: 'idle', minutes: 5.9 }, 'yawn')).toBe('yawn');
    expect(moodFor({ kind: 'idle', minutes: 6 }, 'yawn')).toBe('sleep');
    expect(moodFor({ kind: 'idle', minutes: 60 }, 'sleep')).toBe('sleep');
  });

  it('any input wakes it (idle back at 0), but the greeting is only for opening the page', () => {
    expect(moodFor({ kind: 'idle', minutes: 0 }, 'sleep')).toBe('calm');
    expect(moodFor({ kind: 'idle', minutes: 0 }, 'yawn')).toBe('calm');
    expect(moodFor({ kind: 'idle', minutes: 0 }, 'doze')).toBe('doze');
    expect(moodFor({ kind: 'idle', minutes: 1 }, 'envelope')).toBe('envelope');
  });
});

describe('mascotSvg moods', () => {
  it('draws a static, decorative svg with exactly two eyes for every mood', () => {
    for (const m of ALL) {
      const svg = mascotSvg(m);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain(`data-mood="${m}"`);
      expect(svg.match(/mascot-eye/g)?.length).toBe(2);
      expect(svg).not.toMatch(/<script|onload|onerror|href=|<animate|<style/i);
    }
  });

  it('gives every mood its own face', () => {
    expect(new Set(ALL.map(mascotSvg)).size).toBe(ALL.length);
  });
});
