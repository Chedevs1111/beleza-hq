// What the reviewer can do from the dashboard in demo mode: approve, reject, approve in bulk, and "run now".
// Each action only emits AgentEvents through `emit` (main.ts's single entry, which gates them with the store and
// hands the accepted ones to the office), so the dashboard and the 3D office stay in step. Pure: no DOM, no three.js.

import type { AgentEvent, ApprovalMode, DraftKind, SendChannel } from '../events';
import { ROSTER } from '../roster';
import type { AgentId } from '../types';
import type { DashStore, DraftRecord } from './store';

/** Where an approved draft goes; null when approving it is the whole job (a plan schedules its posts). */
export const SEND_CHANNEL: Record<DraftKind, SendChannel | null> = {
  email: 'email',
  proposal: 'email',
  post: 'instagram',
  comment: 'instagram',
  linkedin: 'linkedin',
  plan: null,
};

/** The one test for "approve all plan", shared by the Approvals button and the command bar. */
export const isPlanDraft = (d: DraftRecord): boolean => d.kind === 'plan';

/** Time between a user's approval and Courier's `sent`. */
export const SEND_DELAY_MS = 3000;
/** Time between the events of a "run now" run. */
export const RUN_STEP_MS = 1500;

export interface DemoActions {
  /** Approves a waiting draft (default mode `item`); false if it is not waiting. */
  approve(id: string, mode?: ApprovalMode): boolean;
  /** Rejects a waiting draft; false if it is not waiting. */
  reject(id: string): boolean;
  /** Approves every waiting draft `pred` matches with `mode`; returns how many. */
  approveAll(pred: (d: DraftRecord) => boolean, mode: ApprovalMode): number;
  /** Starts a short demo run; returns its run id, or undefined for a parked, paused or already-working agent. */
  runNow(agent: AgentId): string | undefined;
  /** Drops everything scheduled so far (the rest of a run, a delayed `sent`); for when the demo day restarts. */
  cancelPending(): void;
}

export interface DemoActionsDeps {
  store: DashStore;
  emit: (e: AgentEvent) => void;
  later: (ms: number, fn: () => void) => void;
  paused?: (a: AgentId) => boolean;
}

/** The agents whose runs end in a draft for approval, and what that draft is. */
const DRAFTER: Partial<Record<AgentId, { kind: DraftKind; summary: string }>> = {
  quill: { kind: 'email', summary: 'First email: quick check of a café site' },
  echo: { kind: 'email', summary: 'Answer to a new enquiry' },
  linx: { kind: 'linkedin', summary: 'Connection note: local business owner' },
  pulse: { kind: 'comment', summary: 'Reply to a new comment' },
  forge: { kind: 'proposal', summary: 'One-page summary for a lead that said yes' },
  muse: { kind: 'plan', summary: "Next week's content plan" },
  atlas: { kind: 'proposal', summary: 'Site check summary' },
};

/** A small fixed cost per run, USD. */
const RUN_COST: Record<AgentId, number> = {
  tempo: 0.03,
  scout: 0.08,
  echo: 0.05,
  atlas: 0.1,
  quill: 0.06,
  linx: 0.05,
  forge: 0.07,
  muse: 0.09,
  lumen: 0.12,
  pulse: 0.04,
  sentinel: 0.02,
  herald: 0.02,
  courier: 0.01,
  ledger: 0,
  keeper: 0,
};

const PROGRESS_TEXT = ['Getting started', 'Working on it', 'Nearly done'] as const;

export function createDemoActions(deps: DemoActionsDeps): DemoActions {
  const { store, later, paused } = deps;
  const roleOf = new Map(ROSTER.map((a) => [a.id, a.role]));
  /** Runs started here that have not finished, so a second click cannot start another. */
  const inFlight = new Set<AgentId>();
  let runCount = 0;
  /** Bumped by cancelPending; a timer scheduled under an older epoch does nothing. */
  let epoch = 0;
  const laterHere = (ms: number, fn: () => void): void => {
    const mine = epoch;
    later(ms, () => {
      if (mine === epoch) fn();
    });
  };

  // The emit given is main.ts's, which never throws; but these also run from timers, so make sure.
  const emit = (e: AgentEvent): void => {
    try {
      deps.emit(e);
    } catch (err) {
      console.warn('[hq] could not emit', e, err);
    }
  };

  const approve = (id: string, mode: ApprovalMode = 'item'): boolean => {
    const d = store.draft(id);
    if (!d || d.status !== 'waiting') return false;
    emit({ type: 'approved', draftId: id, mode });
    const channel = SEND_CHANNEL[d.kind];
    if (channel !== null) laterHere(SEND_DELAY_MS, () => emit({ type: 'sent', draftId: id, channel }));
    return true;
  };

  const reject = (id: string): boolean => {
    if (store.draft(id)?.status !== 'waiting') return false;
    emit({ type: 'rejected', draftId: id });
    return true;
  };

  const approveAll = (pred: (d: DraftRecord) => boolean, mode: ApprovalMode): number => {
    let n = 0;
    for (const d of store.drafts({ status: 'waiting' })) if (pred(d) && approve(d.id, mode)) n++;
    return n;
  };

  const runNow = (agent: AgentId): string | undefined => {
    if (store.statusOf(agent) === 'parked' || paused?.(agent) || inFlight.has(agent) || store.hasOpenRun(agent)) {
      return undefined;
    }
    const n = ++runCount;
    const runId = `${agent}-now-${n}`;
    const draft = DRAFTER[agent];
    inFlight.add(agent);

    // One event every RUN_STEP_MS, the first at once.
    const steps: AgentEvent[] = [
      { type: 'run_started', runId, agent, task: roleOf.get(agent) ?? 'Working' },
      ...PROGRESS_TEXT.map((text, i): AgentEvent => ({ type: 'progress', runId, agent, text, done: i + 1, total: 3 })),
    ];
    if (draft) {
      steps.push(
        { type: 'draft_submitted', runId, agent, draftId: runId, kind: draft.kind, summary: draft.summary },
        { type: 'sentinel_result', draftId: runId, pass: true, reasons: [] },
        { type: 'awaiting_approval', draftId: runId, agent },
      );
    }
    steps.push({ type: 'run_finished', runId, agent, status: 'ok', costUsd: RUN_COST[agent] });

    steps.forEach((e, i) => {
      const fire = (): void => {
        if (e.type === 'run_finished') inFlight.delete(agent);
        emit(e);
      };
      if (i === 0) fire();
      else laterHere(i * RUN_STEP_MS, fire);
    });
    return runId;
  };

  const cancelPending = (): void => {
    epoch++;
    inFlight.clear(); // the cancelled runs will never finish
  };

  return { approve, reject, approveAll, runNow, cancelPending };
}
