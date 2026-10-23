import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { HOME_FOV, HOME_VIEW, ORBIT, createCamera, createPicker, personView, zoneView } from '../src/office/camera';
import type { View } from '../src/office/camera';
import { CORE_POSITION, OFFICE, SEATS, STEPS } from '../src/office/layout';
import type { Vec3 } from '../src/office/layout';
import { ROSTER } from '../src/roster';
import type { ZoneId } from '../src/types';

const ZONES: ZoneId[] = ['growth', 'studio', 'ops', 'client'];

const insideRoom = (p: Vec3) =>
  Math.abs(p[0]) < OFFICE.width / 2 && Math.abs(p[2]) < OFFICE.depth / 2 && p[1] > 0 && p[1] < OFFICE.ceiling;
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** A flight that ends outside the orbit limits would snap when the controls take over. */
function expectWithinOrbit(v: View) {
  const d = dist(v.position, v.target);
  expect(d).toBeGreaterThanOrEqual(ORBIT.minDistance);
  expect(d).toBeLessThanOrEqual(ORBIT.maxDistance);
  const polar = Math.acos((v.position[1] - v.target[1]) / d);
  expect(polar).toBeGreaterThanOrEqual(ORBIT.minPolar);
  expect(polar).toBeLessThanOrEqual(ORBIT.maxPolar);
}

function expectGoodView(v: View) {
  expect(insideRoom(v.position)).toBe(true);
  expect(insideRoom(v.target)).toBe(true);
  expect(dist(v.position, v.target)).toBeGreaterThanOrEqual(2);
  expectWithinOrbit(v);
}

describe('HOME_VIEW', () => {
  it('stands inside the room, behind the Core', () => {
    expect(insideRoom(HOME_VIEW.position)).toBe(true);
    expect(HOME_VIEW.position[2]).toBeGreaterThan(CORE_POSITION[2]);
    expect(HOME_VIEW.position[1]).toBeGreaterThan(CORE_POSITION[1] + 1); // above it
  });

  it('looks at the back of the room, between the loft and the windows', () => {
    const [x, y, z] = HOME_VIEW.target;
    expect(x).toBeGreaterThanOrEqual(OFFICE.loft.x1);
    expect(x).toBeLessThanOrEqual(OFFICE.windowsX);
    expect(z).toBeLessThan(0);
    expect(y).toBeGreaterThan(0); // on the floor side: the orbit cannot look level
    expect(y).toBeLessThan(HOME_VIEW.position[1]);
  });

  it('is a view the orbit limits allow', () => {
    expectWithinOrbit(HOME_VIEW);
  });

  it('frames the Core, the loft, the steps and the windows (16:10 window)', () => {
    const cam = new THREE.PerspectiveCamera(HOME_FOV, 1.6, 0.1, 400);
    cam.position.set(...HOME_VIEW.position);
    cam.lookAt(...HOME_VIEW.target);
    cam.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
    );
    const { floorY, height } = OFFICE.loft;
    const loft = OFFICE.loft;
    const top = STEPS.treads[STEPS.treads.length - 1].position;
    const mid = STEPS.treads[2].position;
    const seen: Record<string, Vec3> = {
      core: [CORE_POSITION[0], CORE_POSITION[1] + 1.4, CORE_POSITION[2]],
      'loft centre': [(loft.x0 + loft.x1) / 2, floorY + height / 2, loft.z1],
      'loft right edge': [loft.x1, floorY + height / 2, loft.z1],
      'top step': [top[0], top[1], top[2]],
      'middle step': [mid[0], mid[1], mid[2]],
      'windows': [OFFICE.windowsX, 3, -2],
    };
    for (const [name, p] of Object.entries(seen)) {
      expect(frustum.containsPoint(new THREE.Vector3(...p)), name).toBe(true);
    }
  });
});

describe('zoneView', () => {
  it.each(ZONES)('%s: camera and target inside the room, at least 2 m apart', (zone) => {
    expectGoodView(zoneView(zone));
  });

  it('looks at the zone it is named for', () => {
    for (const zone of ZONES) {
      const seats = Object.values(SEATS).filter((s) => s.zone === zone).map((s) => s.position);
      const t = zoneView(zone).target;
      const nearest = Math.min(...seats.map((p) => Math.hypot(p[0] - t[0], p[2] - t[2])));
      expect(nearest, zone).toBeLessThan(5);
    }
  });

  it('is pure: the same answer every time', () => {
    for (const zone of ZONES) expect(zoneView(zone)).toEqual(zoneView(zone));
  });
});

describe('personView', () => {
  it.each(Object.keys(SEATS))('%s: camera and target inside the room, at least 2 m apart', (id) => {
    expectGoodView(personView(SEATS[id as keyof typeof SEATS].position));
  });

  it.each(Object.keys(SEATS))('%s with facing: sees the face (camera within 80° of where the seat faces), inside the room, ≥ 2 m', (id) => {
    const seat = SEATS[id as keyof typeof SEATS];
    const v = personView(seat.position, seat.facing);
    expectGoodView(v);
    const ex = v.position[0] - v.target[0];
    const ez = v.position[2] - v.target[2];
    const cos = (ex * Math.sin(seat.facing) + ez * Math.cos(seat.facing)) / Math.hypot(ex, ez);
    expect(Math.acos(Math.min(1, cos))).toBeLessThanOrEqual((80 * Math.PI) / 180);
  });

  it('looks at head height above the feet', () => {
    for (const seat of Object.values(SEATS)) {
      const { target } = personView(seat.position);
      expect(target[0]).toBeCloseTo(seat.position[0], 6);
      expect(target[2]).toBeCloseTo(seat.position[2], 6);
      expect(target[1] - seat.position[1]).toBeGreaterThan(1);
      expect(target[1] - seat.position[1]).toBeLessThan(1.8);
    }
  });

  it('works for anyone standing anywhere on the floor, and does not touch its argument', () => {
    for (const p of [[-14.5, 0, 10.5], [14.5, 0, -10.5], [14, 0, 4.5], [0, 0, 0]] as Vec3[]) {
      const copy: Vec3 = [...p];
      expectGoodView(personView(p));
      expect(p).toEqual(copy);
    }
  });

  it('every agent has a seat', () => {
    expect(ROSTER.every((a) => SEATS[a.id])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The rig, on a stub canvas (the unit tests run in node).

function fakeDom() {
  const dom = new EventTarget() as unknown as HTMLElement;
  const el = dom as unknown as Record<string, unknown>;
  el.style = {};
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 500 });
  const doc = new EventTarget();
  el.getRootNode = () => doc;
  el.ownerDocument = doc;
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
  return dom;
}

function rig() {
  const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 400);
  const dom = fakeDom();
  const api = createCamera(camera, dom);
  return { camera, dom, api };
}

const FAR_VIEW: View = personView(SEATS.herald.position);

describe('createCamera', () => {
  it('starts at the home view', () => {
    const { camera } = rig();
    expect(camera.position.distanceTo(new THREE.Vector3(...HOME_VIEW.position))).toBeLessThan(1e-6); // the orbit limits left it alone
  });

  it('flyTo eases: no jump on the first frame, a smooth middle, exact arrival', () => {
    const { camera, api } = rig();
    api.update(10);
    api.flyTo(FAR_VIEW);
    api.update(10); // the clock starts here
    const start = camera.position.clone();
    expect(start.distanceTo(new THREE.Vector3(...HOME_VIEW.position))).toBeLessThan(0.01);

    const samples: number[] = [];
    const end = new THREE.Vector3(...FAR_VIEW.position);
    for (let t = 10; t <= 14; t += 0.05) {
      api.update(t);
      samples.push(camera.position.distanceTo(end));
    }
    // Always getting closer or holding (monotone), with no step bigger than a fifth of the trip.
    const trip = start.distanceTo(end);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThanOrEqual(samples[i - 1] + 0.35);
      expect(Math.abs(samples[i] - samples[i - 1])).toBeLessThan(trip / 5);
    }
    // Somewhere in the middle it is neither at the start nor at the end.
    const midway = samples.some((d) => d > 0.2 * trip && d < 0.8 * trip);
    expect(midway).toBe(true);
    // ...and it settles on the view (the rig lands within a few cm, as damping adds nothing once idle).
    for (let i = 0; i < 120; i++) api.update(15 + i / 60);
    expect(camera.position.distanceTo(end)).toBeLessThan(0.05);
  });

  it('a user press interrupts a flight and the camera stops where it is', () => {
    const { camera, dom, api } = rig();
    api.update(0);
    api.flyTo(FAR_VIEW);
    api.update(0);
    api.update(0.6);
    const at = camera.position.clone();
    expect(at.distanceTo(new THREE.Vector3(...HOME_VIEW.position))).toBeGreaterThan(0.05);
    dom.dispatchEvent(new Event('pointerdown'));
    for (let t = 0.7; t < 4; t += 0.1) api.update(t);
    expect(camera.position.distanceTo(at)).toBeLessThan(0.01);
  });

  it('a wheel turn also takes over', () => {
    const { camera, dom, api } = rig();
    api.update(0);
    api.flyTo(FAR_VIEW);
    api.update(0);
    api.update(0.5);
    const at = camera.position.clone();
    dom.dispatchEvent(new Event('wheel'));
    for (let t = 0.6; t < 3; t += 0.1) api.update(t);
    expect(camera.position.distanceTo(at)).toBeLessThan(0.01);
  });

  it('home() flies back to HOME_VIEW', () => {
    const { camera, api } = rig();
    api.update(0);
    api.flyTo(FAR_VIEW);
    for (let t = 0; t < 4; t += 0.05) api.update(t);
    api.home();
    for (let t = 4; t < 8; t += 0.05) api.update(t);
    expect(camera.position.distanceTo(new THREE.Vector3(...HOME_VIEW.position))).toBeLessThan(0.05);
  });

  it('keeps the orbit target inside the office, even when told to look outside it', () => {
    const { camera, api } = rig();
    api.update(0);
    api.flyTo({ position: [0, 3, 10], target: [40, 20, -40] }); // an impossible target
    for (let t = 0; t < 5; t += 0.05) api.update(t);
    const [x, y, z] = api.target.toArray();
    expect(Math.abs(x)).toBeLessThanOrEqual(OFFICE.width / 2);
    expect(Math.abs(z)).toBeLessThanOrEqual(OFFICE.depth / 2);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(OFFICE.ceiling);
    expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Picking.

function fakePerson(x: number, z: number, visible = true) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.visible = visible;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial());
  tag.position.y = 2;
  group.add(tag);
  group.updateMatrixWorld(true);
  return { agent: { id: 'x' }, group, tag } as unknown as import('../src/staff/person').Person;
}

describe('createPicker', () => {
  // A camera at the front looking straight down -z; people stand on the axis.
  function setup(...people: ReturnType<typeof fakePerson>[]) {
    const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 100);
    camera.position.set(0, 1.2, 10);
    camera.lookAt(0, 1.2, 0);
    camera.updateMatrixWorld();
    const dom = fakeDom();
    const picked: unknown[] = [];
    const picker = createPicker(camera, dom, () => people, (p) => picked.push(p));
    return { dom, picker, picked };
  }

  const click = (dom: HTMLElement, x: number, y: number, to: [number, number] = [x, y]) => {
    const ev = (type: string, cx: number, cy: number) =>
      Object.assign(new Event(type), { clientX: cx, clientY: cy, pointerId: 1, button: 0, buttons: 0 });
    dom.dispatchEvent(ev('pointerdown', x, y));
    dom.dispatchEvent(ev('pointerup', to[0], to[1]));
  };

  it('finds the person under the pointer through their hit capsule', () => {
    const p = fakePerson(0, 0);
    const { picker } = setup(p);
    expect(picker.pick(400, 250)).toBe(p); // screen centre: chest height
  });

  it('misses empty floor and places beside the person', () => {
    const { picker } = setup(fakePerson(0, 0));
    expect(picker.pick(40, 250)).toBeNull();
    expect(picker.pick(760, 250)).toBeNull();
  });

  it('picks the nearer of two people in line', () => {
    const near = fakePerson(0, 3);
    const far = fakePerson(0, -3);
    const { picker } = setup(far, near);
    expect(picker.pick(400, 250)).toBe(near);
  });

  it('ignores people who are away (their group is hidden)', () => {
    const { picker } = setup(fakePerson(0, 0, false));
    expect(picker.pick(400, 250)).toBeNull();
  });

  it('a press and release in place is a click', () => {
    const p = fakePerson(0, 0);
    const { dom, picked } = setup(p);
    click(dom, 400, 250);
    expect(picked).toEqual([p]);
  });

  it('a drag is not a click', () => {
    const { dom, picked } = setup(fakePerson(0, 0));
    click(dom, 400, 250, [440, 250]);
    expect(picked).toEqual([]);
  });

  it('a click on empty floor picks nothing', () => {
    const { dom, picked } = setup(fakePerson(0, 0));
    click(dom, 40, 250);
    expect(picked).toEqual([]);
  });

  it('adds its hit capsule once per person, and removes it on dispose', () => {
    const p = fakePerson(0, 0);
    const { picker } = setup(p);
    picker.pick(400, 250);
    picker.pick(400, 250);
    expect(p.group.children.filter((c) => (c as THREE.Mesh).isMesh)).toHaveLength(1);
    picker.dispose();
    expect(p.group.children.filter((c) => (c as THREE.Mesh).isMesh)).toHaveLength(0);
  });
});
