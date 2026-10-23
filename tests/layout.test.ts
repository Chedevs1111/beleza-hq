import { describe, it, expect } from 'vitest';
import { ROSTER } from '../src/roster';
import {
  OFFICE, SEATS, CORE_POSITION, SENTINEL_DESK, COURIER_WINDOW, IDLE_SPOTS,
  ENTRANCE, TREE_POSITION, DESKS, NAV, STEPS, findPath,
} from '../src/office/layout';
import type { Vec3 } from '../src/office/layout';

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const { loft } = OFFICE;
const studioIds = ROSTER.filter((a) => a.zone === 'studio').map((a) => a.id);

/** Shortest xz distance from point p to segment a-b. */
function segDistXZ(p: Vec3, a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[2] - (a[2] + t * dz));
}

/** Does segment a-b (in xz) touch the rectangle? Sampled finely; edges are short. */
function segHitsRect(a: Vec3, b: Vec3, r: { x0: number; x1: number; z0: number; z1: number }, pad: number): boolean {
  const n = Math.ceil(dist(a, b) / 0.05) + 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[2] + (b[2] - a[2]) * t;
    if (x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad) return true;
  }
  return false;
}

describe('OFFICE', () => {
  it('matches the approved dimensions', () => {
    expect(OFFICE).toEqual({
      width: 30, depth: 22, ceiling: 7.5,
      loft: { x0: -9, x1: 3, z0: -9, z1: -3, floorY: 3.4, height: 2.8 },
      windowsX: 15,
    });
  });
});

describe('SEATS', () => {
  it('gives every agent a seat in its roster zone, inside the footprint', () => {
    expect(Object.keys(SEATS).sort()).toEqual(ROSTER.map((a) => a.id).sort());
    for (const a of ROSTER) {
      const s = SEATS[a.id];
      expect(s.agent).toBe(a.id);
      expect(s.zone).toBe(a.zone);
      expect(Math.abs(s.position[0])).toBeLessThanOrEqual(OFFICE.width / 2);
      expect(Math.abs(s.position[2])).toBeLessThanOrEqual(OFFICE.depth / 2);
      expect(Number.isFinite(s.facing)).toBe(true);
    }
  });

  it('puts studio seats on the loft and every other seat on the floor', () => {
    for (const a of ROSTER) {
      const [x, y, z] = SEATS[a.id].position;
      if (studioIds.includes(a.id)) {
        expect(y).toBe(loft.floorY);
        expect(x).toBeGreaterThan(loft.x0);
        expect(x).toBeLessThan(loft.x1);
        expect(z).toBeGreaterThan(loft.z0);
        expect(z).toBeLessThan(loft.z1);
      } else {
        expect(y).toBe(0);
      }
    }
  });

  it('keeps seats at least 0.9 m apart', () => {
    for (let i = 0; i < ROSTER.length; i++) {
      for (let j = i + 1; j < ROSTER.length; j++) {
        const d = dist(SEATS[ROSTER[i].id].position, SEATS[ROSTER[j].id].position);
        expect(d, `${ROSTER[i].id}/${ROSTER[j].id}`).toBeGreaterThanOrEqual(0.9);
      }
    }
  });

  it('follows the approved floor plan by zone', () => {
    for (const id of ['scout', 'quill', 'linx', 'forge'] as const) {
      const [x, , z] = SEATS[id].position;
      expect(x).toBeGreaterThanOrEqual(-7);
      expect(x).toBeLessThanOrEqual(5);
      expect(z).toBeGreaterThan(2);
      expect(z).toBeLessThan(7);
    }
    for (const id of ['echo', 'tempo', 'sentinel', 'herald'] as const) {
      const [x, , z] = SEATS[id].position;
      expect(x).toBeGreaterThanOrEqual(7);
      expect(x).toBeLessThanOrEqual(14.5);
      expect(z).toBeGreaterThanOrEqual(-10);
      expect(z).toBeLessThanOrEqual(-1);
    }
    for (const id of ['atlas', 'ledger', 'keeper'] as const) {
      const [x, , z] = SEATS[id].position;
      expect(x).toBeGreaterThanOrEqual(-14.5);
      expect(x).toBeLessThanOrEqual(-9.5);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(7);
    }
    const [cx, , cz] = SEATS.courier.position;
    expect(cx).toBeGreaterThanOrEqual(10.5);
    expect(cx).toBeLessThanOrEqual(14.5);
    expect(cz).toBeGreaterThanOrEqual(2.5);
    expect(cz).toBeLessThanOrEqual(6);
  });
});

describe('special points', () => {
  it('places the courier window by the glazing', () => {
    expect(COURIER_WINDOW[0]).toBeGreaterThan(OFFICE.windowsX - 2);
    expect(COURIER_WINDOW[0]).toBeLessThan(OFFICE.windowsX);
  });

  it('keeps the core front-centre, the sentinel desk in the ops corner, idle spots on the window line', () => {
    expect(CORE_POSITION).toEqual([0, 0, 9.3]);
    expect(SENTINEL_DESK[0]).toBeGreaterThanOrEqual(7);
    expect(SENTINEL_DESK[2]).toBeLessThanOrEqual(-1);
    expect(IDLE_SPOTS.length).toBeGreaterThanOrEqual(3);
    expect(IDLE_SPOTS.some((p) => p[0] > 13)).toBe(true);
    expect(IDLE_SPOTS.some((p) => dist(p, TREE_POSITION) < 3)).toBe(true);
    for (const p of IDLE_SPOTS) expect(p[1]).toBe(0);
  });
});

describe('STEPS', () => {
  it('has six treads whose heights strictly increase to the loft floor', () => {
    const ys = STEPS.treads.map((t) => t.position[1]);
    expect(ys).toHaveLength(6);
    expect(ys[0]).toBeCloseTo(0.45, 6);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    expect(ys[ys.length - 1]).toBe(loft.floorY);
  });

  it('sits just right of the loft and rises toward -z, landing near z -6', () => {
    for (const t of STEPS.treads) {
      expect(t.position[0]).toBeGreaterThan(loft.x1);
      expect(t.position[0]).toBeLessThan(6.5);
    }
    const zs = STEPS.treads.map((t) => t.position[2]);
    for (let i = 1; i < zs.length; i++) expect(zs[i]).toBeLessThan(zs[i - 1]);
    expect(zs[zs.length - 1]).toBeLessThan(-5);
    expect(zs[zs.length - 1]).toBeGreaterThan(-7);
  });
});

describe('NAV graph', () => {
  const names = Object.keys(NAV.nodes);

  it('has edges that only reference real nodes, none of them longer than 4 m', () => {
    for (const [a, b] of NAV.edges) {
      expect(NAV.nodes[a], a).toBeDefined();
      expect(NAV.nodes[b], b).toBeDefined();
      expect(dist(NAV.nodes[a], NAV.nodes[b]), `${a}-${b}`).toBeLessThanOrEqual(4);
    }
  });

  it('is one connected component containing every point of interest', () => {
    const adj = new Map<string, string[]>(names.map((n) => [n, []]));
    for (const [a, b] of NAV.edges) {
      adj.get(a)!.push(b);
      adj.get(b)!.push(a);
    }
    const seen = new Set<string>([names[0]]);
    const stack = [names[0]];
    while (stack.length) {
      for (const n of adj.get(stack.pop()!)!) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    expect(seen.size).toBe(names.length);

    const has = (p: Vec3) => Object.values(NAV.nodes).some((n) => dist(n, p) < 1e-9);
    for (const a of ROSTER) expect(has(SEATS[a.id].position), a.id).toBe(true);
    for (const p of [CORE_POSITION, SENTINEL_DESK, COURIER_WINDOW, ENTRANCE, ...IDLE_SPOTS]) {
      expect(has(p), String(p)).toBe(true);
    }
    for (const t of STEPS.treads) expect(has(t.position), String(t.position)).toBe(true);
  });

  it('keeps floor nodes out of desks and clear of the tree', () => {
    for (const [name, p] of Object.entries(NAV.nodes)) {
      if (name.startsWith('tread_')) continue;
      for (const d of DESKS) {
        if (Math.abs(d.y - p[1]) > 0.01) continue;
        expect(
          p[0] > d.x0 - 0.3 && p[0] < d.x1 + 0.3 && p[2] > d.z0 - 0.3 && p[2] < d.z1 + 0.3,
          `${name} inside ${d.id}`,
        ).toBe(false);
      }
    }
  });

  it('routes no edge through a desk or within 1.5 m of the tree', () => {
    for (const [a, b] of NAV.edges) {
      const A = NAV.nodes[a];
      const B = NAV.nodes[b];
      if (a.startsWith('tread_') || b.startsWith('tread_')) continue;
      for (const d of DESKS) {
        if (Math.abs(d.y - A[1]) > 0.01 || Math.abs(d.y - B[1]) > 0.01) continue;
        expect(segHitsRect(A, B, d, 0.3), `${a}-${b} through ${d.id}`).toBe(false);
      }
      expect(segDistXZ(TREE_POSITION, A, B), `${a}-${b} near tree`).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('keeps loft nodes inside the loft and floor nodes out from under the loft edge only where walkable', () => {
    for (const [name, p] of Object.entries(NAV.nodes)) {
      if (p[1] === loft.floorY && !name.startsWith('tread_') && name !== 'loft_edge') {
        expect(p[0], name).toBeGreaterThanOrEqual(loft.x0);
        expect(p[0], name).toBeLessThanOrEqual(loft.x1);
        expect(p[2], name).toBeGreaterThanOrEqual(loft.z0);
        expect(p[2], name).toBeLessThanOrEqual(loft.z1);
      }
    }
  });
});

describe('findPath', () => {
  it('walks from the Core to every seat in short hops', () => {
    for (const a of ROSTER) {
      const to = SEATS[a.id].position;
      const path = findPath(CORE_POSITION, to);
      expect(path.length, a.id).toBeGreaterThanOrEqual(2);
      expect(path[0]).toEqual(CORE_POSITION);
      expect(path[path.length - 1]).toEqual(to);
      for (let i = 1; i < path.length; i++) {
        expect(dist(path[i - 1], path[i]), `${a.id} hop ${i}`).toBeLessThanOrEqual(4);
      }
    }
  });

  it('climbs the treads in increasing height on the way to a studio seat', () => {
    for (const id of studioIds) {
      const path = findPath(CORE_POSITION, SEATS[id].position);
      const ys = path.map((p) => p[1]);
      for (let i = 1; i < ys.length; i++) expect(ys[i], `${id} step ${i}`).toBeGreaterThanOrEqual(ys[i - 1]);
      const treadsHit = STEPS.treads.map((t) => path.findIndex((p) => dist(p, t.position) < 1e-9));
      for (const idx of treadsHit) expect(idx, id).toBeGreaterThan(-1);
      for (let i = 1; i < treadsHit.length; i++) expect(treadsHit[i]).toBeGreaterThan(treadsHit[i - 1]);
    }
  });

  it('walks back down the treads when leaving the loft', () => {
    const path = findPath(SEATS.muse.position, CORE_POSITION);
    const ys = path.map((p) => p[1]);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThanOrEqual(ys[i - 1]);
  });

  it('never climbs for floor-only trips', () => {
    for (const [from, to] of [
      [ENTRANCE, SEATS.scout.position],
      [SEATS.courier.position, COURIER_WINDOW],
      [CORE_POSITION, SENTINEL_DESK],
    ] as [Vec3, Vec3][]) {
      for (const p of findPath(from, to)) expect(p[1]).toBe(0);
    }
  });

  it('snaps arbitrary ends to the nearest node but keeps the exact endpoints', () => {
    const from: Vec3 = [0.3, 0, 9.9];
    const to: Vec3 = [-4.2, 0, 8.0];
    const path = findPath(from, to);
    expect(path[0]).toEqual(from);
    expect(path[path.length - 1]).toEqual(to);
    expect(path.length).toBeGreaterThanOrEqual(2);
  });

  it('returns at least two points even when start and end coincide', () => {
    expect(findPath(CORE_POSITION, CORE_POSITION).length).toBeGreaterThanOrEqual(2);
  });
});
