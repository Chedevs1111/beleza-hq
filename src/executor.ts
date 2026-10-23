// Runs the Action lists that Reactions produces. One queue per agent: an agent's gotos and states run in order and
// a goto is awaited. The scene itself is reached only through ExecutorHost, so the ordering rules are testable alone.
//
//  - Latest goto wins: a batch that moves an agent drops that agent's older queued gotos (the one under way finishes).
//  - States are applied when their turn comes (setState cancels a walk), and a seated pose is never shown away from the seat.
//  - Labels, markers and the step/Core pulses apply at once; the streak leaves when the agent before it in the batch arrives.
//  - Follow-ups the rules do not emit: a draft handed over at Sentinel, Courier back to the desk after a send,
//    the author back to work (or out to idle) after the cheer, Sentinel's "back to X" label fading.
//  - Nothing here throws: a failing host call is logged and the queue carries on.

import type { Action } from './reactions';
import type { AgentId } from './types';
import type { PersonState } from './staff/states';
import { IDLE_SPOTS } from './office/layout';
import type { Vec3 } from './office/layout';
import { ROSTER } from './roster';

export type GotoTarget = 'seat' | 'sentinel' | 'courier_window' | 'idle';

export interface ExecutorHost {
  /** Walks the agent to the target and resolves on arrival (the seat means sitting down). */
  walk(agent: AgentId, target: GotoTarget): Promise<void>;
  setState(agent: AgentId, state: PersonState): void;
  stateOf(agent: AgentId): PersonState | undefined;
  /** An empty text puts the agent's name back on the tag. */
  setLabel(agent: AgentId, text: string): void;
  setMarker(agent: AgentId, on: boolean): void;
  stepsPulse(): void;
  corePulse(): void;
  streak(): void;
  /** Whether the agent has a run in progress. */
  isWorking(agent: AgentId): boolean;
}

export interface ExecutorOptions {
  wait?: (ms: number) => Promise<void>;
  later?: (ms: number, fn: () => void) => void;
  warn?: (...args: unknown[]) => void;
}

/** How long a cheer clip is left to play, ms. */
export const CHEER_MS = 2800;
/** From the streak leaving to Courier heading back to the desk. */
export const STREAK_MS = 2000;
/** How long Sentinel's "back to X" label stays. */
export const LABEL_MS = 20000;
/** An author stands at Sentinel's desk in the carry pose this long before turning back. */
export const HANDOVER_MS = 900;

type Item =
  | { k: 'goto'; target: GotoTarget }
  | { k: 'state'; state: PersonState; after: Promise<void> | null }
  | { k: 'streak'; done: () => void };

interface Queue {
  items: Item[];
  busy: boolean;
}

const SEATED: readonly PersonState[] = ['sitting', 'typing'];

export class ActionExecutor {
  private epoch = 0;
  private queues = new Map<AgentId, Queue>();
  /** Where each agent last arrived (everyone starts at their seat). */
  private at = new Map<AgentId, GotoTarget>();
  /** The last state asked of each agent, before any seat rule changed it. */
  private intent = new Map<AgentId, PersonState>();
  private labelTokens = new Map<AgentId, number>();
  private labelSeq = 0;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly later: (ms: number, fn: () => void) => void;
  private readonly warn: (...args: unknown[]) => void;

  constructor(private readonly host: ExecutorHost, opts: ExecutorOptions = {}) {
    this.wait = opts.wait ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    this.later = opts.later ?? ((ms, fn) => void setTimeout(fn, ms));
    this.warn = opts.warn ?? ((...a) => console.warn('[executor]', ...a));
  }

  /** Queues one event's actions. Never throws. */
  run(actions: readonly Action[]): void {
    try {
      this.enqueueBatch(actions);
    } catch (e) {
      this.warn('could not run actions', e);
    }
  }

  /** Forgets everything in flight: for a new demo day. Call it before putting the people back, so a released walk is ignored. */
  reset(): void {
    this.epoch++;
    this.queues = new Map();
    this.at.clear();
    this.intent.clear();
    this.labelTokens.clear();
  }

  private enqueueBatch(actions: readonly Action[]): void {
    const batch = Array.isArray(actions) ? actions.filter((a) => a && typeof a === 'object') : [];
    // Latest goto wins: a batch that moves an agent retires that agent's older queued gotos.
    for (const a of batch) {
      if (a.kind === 'goto') {
        const q = this.queues.get(a.agent);
        if (q) q.items = q.items.filter((i) => i.k !== 'goto');
      }
    }
    let gate: Promise<void> | null = null; // resolves when the last streak of this batch has left
    let cursor: AgentId | null = null; // whoever the batch last sent walking
    const touched = new Set<AgentId>();
    const push = (agent: AgentId, item: Item) => {
      this.queue(agent).items.push(item);
      touched.add(agent);
    };
    for (const a of batch) {
      switch (a.kind) {
        case 'goto':
          push(a.agent, { k: 'goto', target: a.target });
          cursor = a.agent;
          break;
        case 'state':
          push(a.agent, { k: 'state', state: a.state, after: gate });
          break;
        case 'label':
          this.safe(() => this.applyLabel(a.agent, a.text));
          break;
        case 'marker':
          this.safe(() => this.host.setMarker(a.agent, a.on));
          break;
        case 'steps_pulse':
          this.safe(() => this.host.stepsPulse());
          break;
        case 'core_pulse':
          this.safe(() => this.host.corePulse());
          break;
        case 'streak':
          if (cursor === null) {
            this.safe(() => this.host.streak());
          } else {
            let done!: () => void;
            gate = new Promise<void>((r) => { done = r; });
            push(cursor, { k: 'streak', done });
          }
          break;
      }
    }
    for (const agent of touched) void this.drain(agent);
  }

  private queue(agent: AgentId): Queue {
    let q = this.queues.get(agent);
    if (!q) this.queues.set(agent, (q = { items: [], busy: false }));
    return q;
  }

  private async drain(agent: AgentId): Promise<void> {
    const q = this.queue(agent);
    if (q.busy) return;
    q.busy = true;
    const epoch = this.epoch;
    try {
      while (epoch === this.epoch && q.items.length > 0) {
        const item = q.items.shift()!;
        try {
          await this.exec(agent, item, epoch);
        } catch (e) {
          this.warn(`${agent}: action failed`, e);
        }
      }
    } finally {
      q.busy = false;
    }
  }

  private async exec(agent: AgentId, item: Item, epoch: number): Promise<void> {
    if (item.k === 'goto') {
      const here = this.at.get(agent) ?? 'seat';
      if (here !== item.target) {
        try {
          await this.host.walk(agent, item.target);
        } catch (e) {
          this.at.set(agent, item.target);
          throw e;
        }
        if (epoch !== this.epoch) return;
        this.at.set(agent, item.target);
      }
      if (item.target === 'sentinel' && this.intent.get(agent) === 'carrying') {
        // Hand the draft over: stand there in the carry pose for a moment.
        this.safe(() => this.host.setState(agent, 'carrying'));
        await this.wait(HANDOVER_MS);
      }
      return;
    }

    if (item.k === 'state') {
      if (item.after) await item.after;
      if (epoch !== this.epoch) return;
      const away = (this.at.get(agent) ?? 'seat') !== 'seat';
      const applied = away && SEATED.includes(item.state) ? 'idle' : item.state;
      this.intent.set(agent, item.state);
      this.safe(() => this.host.setState(agent, applied));
      if (applied === 'cheering') this.later(CHEER_MS, () => this.afterCheer(agent, epoch));
      return;
    }

    this.safe(() => this.host.streak());
    item.done();
    this.later(STREAK_MS, () => this.afterStreak(agent, epoch));
  }

  private idle(agent: AgentId): boolean {
    const q = this.queues.get(agent);
    return !q || (!q.busy && q.items.length === 0);
  }

  /** Back to the desk if the agent has a run, otherwise out to the idle spots. */
  private settle(agent: AgentId): void {
    const working = this.safe(() => this.host.isWorking(agent)) ?? false;
    this.run(working
      ? [{ kind: 'goto', agent, target: 'seat' }, { kind: 'state', agent, state: 'typing' }]
      : [{ kind: 'state', agent, state: 'idle' }, { kind: 'goto', agent, target: 'idle' }]);
  }

  private afterCheer(agent: AgentId, epoch: number): void {
    if (epoch !== this.epoch || !this.idle(agent)) return;
    if (this.safe(() => this.host.stateOf(agent)) !== 'cheering') return;
    this.settle(agent);
  }

  private afterStreak(agent: AgentId, epoch: number): void {
    if (epoch !== this.epoch || !this.idle(agent)) return; // more sends are queued: stay at the window
    if (this.at.get(agent) !== 'courier_window') return;
    this.settle(agent);
  }

  private applyLabel(agent: AgentId, text: string): void {
    const token = ++this.labelSeq;
    this.labelTokens.set(agent, token);
    this.host.setLabel(agent, text);
    if (text.startsWith('back to ')) {
      const epoch = this.epoch;
      this.later(LABEL_MS, () => {
        if (epoch === this.epoch && this.labelTokens.get(agent) === token) this.safe(() => this.host.setLabel(agent, ''));
      });
    }
  }

  private safe<T>(fn: () => T): T | undefined {
    try {
      return fn();
    } catch (e) {
      this.warn('host call failed', e);
      return undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Where idle people stand. The parked pair use the first two IDLE_SPOTS exactly (see main); everyone else gets a
// spot of their own along the glazing, or by the tree, so a crowd after the day's runs does not stand inside each other.

const WORKING: readonly AgentId[] = ROSTER.filter((a) => !a.parked).map((a) => a.id);
/** Offsets from each IDLE_SPOT for the first, second, third and fourth person who uses it: along z on the window line, along x by the tree. */
const SLOTS: readonly (readonly [number, number][])[] = [
  [[0, 0.7], [0, -0.7], [0, 1.4], [0, -1.4]],
  [[0, 0.7], [0, -0.7], [0, -1.4], [0, 1.4]],
  [[0, 0], [-0.9, 0], [-1.8, 0], [-2.7, 0]],
  [[0, 0], [-0.9, 0], [-1.8, 0], [-2.7, 0]],
];

export function idleSpotFor(agent: AgentId): Vec3 {
  const w = Math.max(0, WORKING.indexOf(agent));
  const spot = w % IDLE_SPOTS.length;
  const [dx, dz] = SLOTS[spot][Math.floor(w / IDLE_SPOTS.length) % 4];
  const [x, y, z] = IDLE_SPOTS[spot];
  return [x + dx, y, z + dz];
}
