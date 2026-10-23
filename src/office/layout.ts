// Office layout and walking graph. Pure data + A*, no three.js.
// Units are metres. Floor is y = 0, +x points at the ocean windows, +z at the home camera.
// Office footprint: x in [-15, 15], z in [-11, 11].
// `facing` is a yaw in radians: 0 looks toward +z, PI/2 toward +x (three.js rotation.y).
import type { AgentId, ZoneId } from '../types';
import { agentById } from '../roster';

export type Vec3 = [number, number, number];

export const OFFICE = {
  width: 30,
  depth: 22,
  ceiling: 7.5,
  loft: { x0: -9, x1: 3, z0: -9, z1: -3, floorY: 3.4, height: 2.8 },
  windowsX: 15,
};

const LOFT_Y = OFFICE.loft.floorY;

export interface Seat {
  agent: AgentId;
  position: Vec3;
  facing: number;
  zone: ZoneId;
}

function seat(agent: AgentId, x: number, y: number, z: number, facing: number): Seat {
  return { agent, position: [x, y, z], facing, zone: agentById(agent).zone };
}

const FACE_Z = 0; // toward the home camera
const FACE_NEG_X = -Math.PI / 2; // toward the stone wall

export const SEATS: Record<AgentId, Seat> = {
  // Studio loft: three desks along the back, seats facing the camera.
  muse: seat('muse', -6, LOFT_Y, -7.8, FACE_Z),
  lumen: seat('lumen', -3, LOFT_Y, -7.8, FACE_Z),
  pulse: seat('pulse', 0, LOFT_Y, -7.8, FACE_Z),
  // Growth floor: two long concrete tables, seats on the back side of each.
  scout: seat('scout', -5, 0, 2.4, FACE_Z),
  quill: seat('quill', -1, 0, 2.4, FACE_Z),
  linx: seat('linx', -3, 0, 5.4, FACE_Z),
  forge: seat('forge', 1, 0, 5.4, FACE_Z),
  // Ops corner: two rows of two, back-right by the windows.
  tempo: seat('tempo', 8.5, 0, -8.8, FACE_Z),
  echo: seat('echo', 11.6, 0, -8.8, FACE_Z),
  sentinel: seat('sentinel', 8.5, 0, -4.6, FACE_Z),
  herald: seat('herald', 11.6, 0, -4.6, FACE_Z),
  // Courier outbox desk, by the windows.
  courier: seat('courier', 11.4, 0, 2.7, FACE_Z),
  // Client desks along the stone wall, seats facing it.
  atlas: seat('atlas', -12.8, 0, 1.4, FACE_NEG_X),
  ledger: seat('ledger', -12.8, 0, 3.8, FACE_NEG_X),
  keeper: seat('keeper', -12.8, 0, 6.2, FACE_NEG_X),
};

export const CORE_POSITION: Vec3 = [0, 0, 9.3];
export const ENTRANCE: Vec3 = [-12, 0, 10.5];
export const TREE_POSITION: Vec3 = [11, 0, 8];
/** Standing spot beside Sentinel's desk, in the gap between the two ops desks. */
export const SENTINEL_DESK: Vec3 = [10.05, 0, -4.6];
/** Standing spot at the glazing, just past the courier outbox desk. */
export const COURIER_WINDOW: Vec3 = [14, 0, 4.5];
/** Along the window line, plus one near the tree. */
export const IDLE_SPOTS: Vec3[] = [
  [13.6, 0, -0.5],
  [13.6, 0, 7],
  [13.6, 0, 9.6],
  [9.4, 0, 9.2],
];

/** Desk and table footprints (axis-aligned, `y` = the floor they stand on). Nav never crosses these. */
export interface DeskRect { id: string; x0: number; x1: number; z0: number; z1: number; y: number }

function desk(id: string, cx: number, cz: number, halfW: number, halfD: number, y = 0): DeskRect {
  return { id, x0: cx - halfW, x1: cx + halfW, z0: cz - halfD, z1: cz + halfD, y };
}

export const DESKS: DeskRect[] = [
  // growth: two long concrete tables
  { id: 'growth-table-1', x0: -7, x1: 5, z0: 2.9, z1: 4.1, y: 0 },
  { id: 'growth-table-2', x0: -7, x1: 5, z0: 5.9, z1: 7.1, y: 0 },
  // ops
  desk('ops-tempo', 8.5, -7.9, 0.8, 0.4),
  desk('ops-echo', 11.6, -7.9, 0.8, 0.4),
  desk('ops-sentinel', 8.5, -3.7, 0.8, 0.4),
  desk('ops-herald', 11.6, -3.7, 0.8, 0.4),
  // courier outbox
  desk('courier', 11.4, 3.6, 0.9, 0.4),
  // client, against the stone wall
  desk('client-atlas', -14.15, 1.4, 0.45, 0.8),
  desk('client-ledger', -14.15, 3.8, 0.45, 0.8),
  desk('client-keeper', -14.15, 6.2, 0.45, 0.8),
  // studio, on the loft
  desk('studio-muse', -6, -6.9, 0.8, 0.4, LOFT_Y),
  desk('studio-lumen', -3, -6.9, 0.8, 0.4, LOFT_Y),
  desk('studio-pulse', 0, -6.9, 0.8, 0.4, LOFT_Y),
];

// LED steps: six floating treads right of the loft, rising toward -z.
// `position[1]` is the walking-surface height (top face); a renderer centres its box at y - size[1] / 2.
const TREAD_COUNT = 6;
const TREAD_Y0 = 0.45;
const TREAD_X = 4.6;
const TREAD_Z0 = -1.4;
const TREAD_RUN = 0.85;

export const STEPS: { treads: { position: Vec3; size: Vec3 }[] } = {
  treads: Array.from({ length: TREAD_COUNT }, (_, i) => {
    const y = i === TREAD_COUNT - 1
      ? LOFT_Y
      : TREAD_Y0 + ((LOFT_Y - TREAD_Y0) * i) / (TREAD_COUNT - 1);
    return {
      position: [TREAD_X, Math.round(y * 1000) / 1000, Math.round((TREAD_Z0 - i * TREAD_RUN) * 1000) / 1000] as Vec3,
      size: [1.2, 0.12, 0.8] as Vec3,
    };
  }),
};

// ---------------------------------------------------------------------------
// Walking graph: aisle rows and columns on the floor, spurs to each seat, the
// treads up to the loft, and a loft aisle with spurs to the studio seats.

export const NAV: { nodes: Record<string, Vec3>; edges: [string, string][] } = {
  nodes: {},
  edges: [],
};

function node(id: string, x: number, y: number, z: number): string {
  NAV.nodes[id] = [x, y, z];
  return id;
}
function link(...ids: string[]): void {
  for (let i = 1; i < ids.length; i++) {
    const [a, b] = [ids[i - 1], ids[i]];
    if (!NAV.edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a))) NAV.edges.push([a, b]);
  }
}
/** Floor node at (x, z); aisle rows and columns that cross share the same node. */
function floor(x: number, z: number): string {
  const id = `f_${x}_${z}`;
  if (!NAV.nodes[id]) node(id, x, 0, z);
  return id;
}
/** Chain of floor nodes along constant z. */
function row(z: number, xs: number[]): void {
  link(...xs.map((x) => floor(x, z)));
}
/** Chain of floor nodes along constant x. */
function col(x: number, zs: number[]): void {
  link(...zs.map((z) => floor(x, z)));
}

// Floor aisles. Z1 runs behind growth table 1, Z2 between the tables, ZF in front of table 2.
row(1.4, [-11, -8, -5, -3, -1, 1, 3, 4.6, 6.5, 9, 11.4, 13]);
row(4.6, [-11, -8, -5, -3, -1, 1, 3.5, 6.5]);
row(8.2, [-11, -8, -4, 0, 4, 6.5]);
// North-south aisles: client side (x -11), west of the tables (x -8),
// east of the tables / west edge of ops (x 6.5), and the window line (x 13).
col(-11, [1.4, 3.8, 4.6, 6.2, 8.2]);
col(-8, [1.4, 4.6, 8.2]);
col(6.5, [-10, -8, -5.8, -3.2, -0.7, 1.4, 4.6, 8.2]);
col(13, [-5.8, -3, -0.5, 1.4, 4.5, 7, 9.6]);

// Ops aisles: row B behind sentinel/herald (joins the window line), row A behind tempo/echo.
row(-5.8, [6.5, 8.5, 10.05, 11.6, 13]);
row(-10, [6.5, 8.5, 11.6]);

// Steps up to the loft.
node('steps_base', TREAD_X, 0, -0.7);
link(floor(4.6, 1.4), 'steps_base', floor(6.5, -0.7));
STEPS.treads.forEach((t, i) => node(`tread_${i}`, ...t.position));
link('steps_base', 'tread_0', 'tread_1', 'tread_2', 'tread_3', 'tread_4', 'tread_5');

// Loft: aisle along the landing's z, in front of the desks; studio seats are reached from the side of the desk.
const LOFT_ROW_Z = STEPS.treads[TREAD_COUNT - 1].position[2];
node('loft_edge', OFFICE.loft.x1, LOFT_Y, LOFT_ROW_Z);
link('tread_5', 'loft_edge');
const loftRow = ['loft_edge'];
for (const x of [1, -1.3, -4.3, -7.3]) loftRow.push(node(`loft_${x}`, x, LOFT_Y, LOFT_ROW_Z));
link(...loftRow);

// Seat spurs. Each seat is a node at its exact position.
function seatSpur(agent: AgentId, from: string): void {
  node(`seat_${agent}`, ...SEATS[agent].position);
  link(from, `seat_${agent}`);
}
seatSpur('scout', floor(-5, 1.4));
seatSpur('quill', floor(-1, 1.4));
seatSpur('linx', floor(-3, 4.6));
seatSpur('forge', floor(1, 4.6));
seatSpur('courier', floor(11.4, 1.4));
seatSpur('tempo', floor(8.5, -10));
seatSpur('echo', floor(11.6, -10));
seatSpur('sentinel', floor(8.5, -5.8));
seatSpur('herald', floor(11.6, -5.8));
seatSpur('atlas', floor(-11, 1.4));
seatSpur('ledger', floor(-11, 3.8));
seatSpur('keeper', floor(-11, 6.2));
for (const [agent, loftX] of [['muse', -7.3], ['lumen', -4.3], ['pulse', -1.3]] as const) {
  const side = node(`side_${agent}`, loftX, LOFT_Y, SEATS[agent].position[2]);
  link(`loft_${loftX}`, side);
  seatSpur(agent, side);
}

// Points of interest.
node('core', ...CORE_POSITION);
link(floor(0, 8.2), 'core');
node('entrance', ...ENTRANCE);
link(floor(-11, 8.2), 'entrance');
node('sentinel_desk', ...SENTINEL_DESK);
link(floor(10.05, -5.8), 'sentinel_desk');
node('courier_window', ...COURIER_WINDOW);
link(floor(13, 4.5), 'courier_window');
const IDLE_FROM = [floor(13, -0.5), floor(13, 7), floor(13, 9.6), floor(6.5, 8.2)];
IDLE_SPOTS.forEach((p, i) => {
  node(`idle_${i}`, ...p);
  link(IDLE_FROM[i], `idle_${i}`);
});

// Lounge under the loft stays walkable: a short spur in from the Z1 aisle.
node('lounge_front', -3, 0, -1.2);
node('lounge_mid', -3, 0, -4.2);
node('lounge', -3, 0, -6.5);
link(floor(-3, 1.4), 'lounge_front', 'lounge_mid', 'lounge');

// ---------------------------------------------------------------------------
// A* over the graph.

const ADJ = new Map<string, { to: string; cost: number }[]>();
for (const id of Object.keys(NAV.nodes)) ADJ.set(id, []);
for (const [a, b] of NAV.edges) {
  const cost = dist3(NAV.nodes[a], NAV.nodes[b]);
  ADJ.get(a)!.push({ to: b, cost });
  ADJ.get(b)!.push({ to: a, cost });
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function nearestNode(p: Vec3): string {
  let best = '';
  let bestD = Infinity;
  for (const [id, n] of Object.entries(NAV.nodes)) {
    const d = dist3(n, p);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

const same = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * Waypoints from `from` to `to`: the exact endpoints, with the A* route between their nearest nodes in the middle.
 * Always returns at least two points.
 */
export function findPath(from: Vec3, to: Vec3): Vec3[] {
  const start = nearestNode(from);
  const goal = nearestNode(to);
  const goalPos = NAV.nodes[goal];

  const g = new Map<string, number>([[start, 0]]);
  const came = new Map<string, string>();
  const open = new Map<string, number>([[start, dist3(NAV.nodes[start], goalPos)]]);
  const closed = new Set<string>();

  while (open.size) {
    let cur = '';
    let curF = Infinity;
    for (const [id, f] of open) if (f < curF) { curF = f; cur = id; }
    if (cur === goal) break;
    open.delete(cur);
    closed.add(cur);
    for (const { to: next, cost } of ADJ.get(cur)!) {
      if (closed.has(next)) continue;
      const tentative = g.get(cur)! + cost;
      if (tentative < (g.get(next) ?? Infinity)) {
        g.set(next, tentative);
        came.set(next, cur);
        open.set(next, tentative + dist3(NAV.nodes[next], goalPos));
      }
    }
  }

  const ids: string[] = [goal];
  while (ids[0] !== start) {
    const prev = came.get(ids[0]);
    if (prev === undefined) throw new Error(`No walking route from ${start} to ${goal}`);
    ids.unshift(prev);
  }

  const out: Vec3[] = [[...from]];
  for (const id of ids) {
    const p = NAV.nodes[id];
    if (!same(out[out.length - 1], p)) out.push([...p]);
  }
  if (same(out[out.length - 1], to)) {
    if (out.length < 2) out.push([...to]);
  } else {
    out.push([...to]);
  }
  return out;
}
