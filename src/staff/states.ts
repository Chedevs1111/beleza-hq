// What a person is doing, and which baked clip shows it. Pure data, no three.js.

export type PersonState = 'idle' | 'walking' | 'sitting' | 'typing' | 'carrying' | 'talking' | 'cheering' | 'away';

/** The clips baked into every avatar GLB (the ninth, `wave`, is not used by any state yet). */
export type ClipName = 'idle' | 'walk' | 'sit_idle' | 'sit_type' | 'carry' | 'talk' | 'cheer';

export interface ClipChoice {
  clip: ClipName;
  /** Looping clips repeat; the others play once and hold their last frame. */
  loop: boolean;
}

const CLIPS: Record<PersonState, ClipChoice> = {
  idle: { clip: 'idle', loop: true },
  walking: { clip: 'walk', loop: true },
  sitting: { clip: 'sit_idle', loop: true },
  typing: { clip: 'sit_type', loop: true }, // Rocketbox has no seated typing clip: this is a seated idle at a table
  carrying: { clip: 'carry', loop: true },
  talking: { clip: 'talk', loop: true },
  cheering: { clip: 'cheer', loop: false },
  away: { clip: 'idle', loop: true }, // not shown (see Person.setState), so any clip will do
};

export function nextClip(s: PersonState): ClipChoice {
  return CLIPS[s];
}

/** Seated states put the body on the chair. */
export function isSeated(s: PersonState): boolean {
  return s === 'sitting' || s === 'typing';
}
