import { describe, it, expect } from 'vitest';
import { ActionExecutor, idleSpotFor, CHEER_MS, STREAK_MS, LABEL_MS, HANDOVER_MS } from '../src/executor';
import type { ExecutorHost } from '../src/executor';
import type { Action } from '../src/reactions';
import type { AgentId } from '../src/types';
import type { PersonState } from '../src/staff/states';
import { DESKS, OFFICE, IDLE_SPOTS } from '../src/office/layout';
import { ROSTER } from '../src/roster';

type Call = string;

/** A host that logs every call; walks stay pending until the test resolves them. */
function rig(opts: { working?: Set<AgentId> } = {}) {
  const log: Call[] = [];
  const states = new Map<AgentId, PersonState>();
  const walks: { agent: AgentId; target: string; done: () => void; fail: (e: Error) => void }[] = [];
  const timers: { at: number; fn: () => void }[] = [];
  let now = 0;
  let throwOn: ((c: Call) => boolean) | null = null;
  const note = (c: Call) => {
    log.push(c);
    if (throwOn?.(c)) throw new Error(`boom ${c}`);
  };
  const host: ExecutorHost = {
    walk(agent, target) {
      note(`walk ${agent} ${target}`);
      return new Promise<void>((resolve, reject) => {
        walks.push({ agent, target, done: resolve, fail: reject });
      });
    },
    setState(agent, s) { note(`state ${agent} ${s}`); states.set(agent, s); },
    stateOf: (agent) => states.get(agent),
    setLabel(agent, text) { note(`label ${agent} ${text}`); },
    setMarker(agent, on) { note(`marker ${agent} ${on ? 'on' : 'off'}`); },
    stepsPulse() { note('steps'); },
    corePulse() { note('core'); },
    streak() { note('streak'); },
    isWorking: (a) => opts.working?.has(a) ?? false,
  };
  const ex = new ActionExecutor(host, {
    wait: (ms) => new Promise<void>((r) => timers.push({ at: now + ms, fn: r })),
    later: (ms, fn) => void timers.push({ at: now + ms, fn }),
    warn: () => {},
  });
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return {
    ex, log, states, walks,
    throwWhen(f: (c: Call) => boolean) { throwOn = f; },
    /** Finishes the oldest pending walk of the agent. */
    async arrive(agent: AgentId) {
      const i = walks.findIndex((w) => w.agent === agent);
      if (i < 0) throw new Error(`no pending walk for ${agent}`);
      walks.splice(i, 1)[0].done();
      await flush();
    },
    async advance(ms: number) {
      await flush();
      const end = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        now = due.at;
        due.fn();
        await flush();
      }
      now = end;
      await flush();
    },
    flush,
  };
}

const draft = (agent: AgentId): Action[] => [
  { kind: 'state', agent, state: 'carrying' },
  { kind: 'goto', agent, target: 'sentinel' },
  { kind: 'goto', agent, target: 'seat' },
  { kind: 'state', agent, state: 'typing' },
];

describe('ActionExecutor ordering', () => {
  it('runs one agent\'s actions in order and waits for each goto', async () => {
    const r = rig();
    r.ex.run(draft('quill'));
    await r.flush();
    expect(r.log).toEqual(['state quill carrying', 'walk quill sentinel']);
    await r.arrive('quill');
    await r.advance(HANDOVER_MS);
    expect(r.log.at(-1)).toBe('walk quill seat');
    expect(r.log).not.toContain('state quill typing');
    await r.arrive('quill');
    expect(r.log.at(-1)).toBe('state quill typing');
  });

  it('does not make one agent wait for another', async () => {
    const r = rig();
    r.ex.run(draft('quill'));
    r.ex.run([{ kind: 'goto', agent: 'linx', target: 'idle' }]);
    await r.flush();
    expect(r.log).toContain('walk linx idle');
  });

  it('applies a queued state only when its turn comes (a walk is never cancelled by it)', async () => {
    const r = rig();
    r.ex.run([{ kind: 'goto', agent: 'echo', target: 'sentinel' }]);
    r.ex.run([{ kind: 'state', agent: 'echo', state: 'cheering' }]);
    await r.flush();
    expect(r.log).toEqual(['walk echo sentinel']);
    await r.arrive('echo');
    expect(r.log).toContain('state echo cheering');
  });

  it('labels and markers apply at once, even while the agent walks', async () => {
    const r = rig();
    r.ex.run([{ kind: 'goto', agent: 'echo', target: 'idle' }]);
    r.ex.run([{ kind: 'label', agent: 'echo', text: 'Reading' }, { kind: 'marker', agent: 'echo', on: true }, { kind: 'steps_pulse' }, { kind: 'core_pulse' }]);
    await r.flush();
    expect(r.log).toEqual(['walk echo idle', 'label echo Reading', 'marker echo on', 'steps', 'core']);
  });

  it('skips a goto to where the agent already is', async () => {
    const r = rig();
    r.ex.run([{ kind: 'goto', agent: 'scout', target: 'seat' }, { kind: 'state', agent: 'scout', state: 'typing' }]);
    await r.flush();
    expect(r.log).toEqual(['state scout typing']);
  });
});

describe('ActionExecutor coalescing', () => {
  it('latest goto wins: stale queued gotos are dropped, the one under way finishes', async () => {
    const r = rig();
    r.ex.run(draft('quill')); // 1: walking to Sentinel
    await r.flush();
    r.ex.run(draft('quill')); // 2 and 3 arrive while that walk is still going
    r.ex.run(draft('quill'));
    await r.arrive('quill'); // reaches Sentinel
    await r.advance(HANDOVER_MS * 4);
    await r.arrive('quill'); // the single walk home
    await r.flush();
    const walks = r.log.filter((c) => c.startsWith('walk'));
    expect(walks).toEqual(['walk quill sentinel', 'walk quill seat']);
    expect(r.log.at(-1)).toBe('state quill typing');
    expect(r.walks).toHaveLength(0);
  });

  it('a seated pose is never shown away from the seat: typing at Sentinel stands instead', async () => {
    const r = rig();
    r.ex.run(draft('quill'));
    await r.flush(); // the first walk is under way
    r.ex.run(draft('quill'));
    await r.arrive('quill');
    await r.advance(HANDOVER_MS);
    expect(r.log).not.toContain('state quill typing');
    expect(r.log).toContain('state quill idle');
  });

  it('keeps stale states and effects: only gotos are coalesced', async () => {
    const r = rig();
    r.ex.run([{ kind: 'goto', agent: 'courier', target: 'courier_window' }, { kind: 'streak' }]);
    r.ex.run([{ kind: 'goto', agent: 'courier', target: 'courier_window' }, { kind: 'streak' }]);
    await r.arrive('courier');
    await r.flush();
    expect(r.log.filter((c) => c === 'streak')).toHaveLength(2);
  });
});

describe('ActionExecutor never throws', () => {
  it('survives a host that throws, and keeps going', async () => {
    const r = rig();
    r.throwWhen((c) => c.startsWith('state quill carrying') || c === 'steps');
    expect(() => r.ex.run([...draft('quill'), { kind: 'steps_pulse' }, { kind: 'core_pulse' }])).not.toThrow();
    await r.flush();
    expect(r.log).toContain('walk quill sentinel');
    expect(r.log).toContain('core');
  });

  it('survives a walk that rejects, and continues with the next action', async () => {
    const r = rig();
    r.ex.run(draft('quill'));
    await r.flush();
    r.walks[0].fail(new Error('no route'));
    await r.flush();
    expect(r.log.at(-1)).toBe('walk quill seat');
  });

  it('ignores garbage', () => {
    const r = rig();
    expect(() => r.ex.run([null, undefined, {}, { kind: 'nope' }] as unknown as Action[])).not.toThrow();
  });
});

describe('follow-ups the rules do not emit', () => {
  it('hands a draft over: Quill stands at Sentinel in the carry pose for a moment', async () => {
    const r = rig();
    r.ex.run(draft('quill'));
    await r.flush();
    await r.arrive('quill');
    expect(r.log.at(-1)).toBe('state quill carrying'); // second time: the hand-over at Sentinel's desk
    expect(r.log.filter((c) => c === 'state quill carrying')).toHaveLength(2);
    await r.advance(HANDOVER_MS);
    expect(r.log.at(-1)).toBe('walk quill seat');
  });

  it('a cheer ends: back to typing when the author has a run, otherwise out to idle', async () => {
    const busy = rig({ working: new Set<AgentId>(['quill']) });
    busy.ex.run([{ kind: 'state', agent: 'quill', state: 'cheering' }]);
    await busy.advance(CHEER_MS - 1);
    expect(busy.states.get('quill')).toBe('cheering');
    await busy.advance(2);
    expect(busy.states.get('quill')).toBe('typing');

    const free = rig();
    free.ex.run([{ kind: 'state', agent: 'quill', state: 'cheering' }]);
    await free.advance(CHEER_MS + 1);
    expect(free.log).toContain('state quill idle');
    expect(free.log).toContain('walk quill idle');
  });

  it('a cheer follow-up leaves an agent alone who has moved on', async () => {
    const r = rig();
    r.ex.run([{ kind: 'state', agent: 'quill', state: 'cheering' }]);
    r.ex.run([{ kind: 'state', agent: 'quill', state: 'typing' }]);
    await r.advance(CHEER_MS + 100);
    expect(r.log.filter((c) => c.startsWith('walk'))).toEqual([]);
  });

  it('sent: the streak leaves when Courier reaches the window, the author cheers after it, Courier goes home', async () => {
    const r = rig({ working: new Set<AgentId>(['courier']) });
    r.ex.run([
      { kind: 'goto', agent: 'courier', target: 'courier_window' },
      { kind: 'state', agent: 'courier', state: 'typing' },
      { kind: 'streak' },
      { kind: 'state', agent: 'quill', state: 'cheering' },
    ]);
    await r.flush();
    expect(r.log).toEqual(['walk courier courier_window']);
    await r.arrive('courier');
    expect(r.log.slice(1)).toEqual(['state courier idle', 'streak', 'state quill cheering']);
    await r.advance(STREAK_MS + 1);
    expect(r.log).toContain('walk courier seat');
    await r.arrive('courier');
    expect(r.log.at(-1)).toBe('state courier typing');
  });

  it('two sends back to back make two streaks', async () => {
    const r = rig({ working: new Set<AgentId>(['courier']) });
    const sent: Action[] = [{ kind: 'goto', agent: 'courier', target: 'courier_window' }, { kind: 'streak' }];
    r.ex.run(sent);
    await r.arrive('courier');
    r.ex.run(sent);
    await r.advance(STREAK_MS + 1);
    expect(r.log.filter((c) => c === 'streak')).toHaveLength(2);
  });

  it('Sentinel\'s "back to" label clears by itself; other labels are left alone', async () => {
    const r = rig();
    r.ex.run([{ kind: 'label', agent: 'sentinel', text: 'back to Quill' }, { kind: 'label', agent: 'linx', text: 'Writing' }]);
    await r.advance(LABEL_MS + 1);
    expect(r.log).toContain('label sentinel ');
    expect(r.log).not.toContain('label linx ');
  });

  it('a newer Sentinel label is not wiped by the older one\'s timer', async () => {
    const r = rig();
    r.ex.run([{ kind: 'label', agent: 'sentinel', text: 'back to Quill' }]);
    await r.advance(LABEL_MS - 5000);
    r.ex.run([{ kind: 'label', agent: 'sentinel', text: 'back to Linx' }]);
    await r.advance(6000);
    expect(r.log.filter((c) => c === 'label sentinel ')).toHaveLength(0);
    await r.advance(LABEL_MS);
    expect(r.log.filter((c) => c === 'label sentinel ')).toHaveLength(1);
  });
});

describe('ActionExecutor.reset', () => {
  it('drops queued work and ignores a walk that finishes afterwards', async () => {
    const r = rig();
    r.ex.run(draft('quill'));
    await r.flush();
    r.ex.reset();
    const before = r.log.length;
    r.walks.splice(0).forEach((w) => w.done());
    await r.flush();
    await r.advance(60000);
    expect(r.log.length).toBe(before);
  });

  it('works again after a reset, with agents back at their seats', async () => {
    const r = rig();
    r.ex.run([{ kind: 'goto', agent: 'quill', target: 'idle' }]);
    await r.arrive('quill');
    r.ex.reset();
    r.ex.run([{ kind: 'goto', agent: 'quill', target: 'seat' }, { kind: 'state', agent: 'quill', state: 'typing' }]);
    await r.flush();
    expect(r.log.at(-1)).toBe('state quill typing'); // no walk: reset put Quill back at the seat
  });
});

describe('idleSpotFor', () => {
  const working = ROSTER.filter((a) => !a.parked);
  const spots = working.map((a) => idleSpotFor(a.id));

  it('gives every working agent a spot of their own, 0.5 m or more apart', () => {
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(Math.hypot(spots[i][0] - spots[j][0], spots[i][2] - spots[j][2])).toBeGreaterThanOrEqual(0.5);
      }
    }
  });

  it('leaves the parked agents\' own spots free', () => {
    for (const s of spots) for (const p of [IDLE_SPOTS[0], IDLE_SPOTS[1]]) {
      expect(Math.hypot(s[0] - p[0], s[2] - p[2])).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('stays on the floor, inside the room and clear of every desk', () => {
    for (const s of spots) {
      expect(s[1]).toBe(0);
      expect(Math.abs(s[0])).toBeLessThanOrEqual(OFFICE.width / 2 - 0.5);
      expect(Math.abs(s[2])).toBeLessThanOrEqual(OFFICE.depth / 2 - 0.9);
      for (const d of DESKS.filter((d) => d.y === 0)) {
        const inside = s[0] > d.x0 - 0.4 && s[0] < d.x1 + 0.4 && s[2] > d.z0 - 0.4 && s[2] < d.z1 + 0.4;
        expect(inside, `${s} vs ${d.id}`).toBe(false);
      }
    }
  });
});
