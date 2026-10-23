import { describe, it, expect } from 'vitest';
import { DemoPlayer } from '../src/demo/player';
import { DEMO_DAY } from '../src/demo/script';
import type { DemoStep } from '../src/demo/script';
import { isAgentEvent } from '../src/events';
import type { AgentEvent } from '../src/events';
import { Reactions } from '../src/reactions';
import { ROSTER } from '../src/roster';
import type { AgentId } from '../src/types';

const events = DEMO_DAY.map((s) => s.event);
const indexed = DEMO_DAY.map((s, i) => ({ ...s, i }));

/** Events of one type, narrowed. */
function ofType<T extends AgentEvent['type']>(type: T) {
  return indexed.filter((s) => s.event.type === type) as { atHour: number; i: number; event: Extract<AgentEvent, { type: T }> }[];
}

/** The agent an event is about; a send is the Courier's work. */
function actorOf(e: AgentEvent): AgentId | undefined {
  if (e.type === 'sent') return 'courier';
  return 'agent' in e ? e.agent : undefined;
}

const hm = (h: number, m = 0) => h + m / 60;

describe('DEMO_DAY: shape', () => {
  it('every event passes isAgentEvent', () => {
    for (const { event } of DEMO_DAY) expect(isAgentEvent(event), JSON.stringify(event)).toBe(true);
  });

  it('atHour never goes backwards, and the whole day sits between 06:00 and midnight', () => {
    DEMO_DAY.forEach((s, i) => {
      expect(s.atHour).toBeGreaterThanOrEqual(6);
      expect(s.atHour).toBeLessThan(24);
      if (i > 0) expect(s.atHour).toBeGreaterThanOrEqual(DEMO_DAY[i - 1].atHour);
    });
  });

  it('has no Ledger or Keeper events (they are parked)', () => {
    for (const { event } of DEMO_DAY) expect(['ledger', 'keeper']).not.toContain(actorOf(event));
  });

  it('uses generic copy only: no emails, links or phone numbers', () => {
    const text = JSON.stringify(events);
    expect(text).not.toMatch(/@|https?:|www\.|\.com|\+\d|\b0\d{9}\b|\d{3}[ -]\d{3}[ -]\d{4}/);
  });
});

describe('DEMO_DAY: drafts and Sentinel', () => {
  it('every draft_submitted has a later sentinel_result for the same draft', () => {
    const results = ofType('sentinel_result');
    for (const d of ofType('draft_submitted')) {
      expect(
        results.some((r) => r.event.draftId === d.event.draftId && r.i > d.i),
        d.event.draftId,
      ).toBe(true);
    }
  });

  it('Sentinel sends exactly one draft back; it is redrafted under the same id and then passes', () => {
    const fails = ofType('sentinel_result').filter((r) => !r.event.pass);
    expect(fails).toHaveLength(1);
    const failed = fails[0];
    expect(failed.event.reasons.length).toBeGreaterThan(0);

    const submissions = ofType('draft_submitted').filter((d) => d.event.draftId === failed.event.draftId);
    expect(submissions).toHaveLength(2);
    expect(submissions[0].i).toBeLessThan(failed.i);
    expect(submissions[1].i).toBeGreaterThan(failed.i);

    const verdicts = ofType('sentinel_result').filter((r) => r.event.draftId === failed.event.draftId);
    expect(verdicts.map((v) => v.event.pass)).toEqual([false, true]);
  });

  it('every draft ends on a passing verdict, and only passing drafts await approval', () => {
    const results = ofType('sentinel_result');
    for (const d of ofType('draft_submitted')) {
      const verdicts = results.filter((r) => r.event.draftId === d.event.draftId);
      expect(verdicts[verdicts.length - 1].event.pass, d.event.draftId).toBe(true);
    }
    for (const a of ofType('awaiting_approval')) {
      const before = results.filter((r) => r.event.draftId === a.event.draftId && r.i < a.i);
      expect(before.length, a.event.draftId).toBeGreaterThan(0);
      expect(before[before.length - 1].event.pass, a.event.draftId).toBe(true);
    }
  });

  it('every draft is shown awaiting approval after it passes, by the agent that wrote it', () => {
    const submitted = new Map(ofType('draft_submitted').map((d) => [d.event.draftId, d.event.agent]));
    const awaiting = ofType('awaiting_approval');
    for (const [draftId, author] of submitted) {
      const mine = awaiting.filter((a) => a.event.draftId === draftId);
      expect(mine.length, draftId).toBeGreaterThan(0);
      for (const a of mine) expect(a.event.agent).toBe(author);
    }
  });
});

describe('DEMO_DAY: approvals and sends', () => {
  // A plan approval approves a batch of posts for their scheduled times next week (spec §3, approval mode 2),
  // so nothing is "sent" today. Single-item approvals (item, whatsapp) each release exactly one send.
  it('every single-item approval (item or whatsapp) has a later sent; plan approvals do not', () => {
    const sent = ofType('sent');
    const approvals = ofType('approved');
    const single = approvals.filter((a) => a.event.mode !== 'plan');
    expect(single.length).toBeGreaterThan(0);
    for (const a of single) {
      expect(
        sent.some((s) => s.event.draftId === a.event.draftId && s.i > a.i),
        `${a.event.draftId} (${a.event.mode})`,
      ).toBe(true);
    }
    for (const a of approvals.filter((x) => x.event.mode === 'plan')) {
      expect(sent.some((s) => s.event.draftId === a.event.draftId)).toBe(false);
    }
  });

  it('nothing is sent without being approved first, and nothing is sent twice', () => {
    const approvals = ofType('approved');
    const sent = ofType('sent');
    for (const s of sent) {
      expect(approvals.some((a) => a.event.draftId === s.event.draftId && a.i < s.i), s.event.draftId).toBe(true);
    }
    expect(new Set(sent.map((s) => s.event.draftId)).size).toBe(sent.length);
  });

  it('Muse submits a plan draft that is approved with mode plan', () => {
    const plan = ofType('draft_submitted').filter((d) => d.event.kind === 'plan');
    expect(plan).toHaveLength(1);
    expect(plan[0].event.agent).toBe('muse');
    const approval = ofType('approved').filter((a) => a.event.draftId === plan[0].event.draftId);
    expect(approval).toHaveLength(1);
    expect(approval[0].event.mode).toBe('plan');
    expect(approval[0].i).toBeGreaterThan(plan[0].i);
    // No other draft is approved as a plan.
    expect(ofType('approved').filter((a) => a.event.mode === 'plan')).toHaveLength(1);
  });

  it('each send goes out on the channel that fits its draft', () => {
    const channelFor: Record<string, string[]> = {
      email: ['email'],
      linkedin: ['linkedin'],
      comment: ['instagram', 'facebook'],
    };
    const kind = new Map(ofType('draft_submitted').map((d) => [d.event.draftId, d.event.kind]));
    for (const s of ofType('sent')) {
      expect(channelFor[kind.get(s.event.draftId)!], s.event.draftId).toContain(s.event.channel);
    }
  });
});

describe('DEMO_DAY: runs', () => {
  it('every run_started has a later run_finished for the same run and agent', () => {
    const finished = ofType('run_finished');
    for (const r of ofType('run_started')) {
      expect(
        finished.some((f) => f.event.runId === r.event.runId && f.event.agent === r.event.agent && f.i > r.i),
        r.event.runId,
      ).toBe(true);
    }
  });

  it('run ids are unique, every run finishes ok once, and no run finishes without starting', () => {
    const started = ofType('run_started').map((r) => r.event.runId);
    const finished = ofType('run_finished');
    expect(new Set(started).size).toBe(started.length);
    expect(finished.map((f) => f.event.runId).sort()).toEqual([...started].sort());
    for (const f of finished) {
      expect(f.event.status).toBe('ok');
      expect(f.event.costUsd).toBeGreaterThanOrEqual(0);
    }
  });

  it('progress, drafts and finishes belong to an open run of the same agent', () => {
    const open = new Map<string, AgentId>();
    for (const { event: e } of DEMO_DAY) {
      if (e.type === 'run_started') open.set(e.runId, e.agent);
      else if (e.type === 'progress' || e.type === 'draft_submitted' || e.type === 'run_finished') {
        expect(open.get(e.runId), `${e.type} ${e.runId}`).toBe(e.agent);
        if (e.type === 'run_finished') open.delete(e.runId);
      }
    }
    expect(open.size).toBe(0);
  });

  it('an agent never has two runs open at once', () => {
    const working = new Set<AgentId>();
    for (const { event: e } of DEMO_DAY) {
      if (e.type === 'run_started') {
        expect(working.has(e.agent), e.runId).toBe(false);
        working.add(e.agent);
      } else if (e.type === 'run_finished') working.delete(e.agent);
    }
  });

  // At 600 s a day one demo hour is 25 s, so 0.05 h is ~1.25 s: the least that keeps a walk from being cut off.
  it('leaves at least 0.05 demo hours after any event that sends an agent walking', () => {
    const walks = new Set<AgentEvent['type']>(['run_started', 'draft_submitted', 'run_finished', 'sent']);
    const lastByActor = new Map<AgentId, { atHour: number; type: AgentEvent['type'] }>();
    for (const { atHour, event } of DEMO_DAY) {
      const actor = actorOf(event);
      if (!actor) continue;
      const prev = lastByActor.get(actor);
      if (prev && walks.has(prev.type)) {
        expect(atHour - prev.atHour, `${actor}: ${prev.type} -> ${event.type} at ${atHour}`).toBeGreaterThanOrEqual(0.05);
      }
      lastByActor.set(actor, { atHour, type: event.type });
    }
  });
});

describe('DEMO_DAY: the day itself (spec §3)', () => {
  const first = (agent: AgentId) => DEMO_DAY.find((s) => s.event.type === 'run_started' && s.event.agent === agent);
  const progressOf = (agent: AgentId) =>
    ofType('progress').filter((p) => p.event.agent === agent);

  it('each agent starts at its scheduled time', () => {
    expect(first('tempo')?.atHour).toBeCloseTo(hm(6, 30));
    expect(first('scout')?.atHour).toBeCloseTo(hm(7, 30));
    expect(first('echo')?.atHour).toBeCloseTo(hm(8));
    expect(first('atlas')?.atHour).toBeCloseTo(hm(8, 30));
    expect(first('quill')?.atHour).toBeCloseTo(hm(9));
    expect(first('linx')?.atHour).toBeCloseTo(hm(9));
    expect(first('pulse')?.atHour).toBeCloseTo(hm(13));
    expect(first('herald')?.atHour).toBeCloseTo(hm(18));
  });

  it('Scout reports 10 leads, 1/10 to 10/10', () => {
    expect(progressOf('scout').map((p) => [p.event.done, p.event.total])).toEqual(
      Array.from({ length: 10 }, (_, i) => [i + 1, 10]),
    );
  });

  it('Echo reads 6 replies and drafts 2 answers', () => {
    expect(progressOf('echo').map((p) => [p.event.done, p.event.total])).toEqual(
      Array.from({ length: 6 }, (_, i) => [i + 1, 6]),
    );
    expect(ofType('draft_submitted').filter((d) => d.event.agent === 'echo')).toHaveLength(2);
  });

  it('Atlas runs 3 audits', () => {
    expect(progressOf('atlas').map((p) => [p.event.done, p.event.total])).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('Quill writes 5 distinct emails and Linx 3 LinkedIn notes', () => {
    const drafts = ofType('draft_submitted');
    const ids = (agent: AgentId, kind: string) =>
      new Set(drafts.filter((d) => d.event.agent === agent && d.event.kind === kind).map((d) => d.event.draftId));
    expect(ids('quill', 'email').size).toBe(5);
    expect(ids('linx', 'linkedin').size).toBe(3);
  });

  it('Che approves Quill\'s 5 emails one by one from 10:15, and Courier sends all 5 by email', () => {
    const quillIds = new Set(
      ofType('draft_submitted').filter((d) => d.event.agent === 'quill').map((d) => d.event.draftId),
    );
    const approvals = ofType('approved').filter((a) => quillIds.has(a.event.draftId));
    expect(approvals).toHaveLength(5);
    expect(approvals[0].atHour).toBeCloseTo(hm(10, 15));
    for (const a of approvals) expect(a.event.mode).toBe('item');
    const sends = ofType('sent').filter((s) => quillIds.has(s.event.draftId));
    expect(sends).toHaveLength(5);
    for (const s of sends) expect(s.event.channel).toBe('email');
  });

  it('Pulse replies to comments from 13:00', () => {
    const replies = ofType('draft_submitted').filter((d) => d.event.agent === 'pulse');
    expect(replies.length).toBeGreaterThanOrEqual(2);
    for (const r of replies) {
      expect(r.event.kind).toBe('comment');
      expect(r.atHour).toBeGreaterThan(13);
    }
  });

  it('Herald\'s 18:00 report is a progress event', () => {
    const report = progressOf('herald');
    expect(report).toHaveLength(1);
    expect(report[0].atHour).toBeGreaterThanOrEqual(18);
  });

  it('Lumen only starts after the plan is approved', () => {
    const approval = ofType('approved').find((a) => a.event.mode === 'plan')!;
    const lumen = first('lumen')!;
    expect(lumen.atHour).toBeGreaterThan(approval.atHour);
  });
});

describe('DEMO_DAY through Reactions', () => {
  it('never throws, and every event except a passing verdict does something visible', () => {
    const r = new Reactions();
    for (const { event } of DEMO_DAY) {
      const actions = r.handle(event);
      const silent = event.type === 'sentinel_result' && event.pass;
      if (!silent) expect(actions.length, JSON.stringify(event)).toBeGreaterThan(0);
    }
  });

  it('leaves nobody mid-run at the end of the day', () => {
    const r = new Reactions();
    for (const { event } of DEMO_DAY) r.handle(event);
    for (const a of ROSTER) expect(r.activeRun(a.id), a.id).toBeUndefined();
  });

  it('a second pass through a fresh Reactions behaves the same (loop restart)', () => {
    const run = () => {
      const r = new Reactions();
      return DEMO_DAY.map((s) => r.handle(s.event));
    };
    expect(run()).toEqual(run());
  });
});

describe('DemoPlayer', () => {
  const ev = (n: number): AgentEvent => ({ type: 'progress', runId: 'r', agent: 'scout', text: `e${n}` });
  const texts = (list: AgentEvent[]) => list.map((e) => (e.type === 'progress' ? e.text : e.type));

  /** Steps ~0.5 s apart in demo time. */
  const feed = (p: DemoPlayer, seconds: number, step = 0.5) => {
    for (let t = 0; t < seconds; t += step) p.update(step);
  };

  it('starts at 06:00', () => {
    expect(new DemoPlayer().hour()).toBe(6);
  });

  it('plays the whole day once, in order, then loops', () => {
    const p = new DemoPlayer();
    const got: AgentEvent[] = [];
    p.on((e) => got.push(e));
    feed(p, 600);
    expect(got).toEqual(events);
    feed(p, 600);
    expect(got).toEqual([...events, ...events]);
  });

  it('hour() follows demoHour and wraps back to 06:00 at the end of the day', () => {
    const p = new DemoPlayer();
    feed(p, 150);
    expect(p.hour()).toBeCloseTo(12);
    feed(p, 150);
    expect(p.hour()).toBeCloseTo(18);
    feed(p, 300);
    expect(p.hour()).toBeCloseTo(6);
    feed(p, 25);
    expect(p.hour()).toBeCloseTo(7);
  });

  it('respects secondsPerDay', () => {
    const p = new DemoPlayer([], 60);
    feed(p, 15);
    expect(p.hour()).toBeCloseTo(12);
  });

  // Review Focus 4: a stalled frame (tab in the background) must not replay a burst of events.
  it('a single huge update only advances 0.5 s, so only events in the next 0.5 s of demo time fire', () => {
    // 600 s/day = 25 s per demo hour, so 0.5 s = 0.02 h after 06:00.
    const script: DemoStep[] = [
      { atHour: 6.005, event: ev(1) },
      { atHour: 6.015, event: ev(2) },
      { atHour: 6.025, event: ev(3) },
      { atHour: 7, event: ev(4) },
    ];
    const p = new DemoPlayer(script);
    const got: AgentEvent[] = [];
    p.on((e) => got.push(e));
    p.update(300);
    expect(texts(got)).toEqual(['e1', 'e2']);
    expect(p.hour()).toBeCloseTo(6.02);
    p.update(300);
    expect(texts(got)).toEqual(['e1', 'e2', 'e3']);
  });

  it('a huge update on the real day emits nothing before the first event', () => {
    const p = new DemoPlayer();
    const got: AgentEvent[] = [];
    p.on((e) => got.push(e));
    p.update(300);
    expect(got).toEqual([]);
    expect(p.hour()).toBeCloseTo(6.02);
  });

  it('after pause(), update emits nothing and the clock stands still; resume() carries on without losing events', () => {
    const script: DemoStep[] = [
      { atHour: 6.005, event: ev(1) },
      { atHour: 6.015, event: ev(2) },
    ];
    const p = new DemoPlayer(script);
    const got: AgentEvent[] = [];
    p.on((e) => got.push(e));
    p.pause();
    p.update(300);
    p.update(0.5);
    expect(got).toEqual([]);
    expect(p.hour()).toBe(6);
    p.resume();
    p.update(0.5);
    expect(texts(got)).toEqual(['e1', 'e2']);
  });

  it('negative, zero and non-finite dt do not move the clock', () => {
    const p = new DemoPlayer([{ atHour: 6.005, event: ev(1) }]);
    const got: AgentEvent[] = [];
    p.on((e) => got.push(e));
    p.update(-5);
    p.update(0);
    p.update(NaN);
    expect(got).toEqual([]);
    expect(p.hour()).toBe(6);
  });

  it('on() returns an unsubscribe function', () => {
    const p = new DemoPlayer([{ atHour: 6.005, event: ev(1) }, { atHour: 6.5, event: ev(2) }]);
    const a: AgentEvent[] = [];
    const b: AgentEvent[] = [];
    const offA = p.on((e) => a.push(e));
    p.on((e) => b.push(e));
    p.update(0.5);
    offA();
    feed(p, 20);
    expect(texts(a)).toEqual(['e1']);
    expect(texts(b)).toEqual(['e1', 'e2']);
  });

  it('script order is by time of day even if the script is given out of order', () => {
    const p = new DemoPlayer([{ atHour: 6.015, event: ev(2) }, { atHour: 6.005, event: ev(1) }]);
    const got: AgentEvent[] = [];
    p.on((e) => got.push(e));
    p.update(0.5);
    expect(texts(got)).toEqual(['e1', 'e2']);
  });

  it('rejects a non-positive or non-finite secondsPerDay', () => {
    expect(() => new DemoPlayer([], 0)).toThrow(RangeError);
    expect(() => new DemoPlayer([], -1)).toThrow(RangeError);
    expect(() => new DemoPlayer([], NaN)).toThrow(RangeError);
  });

  describe('loop restart', () => {
    it('onLoop fires once per day, and before the first event of the new loop', () => {
      // 0.6 s days: an update of 0.5 s straddles the day end, so the wrap and the new loop's first event share an update.
      const p = new DemoPlayer([{ atHour: 6.5, event: ev(1) }], 0.6);
      const order: string[] = [];
      p.on((e) => order.push(texts([e])[0]));
      p.onLoop(() => order.push('loop'));
      p.update(0.5);
      p.update(0.5);
      expect(order).toEqual(['e1', 'loop', 'e1']);
    });

    it('on the real script, onLoop fires exactly at the end of the day and hour() wraps to 06:00', () => {
      const p = new DemoPlayer();
      let loops = 0;
      p.onLoop(() => loops++);
      feed(p, 599.5);
      expect(loops).toBe(0);
      expect(p.hour()).toBeCloseTo(5.98); // not wrapped yet: 0.5 s short of 06:00 next morning
      p.update(0.5);
      expect(loops).toBe(1);
      expect(p.hour()).toBeCloseTo(6);
    });

    it('a caller that builds a fresh Reactions on each loop sees every day play out identically', () => {
      const p = new DemoPlayer();
      let reactions = new Reactions();
      const days: ReturnType<Reactions['handle']>[][] = [[]];
      p.onLoop(() => {
        reactions = new Reactions();
        days.push([]);
      });
      p.on((e) => days[days.length - 1].push(reactions.handle(e)));
      feed(p, 1200);
      expect(days[0].length).toBe(DEMO_DAY.length);
      expect(days[1].length).toBe(DEMO_DAY.length);
      expect(days[0]).toEqual(days[1]);
    });

    it('onLoop returns an unsubscribe function', () => {
      const p = new DemoPlayer([], 1);
      let loops = 0;
      const off = p.onLoop(() => loops++);
      feed(p, 1);
      off();
      feed(p, 3);
      expect(loops).toBe(1);
    });
  });
});
