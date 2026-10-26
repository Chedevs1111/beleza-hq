// Spring motion for the dashboard: CSS linear() easings sampled from a damped spring, plus a FLIP helper.

export interface Spring { stiffness: number; damping: number }

/** Where a unit-mass spring released at 0 is after `t` seconds, heading for 1. */
export function springAt(t: number, { stiffness, damping }: Spring): number {
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * w0);
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t); // critically damped (and anything stiffer)
}

/** The spring as a CSS `linear()` easing, with the time it takes to settle. */
export function springEasing(spring: Spring, samples = 40): { easing: string; ms: number } {
  let settle = 0;
  for (let t = 0; t < 3; t += 1 / 240) if (Math.abs(1 - springAt(t, spring)) > 0.002) settle = t;
  const seconds = Math.max(0.15, settle + 1 / 240);
  const points = Array.from({ length: samples + 1 }, (_, i) => (i === samples ? 1 : +springAt((i / samples) * seconds, spring).toFixed(4)));
  return { easing: `linear(${points.join(', ')})`, ms: Math.round(seconds * 1000) };
}

/** Lively (a touch of overshoot), smooth (none) and snappy (presses). */
export const SPRINGS = {
  bounce: { stiffness: 260, damping: 21 },
  smooth: { stiffness: 210, damping: 29 },
  snappy: { stiffness: 520, damping: 32 },
} satisfies Record<string, Spring>;

type SpringName = keyof typeof SPRINGS;
const FALLBACK: Record<SpringName, string> = {
  bounce: 'cubic-bezier(.34, 1.4, .64, 1)',
  smooth: 'cubic-bezier(.22, 1, .36, 1)',
  snappy: 'cubic-bezier(.3, 1.3, .6, 1)',
};

const linearOk = () => typeof CSS !== 'undefined' && CSS.supports('transition-timing-function', 'linear(0, 1)');

const eased = new Map<SpringName, { easing: string; ms: number }>();

/** Easing and duration for a spring, falling back to a cubic-bezier where linear() is missing. */
export function ease(name: SpringName): { easing: string; ms: number } {
  let e = eased.get(name);
  if (!e) {
    const s = springEasing(SPRINGS[name]);
    e = linearOk() ? s : { easing: FALLBACK[name], ms: s.ms };
    eased.set(name, e);
  }
  return e;
}

/** Puts --spring-* and --spring-*-ms on an element so the stylesheet can use them. */
export function installSprings(el: HTMLElement): void {
  for (const name of Object.keys(SPRINGS) as SpringName[]) {
    const { easing, ms } = ease(name);
    el.style.setProperty(`--spring-${name}`, easing);
    el.style.setProperty(`--spring-${name}-ms`, `${ms}ms`);
  }
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Children of `container` glide from where they were to where `mutate` puts them (FLIP). */
export function flip(container: HTMLElement, mutate: () => void): void {
  if (reducedMotion()) { mutate(); return; }
  const before = new Map<Element, DOMRect>();
  for (const child of container.children) before.set(child, child.getBoundingClientRect());
  mutate();
  const { easing, ms } = ease('smooth');
  for (const child of container.children) {
    const was = before.get(child);
    if (!was) continue;
    const now = child.getBoundingClientRect();
    const dx = was.left - now.left, dy = was.top - now.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    (child as HTMLElement).animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: ms, easing });
  }
}
