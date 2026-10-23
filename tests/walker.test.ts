import { describe, it, expect } from 'vitest';
import { Walker, stairsY } from '../src/staff/walker';
import { STEPS, findPath } from '../src/office/layout';
import type { Vec3 } from '../src/office/layout';

const run = (w: Walker, dt: number, max = 100000) => {
  let t = 0;
  let s = w.step(0);
  for (let i = 0; i < max && !s.done; i++) {
    s = w.step(dt);
    t += dt;
  }
  return { t, s };
};

describe('Walker', () => {
  it('walks a 2.6 m path at 1.3 m/s in about 2 s', () => {
    const { t, s } = run(new Walker([[0, 0, 0], [0, 0, 2.6]]), 0.016);
    expect(s.done).toBe(true);
    expect(Math.abs(t - 2.0)).toBeLessThanOrEqual(0.05);
    expect(s.position[2]).toBeCloseTo(2.6, 6);
  });

  it('takes the speed it is given', () => {
    const { t } = run(new Walker([[0, 0, 0], [3, 0, 0]], 3), 0.016);
    expect(Math.abs(t - 1.0)).toBeLessThanOrEqual(0.05);
  });

  it('heads along the segment it is on (yaw 0 = +z, PI/2 = +x)', () => {
    const w = new Walker([[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2]], 1);
    expect(w.step(0.1).heading).toBeCloseTo(Math.PI / 2, 6);
    let s = w.step(0.1);
    for (let i = 0; i < 100 && s.position[0] < 2 - 1e-9; i++) s = w.step(0.1);
    s = w.step(0.1);
    s = w.step(0.1);
    expect(s.heading).toBeCloseTo(0, 6);
    for (let i = 0; i < 100 && s.position[2] < 2 - 1e-9; i++) s = w.step(0.1);
    s = w.step(0.1);
    s = w.step(0.1);
    expect(s.heading).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('clamps dt, so a long frame moves at most 0.1 s of travel', () => {
    const w = new Walker([[0, 0, 0], [0, 0, 10]]);
    const s = w.step(5);
    expect(s.position[2]).toBeLessThanOrEqual(0.13 + 1e-9);
    expect(s.position[2]).toBeGreaterThan(0.12);
    expect(s.done).toBe(false);
  });

  it('is done at once on an empty path, without NaN', () => {
    const s = new Walker([]).step(0.016);
    expect(s.done).toBe(true);
    expect(s.position.every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(s.heading)).toBe(true);
  });

  it('is done at once on a one-point path and on findPath(p, p)', () => {
    const a = new Walker([[3, 1, 4]]).step(0.016);
    expect(a.done).toBe(true);
    expect(a.position).toEqual([3, 1, 4]);
    const p: Vec3 = [13.6, 0, -0.5];
    const b = new Walker(findPath(p, p)).step(0.016);
    expect(b.done).toBe(true);
    expect(b.position).toEqual(p);
    expect(Number.isFinite(b.heading)).toBe(true);
  });

  it('skips zero-length hops in the middle of a path', () => {
    const w = new Walker([[0, 0, 0], [0, 0, 1], [0, 0, 1], [1, 0, 1]], 1);
    let s = w.step(0.1);
    const seen: number[] = [];
    for (let i = 0; i < 40 && !s.done; i++) {
      s = w.step(0.1);
      seen.push(s.heading);
    }
    expect(seen.every(Number.isFinite)).toBe(true);
    expect(s.done).toBe(true);
    expect(s.position).toEqual([1, 0, 1]);
  });

  it('interpolates height along a segment', () => {
    const w = new Walker([[0, 0, 0], [0, 2, 0.0001 + 1]], 1);
    let s = w.step(0.1);
    s = w.step(0.1);
    s = w.step(0.1);
    s = w.step(0.1);
    s = w.step(0.1);
    expect(s.position[1]).toBeGreaterThan(0);
    expect(s.position[1]).toBeLessThan(2);
  });
});

describe('stairsY', () => {
  const [t0] = STEPS.treads;
  const [tx] = t0.position;
  const { treads } = STEPS;
  const edge = (i: number) => treads[i].position[2] + treads[i].size[2] / 2; // front edge (facing +z)

  it('leaves the floor and everything off the stairs to the path', () => {
    expect(stairsY(tx, edge(0) + 1)).toBeNull();
    expect(stairsY(tx + 5, treads[2].position[2])).toBeNull();
    expect(stairsY(3, treads[5].position[2])).toBeNull(); // the loft side of the bridge
  });

  it('snaps to each tread surface while over it', () => {
    treads.forEach((t, i) => {
      expect(stairsY(tx, t.position[2] + 0.1), `tread ${i}`).toBeCloseTo(t.position[1], 6);
    });
  });

  it('never dips inside the solid block under the tread it is over', () => {
    for (const [i, t] of treads.entries()) {
      for (let z = t.position[2] - t.size[2] / 2; z <= t.position[2] + t.size[2] / 2; z += 0.01) {
        const y = stairsY(tx, z);
        expect(y, `tread ${i} z ${z.toFixed(2)}`).not.toBeNull();
        expect(y!).toBeGreaterThanOrEqual(t.position[1] - 1e-9);
      }
    }
  });

  it('rises in a short ramp before each tread edge, never stepping down on the way up and never jumping', () => {
    let prev = stairsY(tx, edge(0) + 0.3) ?? 0;
    let maxStep = 0;
    for (let z = edge(0) + 0.3; z >= treads[5].position[2]; z -= 0.01) {
      const y = stairsY(tx, z) ?? prev;
      maxStep = Math.max(maxStep, Math.abs(y - prev));
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9); // going up, never down
      prev = y;
    }
    expect(maxStep).toBeLessThan(0.05); // 1 cm of travel
    expect(prev).toBeCloseTo(treads[5].position[1], 6);
  });

  it('starts the first rise on the floor, ending on the first tread at its front edge', () => {
    expect(stairsY(tx, edge(0))).toBeCloseTo(t0.position[1], 6);
    expect(stairsY(tx, edge(0) + 0.24)).toBeCloseTo(0, 1);
  });
});
