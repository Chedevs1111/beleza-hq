// Small pieces the four pages share.
import type { DemoActions } from '../actions';
import { h } from '../dom';
import type { HFn } from '../dom';
import type { Layers } from '../layers';
import type { DashStore } from '../store';
import { ROSTER } from '../../roster';
import type { AgentId } from '../../types';

export interface PageDeps {
  store: DashStore;
  actions: DemoActions;
  layers: Layers;
  /** An agent id from `#/page?agent=...`. */
  filter?: string;
}

/** The page heading. The shell focuses `.bz-page-title` after a route change. */
export const pageTitle = (text: string, hf: HFn = h): HTMLElement =>
  hf('h1', { class: 'bz-page-title bz-display', tabindex: '-1' }, text);

/** A small pill; `tone` picks its colour in pages.css. */
export const chip = (text: string, tone: string, hf: HFn = h): HTMLElement => hf('span', { class: `pg-chip pg-tone-${tone}` }, text);

/** Runs a handler so that nothing it does can throw into the browser's event loop. */
export const safely = (what: string, fn: () => void): (() => void) => () => {
  try {
    fn();
  } catch (err) {
    console.warn(`[hq] ${what} failed`, err);
  }
};

/** An `?agent=` value is trusted only if it names someone on the roster. */
export const agentFilter = (filter: string | undefined): AgentId | undefined => ROSTER.find((a) => a.id === filter)?.id;
