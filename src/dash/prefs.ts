// Small per-browser preferences that more than one place switches (the ⌘K bar today, Settings later).
// Every storage access is guarded: blocked or missing storage means "the default" and "not remembered", never an error.

import { DEFAULT_PILLS, cleanPillOrder } from './pills';
import type { PillId } from './pills';

const DICTATION_KEY = 'beleza.hq.dictation';

/** Whether voice dictation in the command bar is switched on. Off until someone turns it on. */
export function dictationOn(): boolean {
  try {
    return localStorage.getItem(DICTATION_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDictation(on: boolean): void {
  try {
    localStorage.setItem(DICTATION_KEY, on ? '1' : '0');
  } catch {
    // not remembered; the person can switch it again next visit
  }
}

const LITE_KEY = 'beleza.hq.lite';

/** The remembered graphics choice: true = lighter, false = full, undefined = never chosen (the device decides). */
export function liteOn(): boolean | undefined {
  try {
    const v = localStorage.getItem(LITE_KEY);
    return v === '1' ? true : v === '0' ? false : undefined;
  } catch {
    return undefined;
  }
}

export function setLite(on: boolean): void {
  try {
    localStorage.setItem(LITE_KEY, on ? '1' : '0');
  } catch {
    // not remembered; the choice still applies for this visit
  }
}

const PILLS_KEY = 'beleza.hq.pills';

/** Which island status pills show, and in what order. Unknown ids are dropped; nothing usable means the default. */
export function pillsOrder(): PillId[] {
  try {
    const raw = localStorage.getItem(PILLS_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      const ids = Array.isArray(parsed) ? cleanPillOrder(parsed) : [];
      if (ids.length > 0) return ids;
    }
  } catch {
    // blocked storage or junk: the default order
  }
  return [...DEFAULT_PILLS];
}

export function setPillsOrder(ids: readonly PillId[]): void {
  try {
    localStorage.setItem(PILLS_KEY, JSON.stringify(cleanPillOrder(ids)));
  } catch {
    // not remembered; the order still applies for this visit
  }
}

const ONBOARDED_KEY = 'beleza.hq.onboarded';

/**
 * Whether the welcome wizard has already opened for this browser. Blocked storage counts as done: a visitor who cannot
 * be remembered would otherwise be sent to the wizard on every load.
 */
export function onboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return true;
  }
}

export function setOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, '1');
  } catch {
    // not remembered; nothing else depends on it
  }
}
