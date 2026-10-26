import { describe, expect, it, vi } from 'vitest';
import { ALERT_MS, AlertQueue, DEFAULT_PILLS, pillViews, runAlert } from '../src/dash/pills';
import type { PillId } from '../src/dash/pills';
import { formatZar } from '../src/dash/pages/spend';
import { DEMO_DAY } from '../src/demo/script';
import { DashStore } from '../src/dash/store';

/** A store fed the scripted day up to `hour`, each event stamped with its own script time. */
function storeAt(hour: number): DashStore {
  const store = new DashStore();
  for (const step of DEMO_DAY) if (step.atHour <= hour) store.accept(step.event, step.atHour);
  return store;
}

const byId = (views: ReturnType<typeof pillViews>) => Object.fromEntries(views.map((v) => [v.id, v]));

describe('pillViews', () => {
  const store = storeAt(10.5);
  const views = byId(pillViews(store, 10.5, ['waiting', 'next', 'spend', 'leads']));

  it('counts the drafts waiting for a decision', () => {
    const n = store.drafts({ status: 'waiting' }).length;
    expect(n).toBeGreaterThan(0);
    expect(views.waiting).toMatchObject({ id: 'waiting', value: String(n), tone: 'warn' });
    expect(views.waiting.label.length).toBeGreaterThan(0);
  });

  it("totals today's spend in rand with the shared demo rate", () => {
    const usd = DEMO_DAY.filter((s) => s.atHour <= 10.5)
      .reduce((sum, s) => sum + (s.event.type === 'run_finished' ? s.event.costUsd : 0), 0);
    expect(usd).toBeGreaterThan(0);
    expect(views.spend.value).toBe(formatZar(usd));
    expect(views.spend.tone).toBe('calm');
  });

  it("shows Scout's lead count even after the run has finished (10 by 08:00), from the store's last progress", () => {
    expect(store.progressOf('scout')).toBeUndefined();
    expect(store.lastProgressOf('scout')?.done).toBe(10);
    expect(views.leads.value).toBe('10');
  });

  it('does not read the activity wording: leads follow lastProgressOf alone', () => {
    const fake = storeAt(10.5);
    vi.spyOn(fake, 'lastProgressOf').mockReturnValue({ text: 'x', done: 7 });
    vi.spyOn(fake, 'activity').mockImplementation(() => { throw new Error('activity must not be read'); });
    expect(byId(pillViews(fake, 10.5, ['leads'])).leads.value).toBe('7');
  });

  it('shows the live count while Scout is mid-run, and is busy', () => {
    const s = new DashStore();
    s.accept({ type: 'run_started', runId: 'r', agent: 'scout', task: 'Find leads' }, 7.5);
    s.accept({ type: 'progress', runId: 'r', agent: 'scout', text: 'Grading', done: 4, total: 10 }, 7.6);
    const v = byId(pillViews(s, 7.7, ['leads'])).leads;
    expect(v.value).toBe('4');
    expect(v.tone).toBe('busy');
  });

  it('is zero leads and zero spend on an empty day', () => {
    const v = byId(pillViews(new DashStore(), 6, DEFAULT_PILLS));
    expect(v.leads.value).toBe('0');
    expect(v.waiting).toMatchObject({ value: '0', tone: 'calm' });
    expect(v.spend.value).toBe(formatZar(0));
  });

  it('names the next scheduled run and its time', () => {
    expect(views.next.value).toBe('Courier 11:06');
  });

  it('only counts runs still ahead: an event at this very minute has already happened', () => {
    expect(byId(pillViews(store, 11 + 6 / 60, ['next'])).next.value).toBe('Pulse 13:00');
  });

  it('shows a dash when nothing is left today', () => {
    expect(byId(pillViews(storeAt(19), 19, ['next'])).next.value).toBe('—');
  });

  it('honours the order given and drops unknown or repeated ids', () => {
    const order = ['spend', 'bogus', 'leads', 'spend', 'next'] as unknown as PillId[];
    expect(pillViews(store, 10.5, order).map((v) => v.id)).toEqual(['spend', 'leads', 'next']);
    expect(pillViews(store, 10.5, []).map((v) => v.id)).toEqual([]);
  });

  it('defaults to waiting, next, spend, leads', () => {
    expect(DEFAULT_PILLS).toEqual(['waiting', 'next', 'spend', 'leads']);
  });
});

describe('runAlert', () => {
  it('words a finished run calmly and a failed one as bad', () => {
    expect(runAlert('Scout', false)).toEqual({ text: 'Scout finished', tone: 'calm' });
    expect(runAlert('Echo', true)).toEqual({ text: 'Echo failed', tone: 'bad' });
  });
});

describe('AlertQueue', () => {
  function clock(start = 1000) {
    let t = start;
    return { now: () => t, set: (v: number) => void (t = v), tick: (d: number) => void (t += d) };
  }

  it('shows nothing until something is pushed', () => {
    const c = clock();
    const q = new AlertQueue(c.now);
    expect(q.current()).toBeUndefined();
    expect(q.msLeft()).toBe(0);
  });

  it('shows an alert for two seconds, then it expires', () => {
    const c = clock();
    const q = new AlertQueue(c.now);
    q.push(runAlert('Scout', false));
    expect(ALERT_MS).toBe(2000);
    expect(q.current()?.text).toBe('Scout finished');
    expect(q.msLeft()).toBe(2000);
    c.tick(1999);
    expect(q.current()?.text).toBe('Scout finished');
    expect(q.msLeft()).toBe(1);
    c.tick(1);
    expect(q.current()).toBeUndefined();
    expect(q.msLeft()).toBe(0);
  });

  it('queues several in arrival order, two seconds each', () => {
    const c = clock();
    const q = new AlertQueue(c.now);
    q.push(runAlert('Scout', false));
    c.tick(100);
    q.push(runAlert('Echo', true));
    q.push(runAlert('Atlas', false));
    expect(q.current()?.text).toBe('Scout finished');
    c.set(1000 + 2000);
    expect(q.current()).toMatchObject({ text: 'Echo failed', tone: 'bad' });
    expect(q.msLeft()).toBe(2000);
    c.set(1000 + 4000);
    expect(q.current()?.text).toBe('Atlas finished');
    c.set(1000 + 6000);
    expect(q.current()).toBeUndefined();
  });

  it('keeps its schedule when looked at late: the second alert is not given a fresh two seconds', () => {
    const c = clock();
    const q = new AlertQueue(c.now);
    q.push(runAlert('Scout', false));
    q.push(runAlert('Echo', false));
    c.set(1000 + 3500); // 1.5 s into Echo's turn
    expect(q.current()?.text).toBe('Echo finished');
    expect(q.msLeft()).toBe(500);
    c.set(1000 + 4100);
    expect(q.current()).toBeUndefined();
  });

  it('starts a fresh two seconds when pushed into an empty queue after a gap', () => {
    const c = clock();
    const q = new AlertQueue(c.now);
    q.push(runAlert('Scout', false));
    c.set(60_000);
    q.push(runAlert('Echo', false));
    expect(q.current()?.text).toBe('Echo finished');
    expect(q.msLeft()).toBe(2000);
  });

  it('clear() drops everything', () => {
    const c = clock();
    const q = new AlertQueue(c.now);
    q.push(runAlert('Scout', false));
    q.push(runAlert('Echo', false));
    q.clear();
    expect(q.current()).toBeUndefined();
  });
});
