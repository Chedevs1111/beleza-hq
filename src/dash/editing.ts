// The Approvals editor tells the rest of the page which draft it is open for, and the demo player's scripted decisions
// for that draft wait until it closes: the public demo's script would otherwise approve the draft under a visitor's
// cursor and throw their typing away. Pure bookkeeping: no DOM.
import type { AgentEvent } from '../events';

let current: string | undefined;
const listeners = new Set<() => void>();

/** The draft the Approvals editor is open for, if any. */
export const editingId = (): string | undefined => current;

/** Set by the Approvals page when an editor opens (an id) or closes (undefined). Listeners hear every change. */
export function setEditingId(id: string | undefined): void {
  if (id === current) return;
  current = id;
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch (err) {
      console.warn('[hq] editor listener failed', err);
    }
  }
}

export function onEditingChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Scripted decisions for the draft being edited, held back until the editor closes. */
export class ScriptHold {
  private held: AgentEvent[] = [];

  constructor(private readonly editing: () => string | undefined) {}

  /** True when the event was held (the caller must not emit it now). */
  offer(e: AgentEvent): boolean {
    if (e.type !== 'approved' && e.type !== 'rejected' && e.type !== 'sent') return false;
    const id = this.editing();
    if (id === undefined || e.draftId !== id) return false;
    this.held.push(e);
    return true;
  }

  /** Hands back what was held, in order, and forgets it. */
  release(): AgentEvent[] {
    const out = this.held;
    this.held = [];
    return out;
  }

  /** Hands back, in order, what was held for any draft other than the one being edited now, and keeps the rest. */
  releaseStale(): AgentEvent[] {
    const id = this.editing();
    const out = this.held.filter((e) => 'draftId' in e && e.draftId !== id);
    this.held = this.held.filter((e) => !out.includes(e));
    return out;
  }

  /** The demo day restarted: what was held belongs to a day that no longer exists. */
  discard(): void {
    this.held = [];
  }
}

/**
 * The demo player's decisions, held while their draft is being edited. Whenever the editor closes or moves to another
 * draft, whatever it held for drafts no longer edited goes through `emit`, in arrival order.
 */
export function holdScriptedDecisions(emit: (e: AgentEvent) => void): {
  handle: (e: AgentEvent) => void;
  discard: () => void;
  dispose: () => void;
} {
  const hold = new ScriptHold(editingId);
  const dispose = onEditingChange(() => {
    for (const e of hold.releaseStale()) emit(e);
  });
  return { handle: (e) => { if (!hold.offer(e)) emit(e); }, discard: () => hold.discard(), dispose };
}

/** Whether closing an editor without saving loses anything the person typed. */
export const lostEdit = (original: string, typed: string): boolean => original !== typed;
