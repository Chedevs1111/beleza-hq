// The small DOM furniture around the canvas: the time-of-day chip, the team bar, the frame-rate meter and the
// "needs WebGL" message. Text is set with textContent only. Styles are in hud.css (imported by main.ts).
import type { Agent } from '../types';
import type { Phase } from '../office/timeofday';

/** "07:30" for an hour of the day in 0..24 (24 wraps to 00:00). */
export function formatClock(hour: number): string {
  const total = Math.floor((((Number.isFinite(hour) ? hour : 0) % 24) + 24) % 24 * 60 + 1e-6);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const PHASE_LABEL: Record<Phase, string> = { morning: 'Morning', day: 'Day', golden: 'Golden hour', night: 'Night' };

export function phaseLabel(phase: Phase): string {
  return PHASE_LABEL[phase];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface ClockChip {
  /** Cheap to call every frame: the DOM is only touched when the minute or phase changes. */
  set(hour: number, phase: Phase): void;
}

/** A glass chip with the time and the phase of the day. `source` says where the time comes from. */
export function createClockChip(source: 'Demo' | 'Live' | 'Fixed'): ClockChip {
  const root = el('div', 'hq-chip-clock');
  root.setAttribute('role', 'timer'); // not 'status': a live region would announce every demo minute
  root.setAttribute('aria-label', 'Office time');
  const time = el('span', 'hq-chip-time');
  const phase = el('span', 'hq-chip-phase');
  root.append(el('span', 'hq-chip-source', source), time, phase);
  document.body.append(root);
  let lastTime = '';
  let lastPhase = '';
  return {
    set(hour, p) {
      const t = formatClock(hour);
      if (t !== lastTime) time.textContent = lastTime = t;
      if (p !== lastPhase) {
        phase.textContent = PHASE_LABEL[p];
        root.dataset.phase = lastPhase = p;
      }
    },
  };
}

/** One button per agent along the bottom, so Atlas and the others are one click away whatever the camera shows. */
export function createTeamBar(agents: readonly Agent[], onPick: (agent: Agent) => void): HTMLElement {
  const bar = el('nav', 'hq-team');
  bar.setAttribute('aria-label', 'Team');
  for (const a of agents) {
    const b = el('button', 'hq-team-btn');
    b.type = 'button';
    b.dataset.zone = a.zone;
    if (a.parked) b.classList.add('hq-team-parked');
    b.setAttribute('aria-label', a.parked ? `${a.name}, parked` : a.name);
    const dot = el('span', 'hq-team-dot', a.name[0]);
    dot.setAttribute('aria-hidden', 'true');
    b.append(dot, el('span', 'hq-team-name', a.name));
    b.addEventListener('click', () => onPick(a));
    bar.append(b);
  }
  document.body.append(bar);
  return bar;
}

export interface FpsMeter {
  /** Call every frame with the real frame time in seconds and a short status to show after the number. */
  frame(dt: number, status: string): void;
}

export function createFpsMeter(): FpsMeter {
  const root = el('div', 'hq-fps');
  root.id = 'hq-fps';
  document.body.append(root);
  let frames = 0;
  let elapsed = 0;
  return {
    frame(dt, status) {
      frames++;
      elapsed += dt;
      if (elapsed < 0.5) return;
      root.textContent = `${Math.round(frames / elapsed)} fps · ${status}`;
      frames = 0;
      elapsed = 0;
    },
  };
}

let noGl: HTMLElement | null = null;

/** Replaces the picture with a plain message. Safe to call twice. */
export function showNoGl(): void {
  if (!noGl) {
    noGl = el('div', 'nogl', 'Beleza HQ needs WebGL. Try Chrome or Safari on a recent Mac.');
    noGl.setAttribute('role', 'alert');
    document.body.append(noGl);
  }
  noGl.hidden = false;
  document.body.classList.add('hq-nogl');
}

export function hideNoGl(): void {
  if (noGl) noGl.hidden = true;
  document.body.classList.remove('hq-nogl');
}
