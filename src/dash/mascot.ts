// The island's mascot: a small amethyst "b" (the Beleza mark) with two eyes whose look says what the team is doing.
// Static, trusted SVG markup with no inputs; colours and motion come from island.css (classes), so the fills follow the
// --bz-* tokens. `mascot-eye` appears exactly twice in every mood.
import type { AgentEvent } from '../events';

export type MascotMood =
  | 'bright' | 'envelope' | 'cheer' | 'doze' | 'calm'
  | 'greet' | 'think' | 'proud' | 'annoyed' | 'yawn' | 'sleep';

/** How long the hello at page open shows (ms). */
export const GREET_MS = 1500;
/** Minutes with no pointer, keyboard or touch before the mascot yawns, and before it sleeps. */
export const YAWN_MINUTES = 3;
export const SLEEP_MINUTES = 6;

export type MoodInput =
  | { kind: 'open' }
  | { kind: 'event'; event: AgentEvent }
  | { kind: 'idle'; minutes: number };

/**
 * The mood a moment leads to. Opening the page greets; a run starting makes it think; an approval makes it proud and the
 * send that follows makes it cheer; a failed run annoys it; idle time yawns (3 min) then sleeps (6 min). Idle at 0 is
 * any input: it wakes a yawning or sleeping mascot (to `calm`) and leaves every other mood as it is. Anything else keeps `current`.
 */
export function moodFor(e: MoodInput, current: MascotMood): MascotMood {
  switch (e.kind) {
    case 'open':
      return 'greet';
    case 'idle':
      if (e.minutes >= SLEEP_MINUTES) return 'sleep';
      if (e.minutes >= YAWN_MINUTES) return 'yawn';
      return current === 'yawn' || current === 'sleep' ? 'calm' : current;
    case 'event':
      switch (e.event.type) {
        case 'run_started': return 'think';
        case 'approved': return 'proud';
        case 'sent': return 'cheer';
        case 'run_finished': return e.event.status === 'failed' ? 'annoyed' : current;
        default: return current;
      }
  }
}

/** The "b": a rounded stem and a round bowl, with a soft highlight. */
const BODY =
  '<rect class="mascot-body" x="5.5" y="2" width="7.5" height="26" rx="3.75"/>'
  + '<circle class="mascot-body" cx="18" cy="19" r="10"/>'
  + '<ellipse class="mascot-shine" cx="15.2" cy="13.4" rx="4.4" ry="2.2" transform="rotate(-24 15.2 13.4)"/>';

/** Round eyes; `look` moves the pupils (negative is up), `side` sideways (positive is right). */
const openEyes = (look = 0, side = 0): string =>
  [15.4, 21.4]
    .map(
      (cx) =>
        `<g class="mascot-eye"><circle class="mascot-sclera" cx="${cx}" cy="18" r="2.6"/>`
        + `<circle class="mascot-pupil" cx="${cx + side}" cy="${18 + look}" r="1.2"/></g>`,
    )
    .join('');

/** Happy arcs (^ ^). */
const cheerEyes = (): string =>
  [15.4, 21.4].map((cx) => `<path class="mascot-eye mascot-arc" d="M${cx - 2.2} 18.6q2.2-3.4 4.4 0"/>`).join('');

/** Closed, sleepy lids. */
const shutEyes = (): string =>
  [15.4, 21.4].map((cx) => `<path class="mascot-eye mascot-arc" d="M${cx - 2.2} 18q2.2 2 4.4 0"/>`).join('');

/** Squeezed shut, mid-yawn (> <). */
const squeezeEyes = (): string =>
  '<path class="mascot-eye mascot-arc" d="M13.4 16.6l3.6 1.5-3.6 1.5"/>'
  + '<path class="mascot-eye mascot-arc" d="M23.4 16.6l-3.6 1.5 3.6 1.5"/>';

/** Eyebrows are plain strokes; they never carry the eye class. */
const brows = (d: string): string => `<path class="mascot-brow" d="${d}"/>`;

const SMILE = '<path class="mascot-mouth" d="M15 23.2q3 2.6 6 0"/>';
const BIG_SMILE = '<path class="mascot-mouth-open" d="M14.6 22.6q3.4 4.6 6.8 0z"/>';
const HUSH = '<ellipse class="mascot-mouth-open" cx="18" cy="24" rx="1.3" ry="1.1"/>';

const SPARK = (x: number, y: number, r: number, cls: string): string =>
  `<path class="${cls}" d="M${x} ${y - r}L${x + r * 0.32} ${y - r * 0.32}L${x + r} ${y}L${x + r * 0.32} ${y + r * 0.32}L${x} ${y + r}L${x - r * 0.32} ${y + r * 0.32}L${x - r} ${y}L${x - r * 0.32} ${y - r * 0.32}z"/>`;

const FACE: Record<MascotMood, string> = {
  // Working: eyes open, a little spark of effort.
  bright: openEyes() + SMILE + SPARK(27, 6.5, 3.2, 'mascot-spark'),
  // A draft is waiting: looking up at a gold envelope.
  envelope:
    openEyes(-0.9)
    + '<path class="mascot-mouth" d="M15.4 23.6h5.2"/>'
    + '<g class="mascot-mail"><rect x="21" y="1.5" width="10" height="7.4" rx="1.6"/><path d="M21.6 2.6L26 6l4.4-3.4"/></g>',
  // Something went out: happy arcs and sparkles.
  cheer: cheerEyes() + BIG_SMILE + SPARK(27.5, 6, 3.4, 'mascot-spark') + SPARK(4, 24, 2.2, 'mascot-spark mascot-spark-b'),
  // Quiet: eyes shut and a drifting z.
  doze: shutEyes() + HUSH + '<path class="mascot-z" d="M24.5 3.5h5l-5 5.5h5"/>',
  // Island open and nothing waiting: easy and calm.
  calm: openEyes() + SMILE,
  // Page just opened: brows up, a wide smile and a little wave.
  greet:
    openEyes() + brows('M12.9 13.4q2.5-1.6 5 0M18.9 13.4q2.5-1.6 5 0') + BIG_SMILE
    + '<path class="mascot-wave mascot-wave-a" d="M27 9.5q2.4 1.6 0 3.4"/><path class="mascot-wave mascot-wave-b" d="M29.4 8q4 3.4 0 6.8"/>',
  // A run just started: eyes up and to the side, a lopsided mouth and a thought rising.
  think:
    openEyes(-1, 0.7) + brows('M12.9 14.4h4.4M19.6 13.3l4.4-1') + '<path class="mascot-mouth" d="M15.8 24.6q2.4-0.6 4.6-1.4"/>'
    + '<circle class="mascot-dot mascot-dot-a" cx="25.2" cy="10.6" r="0.9"/><circle class="mascot-dot mascot-dot-b" cx="27.6" cy="7.4" r="1.3"/>'
    + '<circle class="mascot-dot mascot-dot-c" cx="30" cy="3.2" r="2"/>',
  // Approved: a pleased smirk and a gold tick.
  proud:
    openEyes(0.2) + brows('M12.9 14q2.5-1 5 0M18.9 14q2.5-1 5 0') + '<path class="mascot-mouth" d="M14.8 23q3.4 3.4 6.8-0.8"/>'
    + '<g class="mascot-tick"><circle cx="27.5" cy="6.5" r="4"/><path d="M25.5 6.6l1.5 1.6 2.8-3.2"/></g>',
  // A run failed: heavy brows, a flat frown and a puff.
  annoyed:
    openEyes(0.4) + brows('M12.4 13.2L17.8 15.4M24.4 13.2L19 15.4') + '<path class="mascot-mouth" d="M15 25.4q3-2.6 6 0"/>'
    + '<path class="mascot-puff" d="M25.6 5.2l3.4 2.4M29 5.2l-3.4 2.4M27.3 3.6v5.6"/>',
  // Idle a few minutes: eyes squeezed shut and a wide yawn.
  yawn:
    squeezeEyes() + '<ellipse class="mascot-mouth-open mascot-yawn" cx="18" cy="25" rx="2.3" ry="3"/>'
    + '<path class="mascot-tear" d="M12.2 20.4q-0.9 1.5 0 2.1q0.9-0.6 0-2.1z"/>',
  // Idle a long while: asleep, a nose bubble and two z's.
  sleep:
    shutEyes() + '<path class="mascot-mouth" d="M16.6 24h2"/><circle class="mascot-bubble" cx="21.8" cy="24.4" r="1.9"/>'
    + '<path class="mascot-z" d="M22.5 6h4l-4 4.2h4"/><path class="mascot-z mascot-z-b" d="M28.2 1.4h3l-3 3.2h3"/>',
};

export function mascotSvg(mood: MascotMood): string {
  return (
    `<svg class="mascot" data-mood="${mood}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">`
    + `${BODY}<g class="mascot-face">${FACE[mood]}</g></svg>`
  );
}
