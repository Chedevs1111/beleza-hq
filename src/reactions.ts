// Turns agent events into office actions. Pure: the scene executes the actions in order.

import { isAgentEvent } from './events';
import type { AgentEvent } from './events';
import { ROSTER } from './roster';
import type { Agent, AgentId } from './types';
import type { PersonState } from './staff/states';

export type Action =
  | { kind: 'goto'; agent: AgentId; target: 'seat' | 'sentinel' | 'courier_window' | 'idle' }
  | { kind: 'state'; agent: AgentId; state: PersonState }
  | { kind: 'label'; agent: AgentId; text: string }
  | { kind: 'marker'; agent: AgentId; on: boolean }
  | { kind: 'steps_pulse' }
  | { kind: 'core_pulse' }
  | { kind: 'streak' };

export class Reactions {
  private readonly roster: ReadonlyMap<AgentId, Agent>;
  /** runId → agent, in start order. */
  private readonly runs = new Map<string, AgentId>();
  /** draftId → the agent that wrote it. */
  private readonly drafts = new Map<string, AgentId>();

  constructor(roster: readonly Agent[] = ROSTER) {
    this.roster = new Map(roster.map((a) => [a.id, a]));
  }

  /** The agent's most recently started run that has not finished. */
  activeRun(agent: AgentId): string | undefined {
    let found: string | undefined;
    for (const [runId, a] of this.runs) if (a === agent) found = runId;
    return found;
  }

  /** Actions for one event, in the order the scene should run them. Anything invalid or unknown gives []. */
  handle(e: unknown): Action[] {
    if (!isAgentEvent(e)) return [];
    switch (e.type) {
      case 'run_started':
        return this.runStarted(e);
      case 'progress': {
        if (this.parked(e.agent)) return [];
        const counter = e.done !== undefined && e.total !== undefined ? ` · ${e.done}/${e.total}` : '';
        return [{ kind: 'label', agent: e.agent, text: e.text + counter }];
      }
      case 'draft_submitted':
        if (this.parked(e.agent)) return [];
        this.drafts.set(e.draftId, e.agent);
        return [
          { kind: 'state', agent: e.agent, state: 'carrying' },
          { kind: 'goto', agent: e.agent, target: 'sentinel' },
          { kind: 'goto', agent: e.agent, target: 'seat' },
          { kind: 'state', agent: e.agent, state: 'typing' },
        ];
      case 'sentinel_result': {
        const author = this.drafts.get(e.draftId);
        if (e.pass || author === undefined || this.parked('sentinel')) return [];
        return [{ kind: 'label', agent: 'sentinel', text: `back to ${this.roster.get(author)?.name ?? author}` }];
      }
      case 'awaiting_approval':
        if (this.parked(e.agent)) return [];
        this.drafts.set(e.draftId, e.agent);
        return [{ kind: 'marker', agent: e.agent, on: true }];
      case 'approved': {
        const author = this.drafts.get(e.draftId);
        if (author === undefined) return [];
        return [{ kind: 'marker', agent: author, on: false }, { kind: 'steps_pulse' }, { kind: 'core_pulse' }];
      }
      case 'rejected': {
        const author = this.drafts.get(e.draftId);
        if (author === undefined) return [];
        this.drafts.delete(e.draftId);
        return [{ kind: 'marker', agent: author, on: false }];
      }
      case 'sent': {
        const author = this.drafts.get(e.draftId);
        if (author === undefined || this.parked('courier')) return [];
        this.drafts.delete(e.draftId);
        return [
          { kind: 'goto', agent: 'courier', target: 'courier_window' },
          { kind: 'state', agent: 'courier', state: 'typing' },
          { kind: 'streak' },
          { kind: 'state', agent: author, state: 'cheering' },
        ];
      }
      case 'run_finished':
        return this.runFinished(e);
    }
  }

  private parked(id: AgentId): boolean {
    return this.roster.get(id)?.parked ?? false;
  }

  private runStarted(e: Extract<AgentEvent, { type: 'run_started' }>): Action[] {
    if (this.parked(e.agent)) return [];
    const working = this.activeRun(e.agent) !== undefined;
    this.runs.set(e.runId, e.agent);
    const label: Action = { kind: 'label', agent: e.agent, text: e.task };
    if (working) return [label];
    return [
      { kind: 'goto', agent: e.agent, target: 'seat' },
      { kind: 'state', agent: e.agent, state: 'typing' },
      label,
    ];
  }

  private runFinished(e: Extract<AgentEvent, { type: 'run_finished' }>): Action[] {
    if (this.parked(e.agent)) return [];
    this.runs.delete(e.runId);
    if (this.activeRun(e.agent) !== undefined) {
      // Another run of theirs is still going: stay at the desk, but a failure always shows (spec §8).
      return e.status === 'failed' ? [{ kind: 'label', agent: e.agent, text: 'run failed' }] : [];
    }
    return [
      { kind: 'state', agent: e.agent, state: 'idle' },
      { kind: 'goto', agent: e.agent, target: 'idle' },
      { kind: 'label', agent: e.agent, text: e.status === 'failed' ? 'run failed' : '' },
    ];
  }
}
