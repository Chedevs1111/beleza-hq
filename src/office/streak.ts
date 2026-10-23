// The light streak that leaves over the ocean when Courier sends something: a bright head with a fading trail,
// flying out through the glazing and up toward the far shore. Everything is preallocated; update() makes no objects.
import * as THREE from 'three';
import { COURIER_WINDOW } from './layout';

const POOL = 3; // sends can come a few seconds apart
const TRAIL = 12;
const SECONDS = 2.2;
const RANGE = 185; // metres out over the water
const RISE = 22;
const DRIFT = -100; // along the coast, away from the camera side: from the home view this keeps the streak inside the glazing instead of leaving the frame at once
const TRAIL_STEP = 0.022; // how far behind the head each trail sprite sits, as a fraction of the flight
const COLOUR = 0xffb830; // plain alpha blending, not additive: an additive glow disappears against the bright daytime sky

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** A soft round glow, drawn once. Without a DOM (unit tests) the sprites go untextured. */
function glowTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,236,190,0.7)');
  grad.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface Streak {
  group: THREE.Group;
  /** Sends one streak out of the window. Several can be in the air at once. */
  fire(): void;
  /** Call once per frame with the running time in seconds. */
  update(t: number): void;
}

export function buildStreak(origin: readonly [number, number, number] = [COURIER_WINDOW[0] + 0.2, 1.35, COURIER_WINDOW[2]]): Streak {
  const group = new THREE.Group();
  group.name = 'streak';
  const map = glowTexture();
  const flights = Array.from({ length: POOL }, () => {
    const sprites = Array.from({ length: TRAIL }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map,
        color: COLOUR,
        transparent: true,
        opacity: 0,
        // The glazing writes depth, so a depth-tested streak would vanish behind the glass. It is drawn over the picture
        // instead; it only ever flies outside the building, so little is wrongly overdrawn.
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }));
      s.visible = false;
      s.renderOrder = 10;
      group.add(s);
      return s;
    });
    return { sprites, start: -1, active: false };
  });
  let pending = 0;

  return {
    group,
    fire() { pending++; },
    update(t: number) {
      while (pending > 0) {
        pending--;
        // A free slot, otherwise the one that has flown longest.
        let slot = flights[0];
        for (const f of flights) {
          if (!f.active) { slot = f; break; }
          if (f.start < slot.start) slot = f;
        }
        slot.active = true;
        slot.start = t;
      }
      for (const f of flights) {
        if (!f.active) continue;
        const age = (t - f.start) / SECONDS;
        if (age >= 1) {
          f.active = false;
          for (const s of f.sprites) s.visible = false;
          continue;
        }
        const fade = 1 - clamp01((age - 0.65) / 0.35);
        for (let i = 0; i < TRAIL; i++) {
          const s = f.sprites[i];
          const a = Math.max(0, age - i * TRAIL_STEP);
          const e = 1 - (1 - a) * (1 - a); // quick off the glass, slowing as it climbs away
          s.position.set(origin[0] + RANGE * e, origin[1] + RISE * e * e, origin[2] + DRIFT * e);
          s.scale.setScalar((0.35 + 5 * e) * (1 - 0.6 * (i / TRAIL)));
          s.material.opacity = Math.pow(1 - i / TRAIL, 1.5) * fade * clamp01(age * 12);
          s.visible = true;
        }
      }
    },
  };
}
