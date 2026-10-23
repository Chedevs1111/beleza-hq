import type { AgentId } from './types';

export type DraftKind = 'email' | 'post' | 'comment' | 'linkedin' | 'proposal' | 'plan';
export type ApprovalMode = 'item' | 'plan' | 'whatsapp';
export type SendChannel = 'email' | 'instagram' | 'facebook' | 'linkedin' | 'whatsapp';

export type AgentEvent =
  | { type: 'run_started'; runId: string; agent: AgentId; task: string }
  | { type: 'progress'; runId: string; agent: AgentId; text: string; done?: number; total?: number }
  | { type: 'draft_submitted'; runId: string; agent: AgentId; draftId: string; kind: DraftKind; summary: string }
  | { type: 'sentinel_result'; draftId: string; pass: boolean; reasons: string[] }
  | { type: 'awaiting_approval'; draftId: string; agent: AgentId }
  | { type: 'approved'; draftId: string; mode: ApprovalMode }
  | { type: 'rejected'; draftId: string }
  | { type: 'sent'; draftId: string; channel: SendChannel }
  | { type: 'run_finished'; runId: string; agent: AgentId; status: 'ok' | 'failed'; costUsd: number };

const AGENT_IDS: readonly string[] = [
  'tempo', 'scout', 'echo', 'atlas', 'quill', 'linx', 'forge', 'muse',
  'lumen', 'pulse', 'sentinel', 'herald', 'courier', 'ledger', 'keeper',
] satisfies AgentId[];
const DRAFT_KINDS: readonly string[] = ['email', 'post', 'comment', 'linkedin', 'proposal', 'plan'] satisfies DraftKind[];
const APPROVAL_MODES: readonly string[] = ['item', 'plan', 'whatsapp'] satisfies ApprovalMode[];
const CHANNELS: readonly string[] = ['email', 'instagram', 'facebook', 'linkedin', 'whatsapp'] satisfies SendChannel[];

type Fields = Record<string, unknown>;

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isOptNum = (v: unknown): boolean => v === undefined || isNum(v);
const oneOf = (list: readonly string[]) => (v: unknown): boolean => isStr(v) && list.includes(v);

// Per event type: a check for every field except `type`.
const SHAPES: Record<AgentEvent['type'], Record<string, (v: unknown) => boolean>> = {
  run_started: { runId: isStr, agent: oneOf(AGENT_IDS), task: isStr },
  progress: { runId: isStr, agent: oneOf(AGENT_IDS), text: isStr, done: isOptNum, total: isOptNum },
  draft_submitted: { runId: isStr, agent: oneOf(AGENT_IDS), draftId: isStr, kind: oneOf(DRAFT_KINDS), summary: isStr },
  sentinel_result: {
    draftId: isStr,
    pass: (v) => typeof v === 'boolean',
    reasons: (v) => Array.isArray(v) && v.every(isStr),
  },
  awaiting_approval: { draftId: isStr, agent: oneOf(AGENT_IDS) },
  approved: { draftId: isStr, mode: oneOf(APPROVAL_MODES) },
  rejected: { draftId: isStr },
  sent: { draftId: isStr, channel: oneOf(CHANNELS) },
  run_finished: { runId: isStr, agent: oneOf(AGENT_IDS), status: oneOf(['ok', 'failed']), costUsd: isNum },
};

export function isAgentEvent(x: unknown): x is AgentEvent {
  if (typeof x !== 'object' || x === null) return false;
  const e = x as Fields;
  if (!isStr(e.type) || !Object.hasOwn(SHAPES, e.type)) return false;
  const shape = SHAPES[e.type as AgentEvent['type']];
  return Object.entries(shape).every(([key, check]) => check(e[key]));
}
