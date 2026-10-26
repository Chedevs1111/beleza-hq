// Pure row builders for the Approvals, Leads, Content and Inbox pages: store and sample data in, plain rows out.
// No DOM. The pages turn these into elements with `h`.
import type { DraftKind } from '../events';
import { ROSTER } from '../roster';
import type { AgentId } from '../types';
import type { DashStore, DraftStatus } from './store';
import type { Grade, InboxClass, InboxMessage, Lead, LeadStatus, ScheduleItem } from './sample';

export const KIND_LABEL: Record<DraftKind, string> = {
  email: 'Email',
  post: 'Post',
  comment: 'Comment',
  linkedin: 'LinkedIn note',
  proposal: 'Proposal',
  plan: 'Plan',
};

export const STATUS_LABEL: Record<DraftStatus, string> = {
  checking: 'Being checked',
  returned: 'Sent back',
  waiting: 'Waiting for you',
  approved: 'Approved',
  rejected: 'Rejected',
  sent: 'Sent',
};

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New',
  checked: 'Site checked',
  emailed: 'Emailed',
  replied: 'Replied',
  'do-not-contact': 'Do not contact',
};

export const CLASS_LABEL: Record<InboxClass, string> = {
  yes: 'Yes',
  question: 'Question',
  'not-now': 'Not now',
  'opt-out': 'Opt-out',
};

const DRAFT_LABEL: Record<DraftStatus, string> = {
  checking: 'Reply being checked',
  returned: 'Reply sent back to redraft',
  waiting: 'Reply waiting for you',
  approved: 'Reply approved',
  rejected: 'Reply rejected',
  sent: 'Reply sent',
};

const nameOf = (a: AgentId): string => ROSTER.find((r) => r.id === a)?.name ?? a;

/** A demo hour (06:00 round past 24:00) as HH:MM. */
export function hourLabel(hour: number): string {
  const total = ((Math.round(hour * 60) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Newest first; a later arrival wins a tie. */
function newestFirst<T extends { at: number }>(list: T[]): T[] {
  return list
    .map((item, i) => ({ item, i }))
    .sort((a, b) => b.item.at - a.item.at || b.i - a.i)
    .map((x) => x.item);
}

// ---- Approvals

export interface ApprovalRow {
  id: string;
  agent: AgentId;
  agentName: string;
  kind: DraftKind;
  kindLabel: string;
  summary: string;
  body: string;
  /** What Sentinel found; a waiting draft has normally passed. */
  sentinel: string;
  at: number;
  time: string;
  plan: boolean;
}

export function approvalRows(store: DashStore): ApprovalRow[] {
  return newestFirst(store.drafts({ status: 'waiting' })).map((d) => ({
    id: d.id,
    agent: d.agent,
    agentName: nameOf(d.agent),
    kind: d.kind,
    kindLabel: KIND_LABEL[d.kind],
    summary: d.summary,
    body: d.body,
    sentinel: d.reasons.length > 0 ? `Sentinel flagged: ${d.reasons.join('; ')}` : "Passed Sentinel's check",
    at: d.at,
    time: hourLabel(d.at),
    plan: d.kind === 'plan',
  }));
}

// ---- Leads

export interface LeadRow extends Lead {
  statusLabel: string;
  agentName: string;
}

const GRADE_ORDER: Record<Grade, number> = { A: 0, B: 1, C: 2 };

/** A before B before C, the given order within a grade; `grade` keeps just that grade. */
export function leadRows(leads: readonly Lead[], grade?: Grade): LeadRow[] {
  return leads
    .filter((l) => grade === undefined || l.grade === grade)
    .map((l, i) => ({ l, i }))
    .sort((a, b) => GRADE_ORDER[a.l.grade] - GRADE_ORDER[b.l.grade] || a.i - b.i)
    .map(({ l }) => ({ ...l, statusLabel: LEAD_STATUS_LABEL[l.status], agentName: nameOf(l.agent) }));
}

// ---- Content

export interface ContentDraft {
  id: string;
  agent: AgentId;
  agentName: string;
  kind: DraftKind;
  kindLabel: string;
  summary: string;
  status: DraftStatus;
  statusLabel: string;
  at: number;
  time: string;
}

export interface ContentItems {
  week: ScheduleItem[];
  drafts: ContentDraft[];
}

const CONTENT_KINDS: readonly DraftKind[] = ['post', 'linkedin', 'comment'];

/** Muse's week (only for Muse or no filter) and the post, LinkedIn and comment drafts, newest first; `agent` narrows both. */
export function contentItems(store: DashStore, schedule: readonly ScheduleItem[], agent?: string): ContentItems {
  const drafts = newestFirst(store.drafts().filter((d) => CONTENT_KINDS.includes(d.kind) && (agent === undefined || d.agent === agent)));
  return {
    week: agent === undefined || agent === 'muse' ? [...schedule] : [],
    drafts: drafts.map((d) => ({
      id: d.id,
      agent: d.agent,
      agentName: nameOf(d.agent),
      kind: d.kind,
      kindLabel: KIND_LABEL[d.kind],
      summary: d.summary,
      status: d.status,
      statusLabel: STATUS_LABEL[d.status],
      at: d.at,
      time: hourLabel(d.at),
    })),
  };
}

// ---- Inbox

export interface InboxRow extends InboxMessage {
  clsLabel: string;
  /** The linked draft's status, when it is in the store. */
  draftStatus?: DraftStatus;
  draftLabel?: string;
}

export function inboxRows(inbox: readonly InboxMessage[], store: DashStore): InboxRow[] {
  return inbox.map((m) => {
    const row: InboxRow = { ...m, clsLabel: CLASS_LABEL[m.cls] };
    const d = m.draftId !== undefined ? store.draft(m.draftId) : undefined;
    if (d) {
      row.draftStatus = d.status;
      row.draftLabel = DRAFT_LABEL[d.status];
    }
    return row;
  });
}
