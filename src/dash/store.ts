// The dashboard's data: drafts, agent status, spend and an activity log, fed by the same AgentEvent
// stream the office reacts to. Pure (no three.js, no DOM). `accept` is also the gate: it drops events that
// are duplicates or out of order and changes nothing for them.

import { isAgentEvent } from '../events';
import type { AgentEvent, ApprovalMode, DraftKind, SendChannel } from '../events';
import { ROSTER } from '../roster';
import type { Agent, AgentId } from '../types';

export type DraftStatus = 'checking' | 'returned' | 'waiting' | 'approved' | 'rejected' | 'sent';

export interface DraftRecord {
  id: string;
  agent: AgentId;
  runId: string;
  kind: DraftKind;
  summary: string;
  body: string;
  status: DraftStatus;
  /** Why Sentinel sent it back; empty otherwise. */
  reasons: string[];
  mode?: ApprovalMode;
  channel?: SendChannel;
  /** Demo hour of the last change. */
  at: number;
}

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'parked' | 'failed';

export interface ActivityEntry {
  at: number;
  agent: AgentId;
  text: string;
}

export interface DraftFilter {
  status?: DraftStatus;
  agent?: AgentId;
  kind?: DraftKind;
}

interface Progress {
  text: string;
  done?: number;
  total?: number;
}

const KIND_NOUN: Record<DraftKind, string> = {
  email: 'email',
  post: 'post',
  comment: 'comment',
  linkedin: 'LinkedIn note',
  proposal: 'proposal',
  plan: 'plan',
};

const CHANNEL_PHRASE: Record<SendChannel, string> = {
  email: 'by email',
  instagram: 'on Instagram',
  facebook: 'on Facebook',
  linkedin: 'on LinkedIn',
  whatsapp: 'on WhatsApp',
};

const MODE_SUFFIX: Record<ApprovalMode, string> = {
  item: '',
  whatsapp: ' from WhatsApp',
  plan: ' as a whole',
};

const withArticle = (noun: string): string => `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;

const copyDraft = (d: DraftRecord): DraftRecord => ({ ...d, reasons: [...d.reasons] });

export class DashStore {
  private readonly roster: ReadonlyMap<AgentId, Agent>;
  private readonly draftsById = new Map<string, DraftRecord>();
  /** Draft ids Sentinel has passed and that are still being checked. */
  private readonly passed = new Set<string>();
  /** Open runs, in start order. */
  private readonly runs = new Map<string, { agent: AgentId; task: string }>();
  /** Run ids that have ended, so a late or repeated event for one is not mistaken for a run we joined mid-way. */
  private readonly finishedRuns = new Set<string>();
  private readonly failed = new Set<AgentId>();
  private readonly progress = new Map<AgentId, Progress>();
  /** The latest accepted progress per agent; unlike `progress`, a run ending does not clear it. */
  private readonly lastProgress = new Map<AgentId, Progress>();
  private readonly spend = new Map<AgentId, number>();
  private log: ActivityEntry[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(roster: readonly Agent[] = ROSTER) {
    this.roster = new Map(roster.map((a) => [a.id, a]));
  }

  /** Applies one event. Returns false, changing nothing, if it is invalid, a duplicate or out of order. */
  accept(e: AgentEvent, at: number): boolean {
    if (!isAgentEvent(e)) return false;
    if ('agent' in e && this.roster.get(e.agent)?.parked) return false;
    if (!this.apply(e, at)) return false;
    this.notify();
    return true;
  }

  drafts(f: DraftFilter = {}): DraftRecord[] {
    return [...this.draftsById.values()]
      .filter((d) => (f.status === undefined || d.status === f.status)
        && (f.agent === undefined || d.agent === f.agent)
        && (f.kind === undefined || d.kind === f.kind))
      .map(copyDraft);
  }

  draft(id: string): DraftRecord | undefined {
    const d = this.draftsById.get(id);
    return d && copyDraft(d);
  }

  statusOf(a: AgentId): AgentStatus {
    if (this.roster.get(a)?.parked) return 'parked';
    if (this.failed.has(a)) return 'failed';
    for (const d of this.draftsById.values()) if (d.agent === a && d.status === 'waiting') return 'waiting';
    for (const run of this.runs.values()) if (run.agent === a) return 'working';
    return 'idle';
  }

  /** Whether the agent has a run that has started and not finished (a waiting draft does not close it). */
  hasOpenRun(a: AgentId): boolean {
    for (const run of this.runs.values()) if (run.agent === a) return true;
    return false;
  }

  progressOf(a: AgentId): Progress | undefined {
    const p = this.progress.get(a);
    return p && { ...p };
  }

  /** The agent's most recent accepted progress, kept after its run ends; the next accepted progress replaces it. */
  lastProgressOf(a: AgentId): Progress | undefined {
    const p = this.lastProgress.get(a);
    return p && { ...p };
  }

  spendToday(): Map<AgentId, number> {
    return new Map(this.spend);
  }

  activity(): readonly ActivityEntry[] {
    return [...this.log];
  }

  /** Lets the reviewer reword a draft that is waiting for approval. Notifies, but is not an event: no activity entry, `at` unchanged. */
  editBody(id: string, body: string): boolean {
    const d = this.draftsById.get(id);
    if (!d || d.status !== 'waiting') return false;
    d.body = body;
    this.notify();
    return true;
  }

  reset(): void {
    this.draftsById.clear();
    this.passed.clear();
    this.runs.clear();
    this.finishedRuns.clear();
    this.failed.clear();
    this.progress.clear();
    this.lastProgress.clear();
    this.spend.clear();
    this.log = [];
    this.notify();
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(): void {
    for (const cb of [...this.listeners]) {
      try {
        cb();
      } catch {
        // A broken subscriber must not stop the others or the event that triggered it.
      }
    }
  }

  private nameOf(a: AgentId): string {
    return this.roster.get(a)?.name ?? a;
  }

  private note(at: number, agent: AgentId, text: string): void {
    this.log.push({ at, agent, text });
  }

  private apply(e: AgentEvent, at: number): boolean {
    switch (e.type) {
      case 'run_started':
        this.runs.set(e.runId, { agent: e.agent, task: e.task });
        this.failed.delete(e.agent);
        this.progress.delete(e.agent);
        this.note(at, e.agent, `${this.nameOf(e.agent)} started: ${e.task}`);
        return true;

      case 'progress': {
        const run = this.runs.get(e.runId);
        if (run && run.agent !== e.agent) return false;
        if (!run) {
          // Not seen starting: a viewer that joined mid-run. Open it, unless it is already over.
          if (this.finishedRuns.has(e.runId)) return false;
          this.runs.set(e.runId, { agent: e.agent, task: e.text });
        }
        const p: Progress = { text: e.text };
        if (e.done !== undefined) p.done = e.done;
        if (e.total !== undefined) p.total = e.total;
        this.progress.set(e.agent, p);
        this.lastProgress.set(e.agent, { ...p });
        const counter = e.done !== undefined && e.total !== undefined ? ` (${e.done}/${e.total})` : '';
        this.note(at, e.agent, `${this.nameOf(e.agent)}: ${e.text}${counter}`);
        return true;
      }

      case 'draft_submitted': {
        const existing = this.draftsById.get(e.draftId);
        if (existing && existing.status !== 'returned') return false;
        this.draftsById.set(e.draftId, {
          id: e.draftId,
          agent: e.agent,
          runId: e.runId,
          kind: e.kind,
          summary: e.summary,
          body: demoBody(e.kind, e.summary, e.agent),
          status: 'checking',
          reasons: [],
          at,
        });
        this.passed.delete(e.draftId);
        const verb = existing ? 'redrafted' : 'submitted';
        this.note(at, e.agent, `${this.nameOf(e.agent)} ${verb} ${withArticle(KIND_NOUN[e.kind])}: ${e.summary}`);
        return true;
      }

      case 'sentinel_result': {
        const d = this.draftsById.get(e.draftId);
        if (!d || d.status !== 'checking') return false;
        const what = `${withArticle(KIND_NOUN[d.kind])} from ${this.nameOf(d.agent)}`;
        d.at = at;
        if (e.pass) {
          this.passed.add(d.id);
          this.note(at, 'sentinel', `${this.nameOf('sentinel')} passed ${what}`);
        } else {
          d.status = 'returned';
          d.reasons = [...e.reasons];
          this.passed.delete(d.id);
          const why = e.reasons.length > 0 ? `: ${e.reasons.join('; ')}` : '';
          this.note(at, 'sentinel', `${this.nameOf('sentinel')} sent back ${what}${why}`);
        }
        return true;
      }

      case 'awaiting_approval': {
        const d = this.draftsById.get(e.draftId);
        if (!d || d.status !== 'checking' || !this.passed.has(d.id)) return false;
        this.passed.delete(d.id);
        d.status = 'waiting';
        d.at = at;
        this.note(at, d.agent, `${this.nameOf(d.agent)}'s ${KIND_NOUN[d.kind]} is waiting for approval`);
        return true;
      }

      case 'approved': {
        const d = this.draftsById.get(e.draftId);
        if (!d || d.status !== 'waiting') return false;
        d.status = 'approved';
        d.mode = e.mode;
        d.at = at;
        this.note(at, d.agent, `Approved ${this.nameOf(d.agent)}'s ${KIND_NOUN[d.kind]}${MODE_SUFFIX[e.mode]}`);
        return true;
      }

      case 'rejected': {
        const d = this.draftsById.get(e.draftId);
        if (!d || d.status !== 'waiting') return false;
        d.status = 'rejected';
        d.at = at;
        this.note(at, d.agent, `Rejected ${this.nameOf(d.agent)}'s ${KIND_NOUN[d.kind]}`);
        return true;
      }

      case 'sent': {
        const d = this.draftsById.get(e.draftId);
        if (!d || d.status !== 'approved') return false;
        d.status = 'sent';
        d.channel = e.channel;
        d.at = at;
        this.note(
          at,
          'courier',
          `${this.nameOf('courier')} sent ${this.nameOf(d.agent)}'s ${KIND_NOUN[d.kind]} ${CHANNEL_PHRASE[e.channel]}`,
        );
        return true;
      }

      case 'run_finished': {
        const run = this.runs.get(e.runId);
        if (run && run.agent !== e.agent) return false;
        // Not seen starting (a viewer that joined mid-run): still count its cost and result, but touch no other run.
        if (!run && this.finishedRuns.has(e.runId)) return false;
        if (run) {
          this.runs.delete(e.runId);
          this.progress.delete(e.agent);
        }
        this.finishedRuns.add(e.runId);
        if (e.status === 'failed') this.failed.add(e.agent);
        this.spend.set(e.agent, (this.spend.get(e.agent) ?? 0) + e.costUsd);
        const verb = e.status === 'failed' ? 'failed' : 'finished';
        this.note(at, e.agent, `${this.nameOf(e.agent)} ${verb}${run ? `: ${run.task}` : ''}`);
        return true;
      }
    }
  }
}

const SIGN_OFF = 'Kind regards';

/** `Label: summary`, unless the summary already starts with the label (then it is the heading as it stands). */
const headed = (label: string, summary: string): string =>
  summary.toLowerCase().startsWith(label.toLowerCase()) ? summary : `${label}: ${summary}`;

/** A short generic draft text (heading plus two to four sentences) for demo mode. No real names or contact details. */
export function demoBody(kind: DraftKind, summary: string, agent: AgentId): string {
  switch (kind) {
    case 'email':
      return agent === 'echo'
        ? [
            `Subject: ${summary}`,
            '',
            'Hi there,',
            '',
            'Thanks for getting in touch. Here is a short answer to your question, and I am happy to go through it in more detail. Just let me know a time that suits you.',
            '',
            SIGN_OFF,
          ].join('\n')
        : [
            `Subject: ${summary}`,
            '',
            'Hi there,',
            '',
            'I took a quick look at your website and noticed one thing that may be costing you enquiries. It is a small fix and I can explain it in two minutes. Would you be open to a short chat this week?',
            '',
            SIGN_OFF,
            '',
            'Reply STOP if you would rather not hear from us again.',
          ].join('\n');
    case 'post':
      return [
        headed('Post idea', summary),
        '',
        'Small details add up to a better first impression. Here is one simple way to put that to work this week. Save this post for later and share it with someone who needs it.',
      ].join('\n');
    case 'comment':
      return [
        headed('Reply to', summary),
        '',
        'Thank you so much for the kind words. We are glad it was useful. Send us a message any time if you would like more detail.',
      ].join('\n');
    case 'linkedin':
      return [
        headed('Connection note', summary),
        '',
        'Hi, I came across your business and liked what you are building locally. I would be glad to connect and share ideas. No pressure either way.',
      ].join('\n');
    case 'proposal':
      return [
        headed('Proposal', summary),
        '',
        'Thank you for saying yes. This summary sets out what we will do, how long it takes and what you will see at the end. Please read it through and tell me what to change.',
      ].join('\n');
    case 'plan':
      return [
        headed('Plan', summary),
        '',
        "This plan covers next week's posts across Instagram, Facebook and LinkedIn. Each post comes with a caption and an image brief. Approving it schedules every post for its planned time.",
      ].join('\n');
  }
}
