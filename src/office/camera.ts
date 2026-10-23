// Camera views, the orbit rig with its eased fly-to, and click picking of people.
// Adapted from ~/law-firm-office/src/world/camera.ts: same OrbitControls + eased flight, now inside one room.
// The view functions are pure data (no DOM); the rig and the picker need a canvas.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OFFICE, SEATS } from './layout';
import type { Vec3 } from './layout';
import type { ZoneId } from '../types';
import type { Person } from '../staff/person';

export interface View {
  position: Vec3;
  target: Vec3;
}

/** Vertical field of view the views are composed for, in degrees. `createCamera` applies it. */
export const HOME_FOV = 58;

/**
 * The cinematic default, after the reference photo: from behind and above the Core (which stands at z 9.3, so the
 * lens sits just inside the open front edge) at the left of the room, looking diagonally across it. At HOME_FOV
 * and a 16:10 window the loft fills the upper left, the LED steps climb the middle, the glazed wall with the ocean
 * takes the right, and the Core's "b" stands cropped in the lower right where the photo has the bull.
 * The orbit cannot look level (max polar 1.45), so the target sits 2.4 m below the lens: a 7 degree downward pitch.
 */
export const HOME_VIEW: View = {
  position: [-4.8, 3.3, 10.8],
  target: [5.8, 0.9, -5],
};

/** How far and how steep the orbit may go. Every view below sits inside these, so a flight never ends with a snap. */
export const ORBIT = { minDistance: 3, maxDistance: 28, minPolar: 0.35, maxPolar: 1.45 };

// Where a camera may stand: inside the room, clear of the ceiling slab and the glazing.
const BOX = { x: 14.4, zMin: -10.4, zMax: 10.8, yMin: 0.8, yMax: OFFICE.ceiling - 0.4 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function clampPosition(p: Vec3): Vec3 {
  return [clamp(p[0], -BOX.x, BOX.x), clamp(p[1], BOX.yMin, BOX.yMax), clamp(p[2], BOX.zMin, BOX.zMax)];
}

const POLAR_MARGIN = 0.03;

/** Raises the camera, if need be, until its angle above the target is one the orbit allows (it can't look level). */
function fitPolar(position: Vec3, target: Vec3): Vec3 {
  const dx = position[0] - target[0];
  const dy = position[1] - target[1];
  const dz = position[2] - target[2];
  const r = Math.hypot(dx, dy, dz);
  const lowest = ORBIT.maxPolar - POLAR_MARGIN; // polar angle is measured from straight up
  if (r === 0 || Math.acos(dy / r) <= lowest) return position;
  const h = Math.hypot(dx, dz) || 1;
  return [target[0] + (dx / h) * r * Math.sin(lowest), target[1] + r * Math.cos(lowest), target[2] + (dz / h) * r * Math.sin(lowest)];
}

// Camera offset and look-at offset from the centroid of the zone's seats, in metres.
const ZONE_FRAMING: Record<ZoneId, { eye: Vec3; look: Vec3 }> = {
  growth: { eye: [3, 3.3, 6.5], look: [0, 1.1, 0] }, // from the front, looking across the two long tables
  studio: { eye: [0.5, -0.6, 10], look: [0, -0.6, 1.2] }, // level with the loft, looking into its open side
  ops: { eye: [-6.5, 3.4, 9], look: [0, 1.1, 0] }, // from the middle of the floor toward the windows corner
  client: { eye: [7, 3.4, 6], look: [0, 1.1, 0] }, // along the stone wall from the front
};

/** The view that frames one team's desks: the zone's seats are the centre. */
export function zoneView(zone: ZoneId): View {
  const seats = Object.values(SEATS).filter((s) => s.zone === zone);
  const n = seats.length;
  const c: Vec3 = [
    seats.reduce((a, s) => a + s.position[0], 0) / n,
    seats.reduce((a, s) => a + s.position[1], 0) / n,
    seats.reduce((a, s) => a + s.position[2], 0) / n,
  ];
  const { eye, look } = ZONE_FRAMING[zone];
  const target: Vec3 = [c[0] + look[0], c[1] + look[1], c[2] + look[2]];
  return { position: clampPosition(fitPolar([c[0] + eye[0], c[1] + eye[1], c[2] + eye[2]], target)), target };
}

// A person is seen from the front-ish: the camera stands on the line toward this point in the open front of the room.
const VANTAGE = [0, 14] as const;
const HEAD_HEIGHT = 1.25; // look-at height above the feet, seated or standing
const PERSON_DISTANCE = 3.2; // horizontal metres from the person
const PERSON_RISE = 0.8; // the camera stands above the head height, enough to see over a desk monitor

// With a facing, the camera stands in front of the person: the first of these angles off their facing that fits in the room.
const FACE_OFFSETS = [25, -25, 50, -50, 75, -75].map((d) => (d * Math.PI) / 180);
const FIT_MARGIN = 0.3; // metres the unclamped eye must keep inside the camera box

/**
 * The close view of someone standing or sitting at `p` (their feet on the floor). Pass the seat's `facing`
 * (yaw) to be sure of seeing their face; without it the camera comes from the open front of the room.
 */
export function personView(p: Vec3, facing?: number): View {
  const target: Vec3 = [p[0], p[1] + HEAD_HEIGHT, p[2]];
  let ux = VANTAGE[0] - p[0];
  let uz = VANTAGE[1] - p[2];
  const len = Math.hypot(ux, uz) || 1;
  ux /= len;
  uz /= len;
  if (facing !== undefined) {
    for (const off of FACE_OFFSETS) {
      const sx = Math.sin(facing + off);
      const sz = Math.cos(facing + off);
      const x = target[0] + sx * PERSON_DISTANCE;
      const z = target[2] + sz * PERSON_DISTANCE;
      if (Math.abs(x) <= BOX.x - FIT_MARGIN && z >= BOX.zMin + FIT_MARGIN && z <= BOX.zMax - FIT_MARGIN) {
        ux = sx;
        uz = sz;
        break;
      }
    }
  }
  const eye: Vec3 = [target[0] + ux * PERSON_DISTANCE, target[1] + PERSON_RISE, target[2] + uz * PERSON_DISTANCE];
  return { position: clampPosition(fitPolar(eye, target)), target };
}

// ---------------------------------------------------------------------------
// The orbit rig.

export interface CameraRig {
  /** Glides back to HOME_VIEW. */
  home(): void;
  /** Glides to a view (ease in and out). Any pointer, wheel or touch input takes over at once. */
  flyTo(v: View): void;
  /** Call once per frame with the running time in seconds. */
  update(t: number): void;
  /** What the camera orbits around (read-only use). */
  readonly target: THREE.Vector3;
}

/** The orbit target stays inside this box, so panning cannot drag the view out of the building. */
const TARGET_BOX = { x: 14, zMin: -10, zMax: 10, yMin: 0.5, yMax: 6 };

const FLIGHT_BASE = 1.1; // seconds
const FLIGHT_PER_METRE = 0.035;
const FLIGHT_MAX = 2.2;

const ease = (e: number) => e * e * (3 - 2 * e);

export function createCamera(camera: THREE.PerspectiveCamera, dom: HTMLElement): CameraRig {
  camera.fov = HOME_FOV;
  camera.updateProjectionMatrix();
  camera.position.set(...HOME_VIEW.position);

  const controls = new OrbitControls(camera, dom);
  controls.target.set(...HOME_VIEW.target);
  Object.assign(controls, {
    enableDamping: true,
    dampingFactor: 0.08,
    minDistance: ORBIT.minDistance,
    maxDistance: ORBIT.maxDistance,
    minPolarAngle: ORBIT.minPolar,
    maxPolarAngle: ORBIT.maxPolar,
    screenSpacePanning: false, // panning slides along the floor plane, not up the view
  });
  controls.update();

  // Flight state. Everything is preallocated: update() makes no objects.
  let flying = false;
  let waiting = false; // flyTo called; the clock starts on the next update()
  let t0 = 0;
  let duration = 1;
  const from = { target: new THREE.Vector3(), offset: new THREE.Spherical() };
  const to = { target: new THREE.Vector3(), offset: new THREE.Spherical() };
  const cur = new THREE.Spherical();
  const offset = new THREE.Vector3();
  const shift = new THREE.Vector3();
  const goal = new THREE.Vector3();

  const interrupt = () => {
    flying = false;
    waiting = false;
  };
  // Capture phase: runs before OrbitControls' own handler, so the same press starts an orbit.
  for (const type of ['pointerdown', 'wheel', 'touchstart']) {
    dom.addEventListener(type, interrupt, { capture: true, passive: true });
  }

  function flyTo(v: View): void {
    from.target.copy(controls.target);
    offset.copy(camera.position).sub(controls.target);
    from.offset.setFromVector3(offset);
    to.target.set(...v.target);
    offset.set(...v.position).sub(to.target);
    to.offset.setFromVector3(offset);
    // Take the short way round the target.
    let dTheta = to.offset.theta - from.offset.theta;
    dTheta = ((((dTheta + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    to.offset.theta = from.offset.theta + dTheta;
    duration = clamp(FLIGHT_BASE + FLIGHT_PER_METRE * goal.copy(to.target).distanceTo(from.target), FLIGHT_BASE, FLIGHT_MAX);
    flying = true;
    waiting = true;
  }

  function update(t: number): void {
    if (flying) {
      if (waiting) {
        t0 = t;
        waiting = false;
      }
      const e = ease(clamp((t - t0) / duration, 0, 1));
      controls.target.lerpVectors(from.target, to.target, e);
      cur.radius = from.offset.radius + (to.offset.radius - from.offset.radius) * e;
      cur.phi = from.offset.phi + (to.offset.phi - from.offset.phi) * e;
      cur.theta = from.offset.theta + (to.offset.theta - from.offset.theta) * e;
      offset.setFromSpherical(cur);
      camera.position.copy(controls.target).add(offset);
      if (t - t0 >= duration) flying = false;
    }
    controls.update();

    // Keep the target in the building; carry the camera along by the same amount.
    goal.set(
      clamp(controls.target.x, -TARGET_BOX.x, TARGET_BOX.x),
      clamp(controls.target.y, TARGET_BOX.yMin, TARGET_BOX.yMax),
      clamp(controls.target.z, TARGET_BOX.zMin, TARGET_BOX.zMax),
    );
    shift.subVectors(goal, controls.target);
    if (shift.lengthSq() > 0) {
      controls.target.copy(goal);
      camera.position.add(shift);
    }
  }

  return { home: () => flyTo(HOME_VIEW), flyTo, update, target: controls.target };
}

// ---------------------------------------------------------------------------
// Picking.

/** Capsule hit area per person: wide enough to grab at a distance, tall enough for a seated or standing body. */
const PROXY_RADIUS = 0.35;
const PROXY_LENGTH = 1.1;
const CLICK_SLOP = 5; // px of pointer travel that still counts as a click
const HOVER_EVERY = 50; // ms between hover tests

export interface Picker {
  /** The person under the pointer at client coordinates, or null. */
  pick(clientX: number, clientY: number): Person | null;
  dispose(): void;
}

/**
 * Click a person (their body or their name tag) to get `onPick(person)`. A press that moves more than a few
 * pixels is an orbit drag and picks nothing. Skinned avatars raycast against their bind pose, so each person
 * gets an invisible capsule child of their group instead; `people()` may grow as avatars finish loading.
 */
export function createPicker(
  camera: THREE.Camera,
  dom: HTMLElement,
  people: () => Iterable<Person>,
  onPick: (person: Person) => void,
): Picker {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const geometry = new THREE.CapsuleGeometry(PROXY_RADIUS, PROXY_LENGTH, 4, 8).translate(0, PROXY_RADIUS + PROXY_LENGTH / 2, 0);
  const material = new THREE.MeshBasicMaterial({ visible: false });
  const owners = new Map<THREE.Object3D, Person>(); // proxy or tag sprite -> person

  function targets(): THREE.Object3D[] {
    const list: THREE.Object3D[] = [];
    for (const p of people()) {
      if (!owners.has(p.tag)) {
        const proxy = new THREE.Mesh(geometry, material);
        proxy.name = `hit-${p.agent.id}`;
        proxy.visible = false; // not drawn; Raycaster does not look at visibility
        p.group.add(proxy);
        owners.set(proxy, p);
        owners.set(p.tag, p);
      }
      p.group.updateMatrixWorld(true); // a click can land between a person's move and the next render
    }
    for (const [obj, p] of owners) if (p.group.visible) list.push(obj);
    return list;
  }

  function pick(clientX: number, clientY: number): Person | null {
    const r = dom.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(targets(), false)[0];
    return hit ? owners.get(hit.object) ?? null : null;
  }

  let down: { id: number; x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => {
    down = e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
  };
  const onUp = (e: PointerEvent) => {
    const d = down;
    down = null;
    if (!d || d.id !== e.pointerId || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP) return;
    const person = pick(e.clientX, e.clientY);
    if (person) onPick(person);
  };
  // OrbitControls owns the cursor (grab / grabbing): borrow it while the pointer is over a person, then give it back.
  let lastHover = 0;
  let before: string | null = null;
  const onMove = (e: PointerEvent) => {
    if (e.buttons !== 0 || e.timeStamp - lastHover < HOVER_EVERY) return;
    lastHover = e.timeStamp;
    const over = pick(e.clientX, e.clientY) !== null;
    if (over && before === null) {
      before = dom.style.cursor;
      dom.style.cursor = 'pointer';
    } else if (!over && before !== null) {
      dom.style.cursor = before;
      before = null;
    }
  };

  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('pointerup', onUp);
  dom.addEventListener('pointermove', onMove);

  return {
    pick,
    dispose() {
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointermove', onMove);
      if (before !== null) dom.style.cursor = before;
      for (const [obj] of owners) if ((obj as THREE.Mesh).isMesh) obj.removeFromParent();
      owners.clear();
      geometry.dispose();
      material.dispose();
    },
  };
}
