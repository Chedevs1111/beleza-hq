// Quality profile and the frame-rate governor. Pure: no three.js, no DOM.
// main.ts reads the environment, calls chooseQuality once, and feeds every frame's dt to the governor.

export type Quality = 'full' | 'lite';

export interface QualityEnv {
  reducedMotion: boolean;
  mobile: boolean;
  /** `navigator.deviceMemory`, when the browser reports it (Chrome only). */
  deviceMemoryGb?: number;
}

/** Machines reporting this much memory or less get the light profile. */
const LOW_MEMORY_GB = 2;

export function chooseQuality(env: QualityEnv): Quality {
  if (env.reducedMotion || env.mobile) return 'lite';
  if (env.deviceMemoryGb !== undefined && env.deviceMemoryGb <= LOW_MEMORY_GB) return 'lite';
  return 'full';
}

export type Verdict = 'hold' | 'lower' | 'raise';

const WINDOW_SECONDS = 2;
/** A frame longer than this is a stall (hidden tab, a debugger, a long GC), not slowness: it is not measured. */
const STALL_SECONDS = 0.25;

/**
 * Judges the frame rate over consecutive 2 s windows. `target` is the rate the page aims for: below
 * `target - 5` the verdict is `lower`, above `target + 8` it is `raise` (45 and 58 at the default of 50).
 */
export class FpsGovernor {
  private frames = 0;
  private elapsed = 0;
  private readonly lowerBelow: number;
  private readonly raiseAbove: number;

  constructor(target = 50) {
    this.lowerBelow = target - 5;
    this.raiseAbove = target + 8;
  }

  /** Feed the real duration of each frame in seconds. Returns `hold` except at the end of a window. */
  sample(dt: number): Verdict {
    if (!(dt > 0)) return 'hold';
    if (dt > STALL_SECONDS) {
      this.frames = 0;
      this.elapsed = 0; // the window spanned a stall: start over
      return 'hold';
    }
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed < WINDOW_SECONDS) return 'hold';
    const fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;
    if (fps < this.lowerBelow) return 'lower';
    if (fps > this.raiseAbove) return 'raise';
    return 'hold';
  }
}

/** The highest level main.ts knows how to apply (see applyQuality there). */
export const MAX_LEVEL = 4;

/**
 * Turns verdicts into a quality level: 0 is the best picture, higher is cheaper. Lowering is immediate;
 * raising needs two `raise` verdicts in a row, and a level that was raised to and failed at once is not tried again.
 */
export class QualityLadder {
  level = 0;
  private streak = 0;
  private best = 0; // lowest level still allowed
  private justRaised = false;

  constructor(private readonly maxLevel = MAX_LEVEL) {}

  /** The new level when it changed, otherwise null. */
  step(v: Verdict): number | null {
    const raised = this.justRaised;
    this.justRaised = false;
    if (v === 'lower') {
      this.streak = 0;
      if (this.level >= this.maxLevel) return null;
      this.level++;
      if (raised) this.best = this.level;
      return this.level;
    }
    if (v === 'hold') {
      this.streak = 0;
      return null;
    }
    this.streak++;
    if (this.streak < 2 || this.level <= this.best) return null;
    this.streak = 0;
    this.level--;
    this.justRaised = true;
    return this.level;
  }
}

/** Renderer pixel ratio for a level: full-size down to 1.5 and then 1; lite never goes above 1. */
export function pixelRatioFor(level: number, devicePixelRatio: number, lite: boolean): number {
  const cap = lite ? 1 : level >= 3 ? 1 : level === 2 ? 1.5 : 2;
  return Math.min(devicePixelRatio, cap);
}
