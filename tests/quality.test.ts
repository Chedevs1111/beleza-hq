import { describe, it, expect } from 'vitest';
import { chooseQuality, FpsGovernor, QualityLadder, pixelRatioFor } from '../src/quality';

describe('chooseQuality', () => {
  it('reduced motion gets the lite profile', () => {
    expect(chooseQuality({ reducedMotion: true, mobile: false, deviceMemoryGb: 16 })).toBe('lite');
  });
  it('phones get the lite profile', () => {
    expect(chooseQuality({ reducedMotion: false, mobile: true, deviceMemoryGb: 8 })).toBe('lite');
  });
  it('a desktop with 8 GB gets the full profile', () => {
    expect(chooseQuality({ reducedMotion: false, mobile: false, deviceMemoryGb: 8 })).toBe('full');
  });
  it('a desktop that does not report its memory gets the full profile', () => {
    expect(chooseQuality({ reducedMotion: false, mobile: false })).toBe('full');
  });
  it('a machine reporting 2 GB or less gets the lite profile', () => {
    expect(chooseQuality({ reducedMotion: false, mobile: false, deviceMemoryGb: 2 })).toBe('lite');
  });
});

function feed(g: FpsGovernor, dt: number, seconds: number): string[] {
  const out: string[] = [];
  for (let t = 0; t < seconds; t += dt) out.push(g.sample(dt));
  return out;
}

describe('FpsGovernor', () => {
  it('holds until a 2 s window has been measured', () => {
    expect(feed(new FpsGovernor(), 0.03, 1.5).every((v) => v === 'hold')).toBe(true);
  });
  it('3 s of 0.030 s frames (33 fps) says lower', () => {
    expect(feed(new FpsGovernor(), 0.03, 3)).toContain('lower');
  });
  it('3 s of 0.015 s frames (66 fps) says raise', () => {
    expect(feed(new FpsGovernor(), 0.015, 3)).toContain('raise');
  });
  it('50 fps is inside the band: hold', () => {
    expect(feed(new FpsGovernor(), 0.02, 6).every((v) => v === 'hold')).toBe(true);
  });
  it('gives one verdict per window, then starts a new window', () => {
    const verdicts = feed(new FpsGovernor(), 0.03, 4.5).filter((v) => v !== 'hold');
    expect(verdicts).toEqual(['lower', 'lower']);
  });
  it('ignores a stalled frame (hidden tab) instead of counting it as a slow second', () => {
    const g = new FpsGovernor();
    feed(g, 0.015, 1);
    expect(g.sample(5)).toBe('hold');
    expect(feed(g, 0.015, 2.2)).toContain('raise');
  });
  it('a different target moves the band', () => {
    expect(feed(new FpsGovernor(30), 0.03, 3)).not.toContain('lower');
  });
});

describe('QualityLadder', () => {
  it('lowers one level per lower verdict, and stops at the bottom', () => {
    const l = new QualityLadder(2);
    expect(l.step('lower')).toBe(1);
    expect(l.step('lower')).toBe(2);
    expect(l.step('lower')).toBeNull();
    expect(l.level).toBe(2);
  });
  it('raises only after two raise verdicts in a row', () => {
    const l = new QualityLadder(3);
    l.step('lower');
    expect(l.step('raise')).toBeNull();
    expect(l.step('raise')).toBe(0);
  });
  it('a hold or lower in between resets the raise streak', () => {
    const l = new QualityLadder(3);
    l.step('lower');
    l.step('raise');
    l.step('hold');
    expect(l.step('raise')).toBeNull();
  });
  it('never raises above a level that just failed (no flapping)', () => {
    const l = new QualityLadder(3);
    l.step('lower'); // 1
    l.step('raise');
    expect(l.step('raise')).toBe(0); // tried 0 ...
    expect(l.step('lower')).toBe(1); // ... and it was too much
    l.step('raise');
    expect(l.step('raise')).toBeNull(); // stays at 1
    expect(l.level).toBe(1);
  });
});

describe('pixelRatioFor', () => {
  it('full starts at the device ratio, capped at 2', () => {
    expect(pixelRatioFor(0, 3, false)).toBe(2);
    expect(pixelRatioFor(0, 1, false)).toBe(1);
  });
  it('lite never goes above 1', () => {
    expect(pixelRatioFor(0, 3, true)).toBe(1);
  });
  it('steps down with the level, to 1 at the lowest', () => {
    expect(pixelRatioFor(2, 2, false)).toBe(1.5);
    expect(pixelRatioFor(3, 2, false)).toBe(1);
  });
});
