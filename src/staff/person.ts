// One member of staff: a Rocketbox avatar with an AnimationMixer, a name tag, a gold approval marker and
// the walking and sitting that Walker and the office layout allow. A capsule stands in when the avatar fails to load.
import * as THREE from 'three';
import type { Agent, ZoneId } from '../types';
import { assetUrl, createGltfLoader } from '../office/assets';
import type { Manifest } from '../office/assets';
import { SEATS, findPath } from '../office/layout';
import type { Seat, Vec3 } from '../office/layout';
import { nextClip, isSeated } from './states';
import type { ClipName, PersonState } from './states';
import { Walker, stairsY } from './walker';
import { CARD_H, createNameTag, createWaitingCard, GOLD_HEX } from './tag';
import type { NameTag } from './tag';

/** How fast people walk, in m/s (Walker's default). */
const WALK_SPEED = 1.3;
/**
 * Pace of the baked walk clip at timeScale 1. The asset pipeline cancels the clip's root travel, so the feet
 * slide unless the clip is sped up or slowed down to match the walker. Rocketbox: the female cycle covers
 * ~1.41 m in 1.17 s, the male ~1.19 m.
 */
const CLIP_PACE = { female: 1.2, male: 1.0 };
const FADE = 0.25; // crossfade between clips, seconds
const TURN_RATE = 8; // rad/s the body can swing toward its heading

/**
 * Seated root offset. The sit clips hold the pelvis ~0.614 m above the root; a chair seat top is at 0.46 m and
 * the hip joint sits ~0.1 m above the sit bones, so the body drops ~0.05 m onto the chair. SEAT_BACK is how far
 * back from the seat centre the body sits (negative = forward): a bulky jacket pushed through the chair's back
 * panel (0.2 m behind the centre) at 0, so it sits 3 cm forward.
 */
const SEAT_DROP = 0.05;
const SEAT_BACK = -0.03;
const SEAT_BLEND = 0.35; // seconds to settle onto, or rise from, the chair

/** Tag height above the feet, standing and seated; the marker floats above it. */
const TAG_Y = { standing: 2.0, seated: 1.72 };
const MARKER_GAP = 0.34;

/** The waiting card floats above the empty chair (back rail top ~0.9 m), readable from every side. */
const CARD_BOTTOM = 1.0;

/** The GLBs face +z, like `Seat.facing` 0. Change this if a model is ever exported turned. */
const MODEL_YAW = 0;

const ZONE_TINT: Record<ZoneId, number> = { growth: 0x4f8fdc, studio: 0xb06ad9, ops: 0xe0a040, client: 0x4fb38a };

const TAU = Math.PI * 2;
/** Shortest signed angle from `from` to `to`, in (-PI, PI]. */
function angleDiff(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

type GltfResult = { scene: THREE.Object3D; animations: THREE.AnimationClip[] };

let gltfLoader: ReturnType<typeof createGltfLoader> | undefined;

export class Person {
  readonly agent: Agent;
  /** Stands on the floor at the person's feet, turned the way they look. Add this to the scene. */
  readonly group = new THREE.Group();
  /** Holds the avatar. Lowered onto the chair while seated. */
  readonly body = new THREE.Group();
  readonly tag: THREE.Sprite;
  readonly marker: THREE.Mesh;
  /** The "waiting" card for a parked agent, floating over their empty chair. Not part of `group`: add it to the scene too. */
  readonly card: THREE.Sprite | null;

  private readonly nameTag: NameTag;
  private readonly mixer: THREE.AnimationMixer | null;
  private readonly actions = new Map<ClipName, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentClip: ClipName | null = null;
  private readonly fallback: boolean;
  private _state: PersonState = 'idle';
  private _label: string;

  private walker: Walker | null = null;
  private arrive: (() => void) | null = null;
  private release: (() => void) | null = null;
  private targetYaw = 0;
  private seatBlend = 0;
  private time = 0;

  private constructor(agent: Agent, model: GltfResult | null) {
    this.agent = agent;
    this.group.name = `person-${agent.id}`;
    this.body.rotation.y = MODEL_YAW;
    this.group.add(this.body);
    this.fallback = model === null;

    if (model) {
      model.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.body.add(model.scene);
      this.mixer = new THREE.AnimationMixer(model.scene);
      for (const clip of model.animations) this.actions.set(clip.name as ClipName, this.mixer.clipAction(clip));
      const pace = agent.look.model.includes('female') ? CLIP_PACE.female : CLIP_PACE.male;
      this.actions.get('walk')?.setEffectiveTimeScale(WALK_SPEED / pace);
    } else {
      this.mixer = null;
      this.body.add(...capsuleFigure(agent.zone));
    }

    this.nameTag = createNameTag(agent.name);
    this._label = agent.name;
    this.tag = this.nameTag.sprite;
    this.group.add(this.tag);

    this.marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.09).scale(1, 1.5, 1),
      new THREE.MeshBasicMaterial({ color: GOLD_HEX, toneMapped: false }),
    );
    this.marker.name = 'approval-marker';
    this.marker.visible = false;
    this.group.add(this.marker);

    this.card = agent.parked ? parkedCard(agent) : null;

    this.setState('idle');
    this.snap();
  }

  /** Loads the avatar named by the agent's look; on any failure the person is a zone-tinted capsule instead. */
  static async create(agent: Agent, manifest: Manifest): Promise<Person> {
    const entry = manifest.people[agent.look.model];
    let model: GltfResult | null = null;
    try {
      if (!entry) throw new Error(`"${agent.look.model}" is not in the manifest`);
      model = await (gltfLoader ??= createGltfLoader()).loadAsync(assetUrl(entry.file));
    } catch {
      console.warn('[staff] failed to load', entry?.file ?? `assets/people/${agent.look.model}.glb`);
    }
    return new Person(agent, model);
  }

  get state(): PersonState {
    return this._state;
  }

  get label(): string {
    return this._label;
  }

  /** Name of the clip playing now (null for the capsule's nothing). */
  get clip(): ClipName | null {
    return this.currentClip;
  }

  /** The timeScale of the walk clip: walker speed over the clip's natural pace. */
  get walkTimeScale(): number {
    return this.actions.get('walk')?.timeScale ?? 0;
  }

  /** Current blend weight of a clip, 0..1. */
  weight(clip: ClipName): number {
    return this.actions.get(clip)?.getEffectiveWeight() ?? 0;
  }

  setState(s: PersonState): void {
    if (s !== 'walking') this.cancelWalk(); // any other state ends a walk in progress (go() sets 'walking' itself)
    this._state = s;
    this.group.visible = s !== 'away'; // away = out of the building
    if (this.card) this.card.visible = !isSeated(s); // the card marks an empty seat
    const { clip, loop } = nextClip(s);
    if (this.currentClip === clip && loop) return; // a one-shot (cheer) replays when asked again
    this.currentClip = clip;
    const next = this.actions.get(clip);
    if (!next) return;
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = true; // a one-shot holds its last frame
    next.setEffectiveWeight(1);
    next.play();
    if (this.current && this.current !== next) next.crossFadeFrom(this.current, FADE, false);
    this.current = next;
  }

  /** Stands the person at `p` facing `yaw` at once, with no walk and no easing. */
  placeAt(p: Vec3, yaw = this.targetYaw): void {
    this.cancelWalk();
    this.group.position.set(p[0], p[1], p[2]);
    this.targetYaw = yaw;
    this.snap();
  }

  /** Jumps the turn and the seated blend to where they are heading. */
  snap(): void {
    this.group.rotation.y = this.targetYaw;
    this.seatBlend = isSeated(this._state) ? 1 : 0;
    this.applyPose();
  }

  /** Walks the aisles to `p` and resolves on arrival, leaving the person idle. A new walk releases the one before. */
  walkTo(p: Vec3): Promise<void> {
    return this.go(p, 'idle');
  }

  /** Walks to the seat, turns to face its way and sits. */
  sitAt(seat: Seat): Promise<void> {
    return this.go(seat.position, 'sitting', seat.facing);
  }

  setLabel(text: string): void {
    this._label = text;
    this.nameTag.set(text);
  }

  setMarker(on: boolean): void {
    this.marker.visible = on;
  }

  update(dt: number): void {
    if (this._state === 'away') return;
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;
    this.mixer?.update(dt);

    if (this.walker) {
      const s = this.walker.step(dt);
      this.group.position.set(s.position[0], stairsY(s.position[0], s.position[2]) ?? s.position[1], s.position[2]);
      this.targetYaw = s.heading;
      if (s.done) this.arrive?.();
    }

    const turn = angleDiff(this.group.rotation.y, this.targetYaw);
    const maxTurn = TURN_RATE * dt;
    this.group.rotation.y = angleDiff(0, this.group.rotation.y + (Math.abs(turn) <= maxTurn ? turn : Math.sign(turn) * maxTurn)); // kept in (-PI, PI]

    const step = dt / SEAT_BLEND;
    this.seatBlend += Math.min(Math.max((isSeated(this._state) ? 1 : 0) - this.seatBlend, -step), step);
    this.applyPose();

    if (this.marker.visible) this.marker.rotation.y += dt * 2;
  }

  private go(to: Vec3, end: PersonState, yaw?: number): Promise<void> {
    this.cancelWalk();
    const p = this.group.position;
    const walker = new Walker(findPath([p.x, p.y, p.z], to), WALK_SPEED);
    this.setState('walking');
    return new Promise<void>((resolve) => {
      this.release = resolve;
      this.arrive = () => {
        this.walker = null;
        this.arrive = null;
        this.release = null;
        if (yaw !== undefined) this.targetYaw = yaw;
        this.setState(end);
        resolve();
      };
      this.walker = walker;
      if (walker.step(0).done) this.arrive(); // already there
    });
  }

  /** Drops a walk in progress and releases whoever awaits it; the next state is the caller's to set. */
  private cancelWalk(): void {
    const release = this.release;
    this.walker = null;
    this.arrive = null;
    this.release = null;
    release?.();
  }

  private applyPose(): void {
    const b = this.seatBlend;
    if (this.fallback) {
      this.body.scale.y = 1 - 0.4 * b; // folded at the hips, standing on the seat
      this.body.position.set(0, 0.46 * b, 0);
    } else {
      this.body.position.set(0, -SEAT_DROP * b, -SEAT_BACK * b);
    }
    const tagY = TAG_Y.standing + (TAG_Y.seated - TAG_Y.standing) * b;
    this.tag.position.y = tagY;
    this.marker.position.y = tagY + MARKER_GAP + Math.sin(this.time * 3) * 0.04;
  }
}

/** A zone-tinted capsule with a small nose so its facing reads: the stand-in when an avatar can't load. */
function capsuleFigure(zone: ZoneId): THREE.Object3D[] {
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.22, 1.26, 4, 12).translate(0, 0.85, 0),
    new THREE.MeshStandardMaterial({ color: ZONE_TINT[zone], roughness: 0.6 }),
  );
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.1, 0.12).translate(0, 1.5, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x222222 }),
  );
  body.castShadow = nose.castShadow = true;
  return [body, nose];
}

/** The parked agent's waiting card, floating over their empty chair. */
function parkedCard(agent: Agent): THREE.Sprite {
  const card = createWaitingCard(agent.parkedReason ?? 'waiting');
  const seat = SEATS[agent.id];
  const [x, y, z] = seat.position;
  card.position.set(x, y + CARD_BOTTOM + CARD_H / 2, z);
  return card;
}
