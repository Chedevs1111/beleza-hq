// Plays the scripted demo day on the demo clock. Pure: it owns time and nothing else (no scene, no Reactions).
// The caller feeds events to Reactions and uses onLoop to start a fresh Reactions when the day restarts.

import type { AgentEvent } from '../events';
import { demoHour } from '../office/timeofday';
import { DEMO_DAY } from './script';
import type { DemoStep } from './script';

export { DEMO_DAY } from './script';
export type { DemoStep } from './script';

/** Longest slice of real time one update may advance: a stalled frame must not replay a burst of events. */
const MAX_DT = 0.5;

const START_HOUR = demoHour(0);

/** Hours after the clock's 06:00 start, in 0..24. */
function sinceStart(hour: number): number {
  return (((hour - START_HOUR) % 24) + 24) % 24;
}

export class DemoPlayer {
  /** Script entries with their time in seconds since the day started, in play order. */
  private readonly steps: { at: number; event: AgentEvent }[];
  private readonly listeners = new Set<(e: AgentEvent) => void>();
  private readonly loopListeners = new Set<() => void>();
  private elapsed = 0;
  private next = 0;
  private paused = false;

  constructor(script: readonly DemoStep[] = DEMO_DAY, private readonly secondsPerDay = 600) {
    if (!Number.isFinite(secondsPerDay) || secondsPerDay <= 0) {
      throw new RangeError(`secondsPerDay must be a positive number, got ${secondsPerDay}`);
    }
    this.steps = script
      .map((s) => ({ at: (sinceStart(s.atHour) / 24) * secondsPerDay, event: s.event }))
      .sort((a, b) => a.at - b.at);
  }

  /** Subscribe to events as the demo clock passes them. Returns an unsubscribe function. */
  on(cb: (e: AgentEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * Subscribe to day restarts. The callback runs when the clock wraps, before any event of the new day,
   * so the caller can build a fresh Reactions first. Returns an unsubscribe function.
   */
  onLoop(cb: () => void): () => void {
    this.loopListeners.add(cb);
    return () => this.loopListeners.delete(cb);
  }

  /** Advance by `dt` real seconds (clamped to 0.5) and emit every event the clock has now passed. */
  update(dt: number): void {
    if (this.paused || !(dt > 0)) return;
    this.elapsed += Math.min(dt, MAX_DT);
    for (;;) {
      this.emitDue();
      if (this.elapsed < this.secondsPerDay) return;
      this.elapsed -= this.secondsPerDay;
      this.next = 0;
      for (const cb of [...this.loopListeners]) cb();
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  /** Demo hour of day, 0..24 (06:00 at the start of each loop). */
  hour(): number {
    return demoHour(this.elapsed, this.secondsPerDay);
  }

  private emitDue(): void {
    while (this.next < this.steps.length && this.steps[this.next].at <= this.elapsed) {
      const { event } = this.steps[this.next++];
      for (const cb of [...this.listeners]) cb(event);
    }
  }
}
