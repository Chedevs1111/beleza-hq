import { afterEach, describe, expect, it, vi } from 'vitest';
import { SPRINGS, ease, flip, installSprings, reducedMotion, springAt, springEasing } from '../src/dash/motion';

afterEach(() => vi.unstubAllGlobals());

const stubMotionPref = (reduce: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('prefers-reduced-motion'), media: q }));

describe('spring motion', () => {
  it('a spring starts at rest and settles on its target', () => {
    for (const spring of Object.values(SPRINGS)) {
      expect(springAt(0, spring)).toBeCloseTo(0, 6);
      expect(springAt(3, spring)).toBeCloseTo(1, 3);
    }
  });

  it('the lively spring overshoots a little; the smooth one never does', () => {
    const samples = (s: typeof SPRINGS.bounce) => Array.from({ length: 300 }, (_, i) => springAt(i / 200, s));
    const peak = Math.max(...samples(SPRINGS.bounce));
    expect(peak).toBeGreaterThan(1.02);
    expect(peak).toBeLessThan(1.15);
    expect(Math.max(...samples(SPRINGS.smooth))).toBeLessThanOrEqual(1);
  });

  it('the CSS easing is a valid linear() from 0 to exactly 1 over the time the spring takes to settle', () => {
    const { easing, ms } = springEasing(SPRINGS.bounce);
    expect(easing).toMatch(/^linear\(-?[\d.]+(, -?[\d.]+)+\)$/);
    const points = easing.slice('linear('.length, -1).split(', ').map(Number);
    expect(points.every(Number.isFinite)).toBe(true);
    expect(points[0]).toBe(0);
    expect(points.at(-1)).toBe(1);
    expect(points).toHaveLength(41);
    expect(ms).toBeGreaterThan(300);
    expect(ms).toBeLessThan(1200);
    expect(springEasing(SPRINGS.snappy).ms).toBeLessThan(ms);
  });
});

describe('ease and installSprings', () => {
  it('ease gives an easing and a duration for each spring', () => {
    for (const name of Object.keys(SPRINGS) as (keyof typeof SPRINGS)[]) {
      const { easing, ms } = ease(name);
      expect(easing).toMatch(/^(linear|cubic-bezier)\(/);
      expect(ms).toBeGreaterThan(0);
    }
  });

  it('installSprings puts --spring-* and --spring-*-ms on the element', () => {
    const set: Record<string, string> = {};
    installSprings({ style: { setProperty: (k: string, v: string) => (set[k] = v) } } as unknown as HTMLElement);
    for (const name of Object.keys(SPRINGS)) {
      expect(set[`--spring-${name}`]).toBe(ease(name as keyof typeof SPRINGS).easing);
      expect(set[`--spring-${name}-ms`]).toMatch(/^\d+ms$/);
    }
  });
});

describe('reduced motion', () => {
  const box = (left: number) => ({ getBoundingClientRect: () => ({ left, top: 0 }), animate: vi.fn() });

  it('reducedMotion follows the media query', () => {
    stubMotionPref(true);
    expect(reducedMotion()).toBe(true);
    stubMotionPref(false);
    expect(reducedMotion()).toBe(false);
  });

  it('flip still applies the change but starts no animation (duration 0)', () => {
    stubMotionPref(true);
    const child = box(0);
    const container = { children: [child] } as unknown as HTMLElement;
    const mutate = vi.fn(() => { child.getBoundingClientRect = () => ({ left: 120, top: 0 }) as DOMRect; });
    flip(container, mutate);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(child.animate).not.toHaveBeenCalled();
  });

  it('flip glides a moved child from where it was when motion is allowed', () => {
    stubMotionPref(false);
    const child = box(0);
    const container = { children: [child] } as unknown as HTMLElement;
    flip(container, () => { child.getBoundingClientRect = () => ({ left: 120, top: 0 }) as DOMRect; });
    expect(child.animate).toHaveBeenCalledTimes(1);
    const [frames, opts] = child.animate.mock.calls[0];
    expect(frames[0].transform).toBe('translate(-120px, 0px)');
    expect(opts.duration).toBe(ease('smooth').ms);
  });
});
