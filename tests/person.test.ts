import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import type { Manifest } from '../src/office/assets';

const loader = vi.hoisted(() => ({ loadAsync: vi.fn() }));
vi.mock('../src/office/assets', () => ({
  assetUrl: (path: string) => `/${path}`,
  createGltfLoader: () => ({ loadAsync: loader.loadAsync }),
}));

import { Person } from '../src/staff/person';
import { ROSTER, agentById } from '../src/roster';
import { IDLE_SPOTS, SEATS, STEPS } from '../src/office/layout';
import { createMaterials } from '../src/office/materials';
import { buildFurniture } from '../src/office/furniture';

const CLIPS = ['walk', 'sit_idle', 'sit_type', 'idle', 'talk', 'carry', 'wave', 'cheer'];

function manifestFor(...keys: string[]): Manifest {
  return {
    people: Object.fromEntries(keys.map((k) => [k, { file: `assets/people/${k}.glb`, clips: CLIPS, triangles: 1 }])),
    textures: {} as Manifest['textures'],
    hdri: '',
    sources: [],
  };
}
const manifest = manifestFor(...ROSTER.map((a) => a.look.model));

/** A stand-in avatar: a Bip01 root with a mesh, and one two-key clip per name. */
function fakeGltf() {
  const scene = new THREE.Group();
  const bip = new THREE.Object3D();
  bip.name = 'Bip01';
  bip.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.7, 0.2), new THREE.MeshBasicMaterial()));
  scene.add(bip);
  const animations = CLIPS.map((n) => new THREE.AnimationClip(n, 1, [new THREE.VectorKeyframeTrack('Bip01.position', [0, 1], [0, 0.9, 0, 0, 0.9, 0])]));
  return { scene, animations };
}

/** Run frames until `done` is true; flush promise callbacks between frames. */
async function runUntil(p: Person, done: () => boolean, dt = 0.05, max = 3000): Promise<void> {
  for (let i = 0; i < max && !done(); i++) {
    p.update(dt);
    await Promise.resolve();
    await Promise.resolve();
  }
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  loader.loadAsync.mockReset();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('Person.create: the avatar fails to load', () => {
  it('resolves with a capsule fallback and warns exactly once', async () => {
    loader.loadAsync.mockRejectedValue(new Error('404'));
    const agent = agentById('scout');
    const person = await Person.create(agent, manifest);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[staff] failed to load', manifest.people[agent.look.model].file);
    expect(person.agent).toBe(agent);
    const capsules = person.group.children.flatMap((c) => c.children).filter((c) => (c as THREE.Mesh).geometry instanceof THREE.CapsuleGeometry);
    expect(capsules).toHaveLength(1);
  });

  it('tints the capsule by zone', async () => {
    loader.loadAsync.mockRejectedValue(new Error('404'));
    const colours = new Set<number>();
    for (const id of ['scout', 'muse', 'tempo', 'atlas'] as const) {
      const p = await Person.create(agentById(id), manifest);
      const capsule = p.body.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh;
      colours.add((capsule.material as THREE.MeshStandardMaterial).color.getHex());
    }
    expect(colours.size).toBe(4);
  });

  it('falls back (and warns once) when the manifest has no entry for the model', async () => {
    const person = await Person.create(agentById('scout'), manifestFor());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(loader.loadAsync).not.toHaveBeenCalled();
    expect(person.group.children.length).toBeGreaterThan(0);
  });

  it('still runs states, labels and walks on the fallback', async () => {
    loader.loadAsync.mockRejectedValue(new Error('404'));
    const person = await Person.create(agentById('scout'), manifest);
    for (const s of ['idle', 'walking', 'sitting', 'typing', 'carrying', 'talking', 'cheering', 'away'] as const) {
      person.setState(s);
      person.update(0.016);
      expect(person.state).toBe(s);
    }
    person.setLabel('Scout: finding leads');
    expect(person.label).toBe('Scout: finding leads');
  });
});

describe('Person with a loaded avatar', () => {
  async function make(id: Parameters<typeof agentById>[0] = 'scout') {
    loader.loadAsync.mockResolvedValue(fakeGltf());
    const person = await Person.create(agentById(id), manifest);
    expect(warn).not.toHaveBeenCalled();
    return person;
  }

  it('loads the file the manifest names for the agent\'s look', async () => {
    await make('tempo');
    expect(loader.loadAsync).toHaveBeenCalledWith(`/${manifest.people[agentById('tempo').look.model].file}`);
  });

  it('plays the clip for each state', async () => {
    const person = await make();
    const expected = { idle: 'idle', walking: 'walk', sitting: 'sit_idle', typing: 'sit_type', carrying: 'carry', talking: 'talk', cheering: 'cheer' } as const;
    for (const [state, clip] of Object.entries(expected)) {
      person.setState(state as keyof typeof expected);
      expect(person.clip).toBe(clip);
    }
  });

  it('crossfades over 0.25 s: the old clip is still partly there at 0.1 s and gone by 0.3 s', async () => {
    const person = await make();
    person.setState('idle');
    person.update(0.1);
    person.setState('talking');
    person.update(0.1);
    expect(person.weight('talk')).toBeGreaterThan(0.2);
    expect(person.weight('talk')).toBeLessThan(0.8);
    expect(person.weight('idle')).toBeGreaterThan(0);
    person.update(0.1);
    person.update(0.1);
    expect(person.weight('talk')).toBeCloseTo(1, 5);
    expect(person.weight('idle')).toBeCloseTo(0, 5);
  });

  it('scales the walk clip so the feet keep pace with the walker', async () => {
    const female = await make('tempo');
    female.setState('walking');
    const male = await make('scout');
    male.setState('walking');
    expect(female.walkTimeScale).toBeCloseTo(1.3 / 1.2, 3);
    expect(male.walkTimeScale).toBeCloseTo(1.3 / 1.0, 3);
  });

  it('cheers once and holds the last frame', async () => {
    const person = await make();
    person.setState('cheering');
    for (let i = 0; i < 30; i++) person.update(0.1);
    expect(person.clip).toBe('cheer');
    expect(person.weight('cheer')).toBeCloseTo(1, 5);
  });

  it('cheering again replays the one-shot from the start', async () => {
    const person = await make();
    person.setState('cheering');
    for (let i = 0; i < 30; i++) person.update(0.1);
    const cheer = (person as unknown as { actions: Map<string, THREE.AnimationAction> }).actions.get('cheer')!;
    expect(cheer.time).toBeGreaterThan(0);
    person.setState('cheering');
    expect(cheer.time).toBe(0);
  });
});

describe('walking', () => {
  async function make(id: Parameters<typeof agentById>[0] = 'scout') {
    loader.loadAsync.mockResolvedValue(fakeGltf());
    return Person.create(agentById(id), manifest);
  }

  it('walkTo follows the aisles, resolves on arrival, and leaves the person idle', async () => {
    const person = await make();
    person.placeAt(SEATS.scout.position, SEATS.scout.facing);
    let arrived = false;
    const target = IDLE_SPOTS[0];
    const p = person.walkTo(target).then(() => { arrived = true; });
    expect(person.state).toBe('walking');
    await runUntil(person, () => arrived);
    await p;
    expect(arrived).toBe(true);
    expect(person.group.position.toArray()).toEqual(target.map((v) => expect.closeTo(v, 5)));
    expect(person.state).toBe('idle');
  });

  it('turns to face the way it is going', async () => {
    const person = await make();
    person.placeAt([13, 0, -0.5], 0);
    const p = person.walkTo([13, 0, 4.5]);
    for (let i = 0; i < 5; i++) person.update(0.05);
    expect(person.group.rotation.y).toBeCloseTo(0, 1); // +z
    await runUntil(person, () => person.state !== 'walking');
    await p;
    const q = person.walkTo([13, 0, -0.5]);
    for (let i = 0; i < 20; i++) person.update(0.05);
    expect(Math.abs(Math.abs(person.group.rotation.y) - Math.PI)).toBeLessThan(0.3); // -z
    await runUntil(person, () => person.state !== 'walking');
    await q;
  });

  it('walkTo where it already stands resolves without NaN', async () => {
    const person = await make();
    person.placeAt(IDLE_SPOTS[1], 1);
    let done = false;
    const p = person.walkTo(IDLE_SPOTS[1]).then(() => { done = true; });
    await runUntil(person, () => done, 0.05, 50);
    await p;
    expect(done).toBe(true);
    expect(person.group.position.toArray().every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(person.group.rotation.y)).toBe(true);
  });

  it('a new walkTo releases the one before it', async () => {
    const person = await make();
    person.placeAt(IDLE_SPOTS[0], 0);
    let first = false;
    const a = person.walkTo(IDLE_SPOTS[2]).then(() => { first = true; });
    person.update(0.05);
    const b = person.walkTo(IDLE_SPOTS[1]);
    await a;
    expect(first).toBe(true);
    await runUntil(person, () => person.state !== 'walking');
    await b;
  });

  it('setState mid-walk drops the walk: the walk resolves and the person stays put', async () => {
    const person = await make();
    person.placeAt(IDLE_SPOTS[0], 0);
    let released = false;
    const a = person.walkTo(IDLE_SPOTS[2]).then(() => { released = true; });
    for (let i = 0; i < 4; i++) person.update(0.05);
    person.setState('away');
    await a;
    expect(released).toBe(true);
    person.setState('idle');
    const here = person.group.position.toArray();
    for (let i = 0; i < 40; i++) person.update(0.05);
    expect(person.group.position.toArray()).toEqual(here);
    expect(person.state).toBe('idle');
  });

  it('climbs the stairs one tread surface at a time, never below the block under the foot', async () => {
    const person = await make();
    person.placeAt([6.5, 0, -0.7], 0);
    const top = STEPS.treads[5].position;
    let done = false;
    const p = person.walkTo(top).then(() => { done = true; });
    let lastY = 0;
    for (let i = 0; i < 400 && !done; i++) {
      person.update(0.02);
      await Promise.resolve();
      await Promise.resolve();
      const { x, y, z } = person.group.position;
      expect(y).toBeGreaterThanOrEqual(lastY - 0.02); // up, not bobbing down
      lastY = y;
      if (Math.abs(x - STEPS.treads[0].position[0]) < 0.5) {
        const under = STEPS.treads.filter((t) => Math.abs(z - t.position[2]) <= t.size[2] / 2);
        for (const t of under) expect(y).toBeGreaterThanOrEqual(t.position[1] - 1e-6);
      }
    }
    await p;
    expect(person.group.position.y).toBeCloseTo(top[1], 3);
  });
});

describe('sitting', () => {
  async function make(id: Parameters<typeof agentById>[0]) {
    loader.loadAsync.mockResolvedValue(fakeGltf());
    return Person.create(agentById(id), manifest);
  }

  it('sitAt walks to the seat, turns to its facing and sits', async () => {
    const person = await make('atlas');
    person.placeAt([-11, 0, 4.6], 0);
    const seat = SEATS.atlas;
    let done = false;
    const p = person.sitAt(seat).then(() => { done = true; });
    await runUntil(person, () => done);
    await p;
    for (let i = 0; i < 20; i++) person.update(0.05);
    expect(person.state).toBe('sitting');
    expect(person.clip).toBe('sit_idle');
    expect(person.group.position.toArray()).toEqual(seat.position.map((v) => expect.closeTo(v, 5)));
    expect(person.group.rotation.y).toBeCloseTo(seat.facing, 2);
  });

  it('lowers the body onto the chair when seated and lifts it again on standing', async () => {
    const person = await make('scout');
    person.placeAt(SEATS.scout.position, SEATS.scout.facing);
    person.setState('idle');
    for (let i = 0; i < 20; i++) person.update(0.05);
    expect(person.body.position.y).toBeCloseTo(0, 5);
    person.setState('typing');
    for (let i = 0; i < 20; i++) person.update(0.05);
    expect(person.body.position.y).toBeLessThan(-0.01);
    expect(person.body.position.y).toBeGreaterThan(-0.15);
    person.setState('walking');
    for (let i = 0; i < 20; i++) person.update(0.05);
    expect(person.body.position.y).toBeCloseTo(0, 5);
  });

  it('placeAt in a seated state snaps straight to the pose', async () => {
    const person = await make('scout');
    person.placeAt(SEATS.scout.position, SEATS.scout.facing);
    person.setState('typing');
    person.snap();
    expect(person.body.position.y).toBeLessThan(-0.01);
    expect(person.group.rotation.y).toBeCloseTo(SEATS.scout.facing, 5);
  });
});

describe('chairs line up with SEATS', () => {
  it('every seat has a chair on its position, facing the way the person does', () => {
    const group = buildFurniture(createMaterials({}, { lite: true }));
    const chairs = group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh && c.count === Object.keys(SEATS).length);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    for (const seat of Object.values(SEATS)) {
      const hit = chairs.some((mesh) => {
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, m);
          m.decompose(p, q, s);
          fwd.set(0, 0, 1).applyQuaternion(q);
          if (
            Math.hypot(p.x - seat.position[0], p.z - seat.position[2]) < 1e-6 &&
            Math.abs(p.y - seat.position[1]) < 1e-6 &&
            Math.abs(fwd.x - Math.sin(seat.facing)) < 1e-6 &&
            Math.abs(fwd.z - Math.cos(seat.facing)) < 1e-6
          ) return true;
        }
        return false;
      });
      expect(hit, seat.agent).toBe(true);
    }
  });
});

describe('labels, marker and the waiting card', () => {
  async function make(id: Parameters<typeof agentById>[0]) {
    loader.loadAsync.mockResolvedValue(fakeGltf());
    return Person.create(agentById(id), manifest);
  }

  it('shows the agent\'s name as the name tag, and setLabel changes it', async () => {
    const person = await make('quill');
    expect(person.label).toBe('Quill');
    expect(person.tag.visible).toBe(true);
    person.setLabel('Quill: writing 3 emails');
    expect(person.label).toBe('Quill: writing 3 emails');
  });

  it('setMarker shows and hides the gold diamond', async () => {
    const person = await make('quill');
    expect(person.marker.visible).toBe(false);
    person.setMarker(true);
    expect(person.marker.visible).toBe(true);
    const y = person.marker.rotation.y;
    person.update(0.5);
    expect(person.marker.rotation.y).not.toBe(y);
    person.setMarker(false);
    expect(person.marker.visible).toBe(false);
  });

  it('parked agents get a waiting card at their seat; working agents get none', async () => {
    const ledger = await make('ledger');
    const seat = SEATS.ledger;
    expect(ledger.card).not.toBeNull();
    expect(ledger.card!.name).toBe('waiting-card');
    expect(Math.hypot(ledger.card!.position.x - seat.position[0], ledger.card!.position.z - seat.position[2])).toBeLessThan(0.2);
    expect(ledger.card!.position.y).toBeGreaterThan(seat.position[1] + 0.9); // clear of the chair back
    expect((await make('scout')).card).toBeNull();
  });
});
