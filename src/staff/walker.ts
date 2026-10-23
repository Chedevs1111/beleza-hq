// Walks a person along a polyline of waypoints at a steady speed. Adapted from the law-firm campus PathWalker:
// plain tuples instead of Vector3, one-shot only, zero-length hops skipped, dt clamped.
// Pure: no three.js. `step()` returns the same object every call, so it allocates nothing per frame.
import { STEPS } from '../office/layout';
import type { Vec3 } from '../office/layout';

/** The longest frame the walker will believe, so a stalled tab doesn't teleport anyone. */
const MAX_DT = 0.1;

export interface WalkStep {
  position: Vec3;
  /** Yaw of the segment being walked: 0 looks toward +z, PI/2 toward +x (three.js rotation.y). */
  heading: number;
  done: boolean;
}

export class Walker {
  private readonly pts: Vec3[];
  /** Length of segment i, from pts[i] to pts[i + 1]; zero-length hops are removed up front. */
  private readonly lens: number[] = [];
  private readonly yaws: number[] = [];
  private readonly total: number;
  private travelled = 0;
  private seg = 0;
  private readonly out: WalkStep = { position: [0, 0, 0], heading: 0, done: false };

  constructor(path: Vec3[], private readonly speed = 1.3) {
    this.pts = [];
    for (const p of path) {
      const last = this.pts[this.pts.length - 1];
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) < 1e-9) continue;
      this.pts.push([p[0], p[1], p[2]]);
    }
    let total = 0;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1];
      const b = this.pts[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      this.lens.push(len);
      // Yaw from the ground-plane direction; a purely vertical hop keeps the previous heading.
      const flat = Math.hypot(b[0] - a[0], b[2] - a[2]);
      this.yaws.push(flat > 1e-9 ? Math.atan2(b[0] - a[0], b[2] - a[2]) : (this.yaws[i - 2] ?? 0));
      total += len;
    }
    this.total = total;
    if (this.pts.length === 0) {
      this.out.done = true;
    } else {
      this.out.position = [...this.pts[0]];
      this.out.heading = this.yaws[0] ?? 0;
      this.out.done = this.pts.length < 2;
    }
  }

  step(dt: number): WalkStep {
    const out = this.out;
    if (out.done) return out;
    this.travelled += this.speed * Math.min(Math.max(dt, 0), MAX_DT);

    if (this.travelled >= this.total - 1e-9) {
      const end = this.pts[this.pts.length - 1];
      out.position[0] = end[0];
      out.position[1] = end[1];
      out.position[2] = end[2];
      out.heading = this.yaws[this.yaws.length - 1];
      out.done = true;
      return out;
    }

    // Advance to the segment holding `travelled`; the walk only ever moves forward.
    let start = 0;
    for (let i = 0; i < this.seg; i++) start += this.lens[i];
    while (this.travelled > start + this.lens[this.seg]) {
      start += this.lens[this.seg];
      this.seg++;
    }
    const a = this.pts[this.seg];
    const b = this.pts[this.seg + 1];
    const f = (this.travelled - start) / this.lens[this.seg];
    out.position[0] = a[0] + (b[0] - a[0]) * f;
    out.position[1] = a[1] + (b[1] - a[1]) * f;
    out.position[2] = a[2] + (b[2] - a[2]) * f;
    out.heading = this.yaws[this.seg];
    return out;
  }
}

// ---------------------------------------------------------------------------
// Stairs. Each tread is a slab on a solid block that runs down to the floor, so a person walking up must not
// slide along the straight line between tread nodes (that cuts into the next block). Instead the height is a
// function of position: the surface of the tread underfoot, with a short rise just before each next tread's
// front edge, which is where a foot lifts onto it.

const TREADS = STEPS.treads;
const TREAD_X = TREADS[0].position[0];
const HALF_WIDTH = TREADS[0].size[0] / 2;
/** How far before a block's front face the rise happens, in metres. */
const RISE_RUN = 0.3;

/** The z of the front face of tread `i` (the face toward +z, the way you come up from). */
const frontFace = (i: number) => TREADS[i].position[2] + TREADS[i].size[2] / 2;

/**
 * Height of the stair surface at (x, z), or `null` when that spot isn't on the stairs and the path's own
 * height applies. Going up means z decreasing; the function is symmetric, so coming down works too.
 */
export function stairsY(x: number, z: number): number | null {
  if (Math.abs(x - TREAD_X) > HALF_WIDTH) return null;
  if (z > frontFace(0) + RISE_RUN) return null; // still on the floor in front of the first block
  // The last tread whose front face we have passed; -1 while still on the floor.
  let i = -1;
  while (i + 1 < TREADS.length && z <= frontFace(i + 1)) i++;
  const here = i < 0 ? 0 : TREADS[i].position[1];
  if (i + 1 >= TREADS.length) return here;
  const toGo = z - frontFace(i + 1); // distance before the next front face
  if (toGo >= RISE_RUN) return here;
  const t = 1 - toGo / RISE_RUN;
  const next = TREADS[i + 1].position[1];
  return here + (next - here) * t * t * (3 - 2 * t); // smoothstep
}
