// Canvas sprites for the staff: the name tag over a head and the "waiting" card on a parked agent's desk.
// Drawn with 2D canvas text. Space Grotesk is used if the page has loaded it, otherwise the system sans.
// Without a DOM (unit tests) the sprites are created without a texture.
import * as THREE from 'three';

const GOLD = '#e9c26b';
const INK = 'rgba(11, 8, 16, 0.86)';
const FONT = '"Space Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif';

const hasCanvas = typeof document !== 'undefined';

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A dark rounded plate with a gold rim, filling the canvas. */
function plate(ctx: CanvasRenderingContext2D, w: number, h: number, rim: number): void {
  ctx.clearRect(0, 0, w, h);
  roundedRect(ctx, rim / 2, rim / 2, w - rim, h - rim, h * 0.28);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.lineWidth = rim;
  ctx.strokeStyle = GOLD;
  ctx.stroke();
}

function spriteFor(canvas: HTMLCanvasElement | null, width: number, height: number): THREE.Sprite {
  const map = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (map) map.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true }));
  sprite.scale.set(width, height, 1);
  return sprite;
}

export interface NameTag {
  sprite: THREE.Sprite;
  /** Redraws the tag in place (one canvas, one texture upload). */
  set(text: string): void;
}

const TAG_W = 1.0; // metres
const TAG_H = 0.25;
const TAG_PX = [512, 128] as const;

export function createNameTag(text: string): NameTag {
  const canvas = hasCanvas ? Object.assign(document.createElement('canvas'), { width: TAG_PX[0], height: TAG_PX[1] }) : null;
  const ctx = canvas?.getContext('2d') ?? null;
  const sprite = spriteFor(ctx ? canvas : null, TAG_W, TAG_H);
  sprite.name = 'name-tag';

  const set = (label: string): void => {
    if (!ctx || !canvas) return;
    const [w, h] = TAG_PX;
    plate(ctx, w, h, 6);
    // Shrink the type until the text fits inside the plate.
    let size = 60;
    ctx.font = `600 ${size}px ${FONT}`;
    while (size > 24 && ctx.measureText(label).width > w - 56) {
      size -= 2;
      ctx.font = `600 ${size}px ${FONT}`;
    }
    ctx.fillStyle = '#fff7e6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, w / 2, h / 2 + 3);
    (sprite.material.map as THREE.CanvasTexture).needsUpdate = true;
  };
  set(text);
  return { sprite, set };
}

const CARD_W = 0.72;
/** Height of the waiting card in metres. */
export const CARD_H = 0.36;
const CARD_PX = [448, 224] as const;

/** A small "waiting" card with the reason an agent is parked, for their empty seat. */
export function createWaitingCard(reason: string): THREE.Sprite {
  const canvas = hasCanvas ? Object.assign(document.createElement('canvas'), { width: CARD_PX[0], height: CARD_PX[1] }) : null;
  const ctx = canvas?.getContext('2d') ?? null;
  const sprite = spriteFor(ctx ? canvas : null, CARD_W, CARD_H);
  sprite.name = 'waiting-card';
  if (!ctx || !canvas) return sprite;

  const [w, h] = CARD_PX;
  plate(ctx, w, h, 8);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = GOLD;
  ctx.font = `700 34px ${FONT}`;
  ctx.letterSpacing = '6px';
  ctx.fillText('WAITING', w / 2, h * 0.27);
  ctx.letterSpacing = '0px';

  // The reason, wrapped to at most two lines.
  ctx.fillStyle = '#fff7e6';
  ctx.font = `500 36px ${FONT}`;
  const lines: string[] = [];
  let line = '';
  for (const word of reason.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > w - 64) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  lines.push(line);
  lines.slice(0, 2).forEach((l, i, all) => ctx.fillText(l, w / 2, h * (all.length === 1 ? 0.64 : 0.57 + i * 0.2)));
  (sprite.material.map as THREE.CanvasTexture).needsUpdate = true;
  return sprite;
}

/** The gold used for the rim of tags and cards, and for the approval marker. */
export const GOLD_HEX = 0xe9c26b;
