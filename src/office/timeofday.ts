// Time-of-day lighting for the ocean-view office. Pure functions, no three.js.
// Local time is Pretoria/Johannesburg (SAST, UTC+2, no DST). Hours are fractional, 0..24.

export type Phase = 'morning' | 'day' | 'golden' | 'night';

export interface Lighting {
  phase: Phase;
  sunElevationDeg: number;
  /** Compass bearing in degrees, 0 = north, 90 = east, 180 = south, 270 = west. */
  sunAzimuthDeg: number;
  /** Hex colour, e.g. 0xfff3e2. */
  sunColor: number;
  sunIntensity: number;
  exposure: number;
  /** 0..1 */
  interiorLights: number;
  /** 0..1 */
  ledGlow: number;
  /** 0..1 */
  shoreLights: number;
}

const SUNRISE = 5.5;
const SUNSET = 18.5;
const MAX_ELEVATION_DEG = 75; // Pretoria, late October, solar noon
const MIN_ELEVATION_DEG = -40; // solar midnight

const MORNING_START = SUNRISE;
const DAY_START = 10;
const GOLDEN_START = 16.75;
const NIGHT_START = 19; // golden hour fades through dusk until here

interface Keyframe {
  hour: number;
  sunColor: number;
  sunIntensity: number;
  exposure: number;
  interiorLights: number;
  ledGlow: number;
  shoreLights: number;
}

function kf(
  hour: number,
  sunColor: number,
  sunIntensity: number,
  exposure: number,
  interiorLights: number,
  ledGlow: number,
  shoreLights: number,
): Keyframe {
  return { hour, sunColor, sunIntensity, exposure, interiorLights, ledGlow, shoreLights };
}

const NIGHT = kf(0, 0x7f93d9, 0.08, 1.1, 1, 1, 1);

// Sorted by hour; first and last are the same night look so midnight wraps seamlessly.
const KEYFRAMES: Keyframe[] = [
  NIGHT,
  kf(5.5, 0xffb27a, 0.3, 1.05, 0.9, 0.9, 0.8),
  kf(7, 0xffe6c8, 0.9, 0.95, 0.5, 0.6, 0.2),
  kf(10, 0xfff3e2, 1.2, 0.85, 0.3, 0.4, 0),
  kf(12, 0xfff3e2, 1.3, 0.8, 0.25, 0.35, 0),
  kf(15.5, 0xfff3e2, 1.2, 0.85, 0.3, 0.4, 0),
  kf(16.75, 0xffd29a, 1.0, 0.95, 0.4, 0.5, 0),
  kf(17.75, 0xffa860, 0.8, 1.0, 0.55, 0.65, 0.1),
  kf(18.5, 0xff8a5c, 0.4, 1.05, 0.8, 0.85, 0.5),
  kf(19.25, 0x8f8fd0, 0.1, 1.1, 0.95, 1, 0.9),
  kf(19.5, 0x7f93d9, 0.08, 1.1, 1, 1, 1),
  { ...NIGHT, hour: 24 },
];

function wrapHour(hour: number): number {
  return ((hour % 24) + 24) % 24;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(a: number, b: number, t: number): number {
  const r = Math.round(lerp((a >> 16) & 0xff, (b >> 16) & 0xff, t));
  const g = Math.round(lerp((a >> 8) & 0xff, (b >> 8) & 0xff, t));
  const bl = Math.round(lerp(a & 0xff, b & 0xff, t));
  return (r << 16) | (g << 8) | bl;
}

function phaseAt(h: number): Phase {
  if (h >= MORNING_START && h < DAY_START) return 'morning';
  if (h >= DAY_START && h < GOLDEN_START) return 'day';
  if (h >= GOLDEN_START && h < NIGHT_START) return 'golden';
  return 'night';
}

function sunElevation(h: number): number {
  if (h >= SUNRISE && h <= SUNSET) {
    return MAX_ELEVATION_DEG * Math.sin((Math.PI * (h - SUNRISE)) / (SUNSET - SUNRISE));
  }
  const nightLength = 24 - (SUNSET - SUNRISE);
  const sinceSunset = h > SUNSET ? h - SUNSET : h + 24 - SUNSET;
  return MIN_ELEVATION_DEG * Math.sin((Math.PI * sinceSunset) / nightLength);
}

// East at sunrise, north at noon (southern hemisphere), west at sunset,
// then back round through north (below the horizon) to east.
function sunAzimuth(h: number): number {
  if (h >= SUNRISE && h <= SUNSET) {
    return wrapDegrees(90 - (180 * (h - SUNRISE)) / (SUNSET - SUNRISE));
  }
  const nightLength = 24 - (SUNSET - SUNRISE);
  const sinceSunset = h > SUNSET ? h - SUNSET : h + 24 - SUNSET;
  return wrapDegrees(270 + (180 * sinceSunset) / nightLength);
}

function wrapDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function lightingAt(hour: number): Lighting {
  const h = wrapHour(hour);

  let i = 0;
  while (i < KEYFRAMES.length - 2 && h >= KEYFRAMES[i + 1].hour) i++;
  const a = KEYFRAMES[i];
  const b = KEYFRAMES[i + 1];
  const t = smoothstep((h - a.hour) / (b.hour - a.hour));

  return {
    phase: phaseAt(h),
    sunElevationDeg: sunElevation(h),
    sunAzimuthDeg: sunAzimuth(h),
    sunColor: lerpColor(a.sunColor, b.sunColor, t),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, t),
    exposure: lerp(a.exposure, b.exposure, t),
    interiorLights: lerp(a.interiorLights, b.interiorLights, t),
    ledGlow: lerp(a.ledGlow, b.ledGlow, t),
    shoreLights: lerp(a.shoreLights, b.shoreLights, t),
  };
}

const JOHANNESBURG_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Johannesburg',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Fractional hour (0..24) of the given instant on the Africa/Johannesburg clock. */
export function johannesburgHour(date: Date): number {
  const parts = JOHANNESBURG_CLOCK.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get('hour') + get('minute') / 60 + get('second') / 3600;
}

/** Demo clock: starts at 06:00 and runs a full 24h day every `secondsPerDay` seconds. */
export function demoHour(elapsedSeconds: number, secondsPerDay = 600): number {
  return wrapHour(6 + (elapsedSeconds / secondsPerDay) * 24);
}
