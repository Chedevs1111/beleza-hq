// One scripted Beleza day for the demo player (spec §3). Pure data, no three.js.
// Hours are Africa/Johannesburg, 24h. The demo clock starts at 06:00, so the day runs 06:30 to 18:12.
//
// Rules the script keeps (tests/demo.test.ts checks them):
// - every run_started has a run_finished, one run per agent at a time;
// - every draft is checked by Sentinel; the one that fails is redrafted under the same draftId and then passes;
// - every single-item approval is followed by a sent; a plan approval (Muse) is not, because it approves next
//   week's posts for their scheduled times;
// - an agent gets at least 0.05 demo hours between a walk-causing event and its next event.
//
// A draft makes its author walk to Sentinel and back. Across the floor that is about 25 s at 600 s a day
// (roughly one demo hour), so busy stretches (Quill 09:04-09:54) run ahead of the walking; the scene queues them.

import type { AgentEvent } from '../events';
import type { AgentId } from '../types';

export interface DemoStep {
  atHour: number;
  event: AgentEvent;
}

function s(hour: number, minute: number, event: AgentEvent): DemoStep {
  return { atHour: hour + minute / 60, event };
}

/** `count` progress steps every `every` minutes from `hour:minute`, labelled done/count. */
function counted(hour: number, minute: number, every: number, count: number, runId: string, agent: AgentId, text: string): DemoStep[] {
  return Array.from({ length: count }, (_, i) =>
    s(hour, minute + every * i, { type: 'progress', runId, agent, text, done: i + 1, total: count }),
  );
}

export const DEMO_DAY: DemoStep[] = [
  // 06:30 Tempo plans the day.
  s(6, 30, { type: 'run_started', runId: 'tempo-1', agent: 'tempo', task: 'Planning the day' }),
  s(6, 38, { type: 'progress', runId: 'tempo-1', agent: 'tempo', text: 'Counting approvals waiting' }),
  s(6, 46, { type: 'progress', runId: 'tempo-1', agent: 'tempo', text: 'Lining up follow-ups due today' }),
  s(6, 54, { type: 'progress', runId: 'tempo-1', agent: 'tempo', text: 'Day plan ready' }),
  s(6, 58, { type: 'run_finished', runId: 'tempo-1', agent: 'tempo', status: 'ok', costUsd: 0.04 }),

  // 07:30 Scout finds and grades 10 leads.
  s(7, 30, { type: 'run_started', runId: 'scout-1', agent: 'scout', task: 'Finding 10 new leads' }),
  ...counted(7, 34, 2, 10, 'scout-1', 'scout', 'Researching and grading leads'),
  s(7, 58, { type: 'run_finished', runId: 'scout-1', agent: 'scout', status: 'ok', costUsd: 0.18 }),

  // 08:00 Echo reads 6 replies and drafts 2 answers (short walk: Echo sits next to Sentinel).
  s(8, 0, { type: 'run_started', runId: 'echo-1', agent: 'echo', task: 'Reading the inbox' }),
  ...counted(8, 4, 2, 6, 'echo-1', 'echo', 'Classifying replies'),
  s(8, 20, { type: 'draft_submitted', runId: 'echo-1', agent: 'echo', draftId: 'echo-d1', kind: 'email', summary: 'Answer to a pricing question' }),
  s(8, 29, { type: 'sentinel_result', draftId: 'echo-d1', pass: true, reasons: [] }),
  s(8, 30, { type: 'awaiting_approval', draftId: 'echo-d1', agent: 'echo' }),

  // 08:30 Atlas runs 3 site audits on A-grade leads.
  s(8, 30, { type: 'run_started', runId: 'atlas-1', agent: 'atlas', task: 'Checking sites of A-grade leads' }),
  s(8, 38, { type: 'progress', runId: 'atlas-1', agent: 'atlas', text: 'Site audit', done: 1, total: 3 }),
  s(8, 40, { type: 'draft_submitted', runId: 'echo-1', agent: 'echo', draftId: 'echo-d2', kind: 'email', summary: 'Answer to a booking question' }),
  s(8, 48, { type: 'progress', runId: 'atlas-1', agent: 'atlas', text: 'Site audit', done: 2, total: 3 }),
  s(8, 49, { type: 'sentinel_result', draftId: 'echo-d2', pass: true, reasons: [] }),
  s(8, 50, { type: 'awaiting_approval', draftId: 'echo-d2', agent: 'echo' }),
  s(8, 58, { type: 'progress', runId: 'atlas-1', agent: 'atlas', text: 'Site audit', done: 3, total: 3 }),

  // 09:00 Quill writes 5 emails, Linx 3 connection notes. Sentinel sends one of Quill's back (q2), Quill redrafts it.
  s(9, 0, { type: 'run_started', runId: 'quill-1', agent: 'quill', task: 'Writing first emails' }),
  s(9, 0, { type: 'run_started', runId: 'linx-1', agent: 'linx', task: 'Writing connection notes' }),
  s(9, 4, { type: 'draft_submitted', runId: 'quill-1', agent: 'quill', draftId: 'quill-d1', kind: 'email', summary: 'First email: slow mobile page' }),
  s(9, 5, { type: 'run_finished', runId: 'echo-1', agent: 'echo', status: 'ok', costUsd: 0.09 }),
  s(9, 6, { type: 'run_finished', runId: 'atlas-1', agent: 'atlas', status: 'ok', costUsd: 0.2 }),
  s(9, 10, { type: 'sentinel_result', draftId: 'quill-d1', pass: true, reasons: [] }),
  s(9, 11, { type: 'awaiting_approval', draftId: 'quill-d1', agent: 'quill' }),
  s(9, 14, { type: 'draft_submitted', runId: 'quill-1', agent: 'quill', draftId: 'quill-d2', kind: 'email', summary: 'First email: missing booking button' }),
  s(9, 20, { type: 'sentinel_result', draftId: 'quill-d2', pass: false, reasons: ['No opt-out line', 'Claims a result we cannot back up'] }),
  s(9, 22, { type: 'draft_submitted', runId: 'linx-1', agent: 'linx', draftId: 'linx-d1', kind: 'linkedin', summary: 'Connection note: shared interest in local business' }),
  s(9, 24, { type: 'draft_submitted', runId: 'quill-1', agent: 'quill', draftId: 'quill-d3', kind: 'email', summary: 'First email: outdated opening hours' }),
  s(9, 28, { type: 'sentinel_result', draftId: 'linx-d1', pass: true, reasons: [] }),
  s(9, 29, { type: 'awaiting_approval', draftId: 'linx-d1', agent: 'linx' }),
  s(9, 30, { type: 'sentinel_result', draftId: 'quill-d3', pass: true, reasons: [] }),
  s(9, 31, { type: 'awaiting_approval', draftId: 'quill-d3', agent: 'quill' }),
  s(9, 34, { type: 'draft_submitted', runId: 'quill-1', agent: 'quill', draftId: 'quill-d4', kind: 'email', summary: 'First email: no mobile menu' }),
  s(9, 40, { type: 'sentinel_result', draftId: 'quill-d4', pass: true, reasons: [] }),
  s(9, 41, { type: 'awaiting_approval', draftId: 'quill-d4', agent: 'quill' }),
  s(9, 42, { type: 'draft_submitted', runId: 'linx-1', agent: 'linx', draftId: 'linx-d2', kind: 'linkedin', summary: 'Connection note: recent project mention' }),
  s(9, 44, { type: 'draft_submitted', runId: 'quill-1', agent: 'quill', draftId: 'quill-d2', kind: 'email', summary: 'Revised: opt-out added, claim removed' }),
  s(9, 48, { type: 'sentinel_result', draftId: 'linx-d2', pass: true, reasons: [] }),
  s(9, 49, { type: 'awaiting_approval', draftId: 'linx-d2', agent: 'linx' }),
  s(9, 50, { type: 'sentinel_result', draftId: 'quill-d2', pass: true, reasons: [] }),
  s(9, 51, { type: 'awaiting_approval', draftId: 'quill-d2', agent: 'quill' }),
  s(9, 54, { type: 'draft_submitted', runId: 'quill-1', agent: 'quill', draftId: 'quill-d5', kind: 'email', summary: 'First email: images too large' }),
  s(10, 0, { type: 'sentinel_result', draftId: 'quill-d5', pass: true, reasons: [] }),
  s(10, 1, { type: 'awaiting_approval', draftId: 'quill-d5', agent: 'quill' }),
  s(10, 2, { type: 'draft_submitted', runId: 'linx-1', agent: 'linx', draftId: 'linx-d3', kind: 'linkedin', summary: 'Connection note: event follow-up' }),
  s(10, 8, { type: 'sentinel_result', draftId: 'linx-d3', pass: true, reasons: [] }),
  s(10, 9, { type: 'awaiting_approval', draftId: 'linx-d3', agent: 'linx' }),
  s(10, 12, { type: 'run_finished', runId: 'quill-1', agent: 'quill', status: 'ok', costUsd: 0.31 }),
  s(10, 13, { type: 'run_finished', runId: 'linx-1', agent: 'linx', status: 'ok', costUsd: 0.12 }),

  // 10:15 Quill's 5 emails are approved one by one; Courier sends each (one run for the batch).
  s(10, 15, { type: 'approved', draftId: 'quill-d1', mode: 'item' }),
  s(10, 16, { type: 'run_started', runId: 'courier-1', agent: 'courier', task: 'Sending approved emails' }),
  s(10, 19, { type: 'approved', draftId: 'quill-d2', mode: 'item' }),
  s(10, 23, { type: 'approved', draftId: 'quill-d3', mode: 'item' }),
  s(10, 26, { type: 'sent', draftId: 'quill-d1', channel: 'email' }),
  s(10, 27, { type: 'approved', draftId: 'quill-d4', mode: 'item' }),
  s(10, 31, { type: 'approved', draftId: 'quill-d5', mode: 'item' }),
  s(10, 32, { type: 'sent', draftId: 'quill-d2', channel: 'email' }),
  s(10, 38, { type: 'sent', draftId: 'quill-d3', channel: 'email' }),
  s(10, 44, { type: 'sent', draftId: 'quill-d4', channel: 'email' }),
  s(10, 50, { type: 'sent', draftId: 'quill-d5', channel: 'email' }),
  s(10, 56, { type: 'run_finished', runId: 'courier-1', agent: 'courier', status: 'ok', costUsd: 0.02 }),

  // 11:00 The two inbox answers and the three LinkedIn notes are approved and sent (a second Courier run).
  s(11, 0, { type: 'approved', draftId: 'echo-d1', mode: 'item' }),
  s(11, 4, { type: 'approved', draftId: 'echo-d2', mode: 'item' }),
  s(11, 6, { type: 'run_started', runId: 'courier-2', agent: 'courier', task: 'Sending approved answers and notes' }),
  s(11, 8, { type: 'approved', draftId: 'linx-d1', mode: 'item' }),
  s(11, 12, { type: 'approved', draftId: 'linx-d2', mode: 'item' }),
  s(11, 16, { type: 'approved', draftId: 'linx-d3', mode: 'item' }),
  s(11, 18, { type: 'sent', draftId: 'echo-d1', channel: 'email' }),
  s(11, 24, { type: 'sent', draftId: 'echo-d2', channel: 'email' }),
  s(11, 30, { type: 'sent', draftId: 'linx-d1', channel: 'linkedin' }),
  s(11, 36, { type: 'sent', draftId: 'linx-d2', channel: 'linkedin' }),
  s(11, 42, { type: 'sent', draftId: 'linx-d3', channel: 'linkedin' }),
  s(11, 48, { type: 'run_finished', runId: 'courier-2', agent: 'courier', status: 'ok', costUsd: 0.02 }),

  // 13:00 Pulse drafts replies to new comments (the loft is far from Sentinel, so the two drafts are almost an hour apart).
  s(13, 0, { type: 'run_started', runId: 'pulse-1', agent: 'pulse', task: 'Replying to new comments' }),
  s(13, 8, { type: 'progress', runId: 'pulse-1', agent: 'pulse', text: 'Reading 2 new comments' }),
  s(13, 14, { type: 'draft_submitted', runId: 'pulse-1', agent: 'pulse', draftId: 'pulse-d1', kind: 'comment', summary: 'Reply to a comment on a recent post' }),
  s(13, 23, { type: 'sentinel_result', draftId: 'pulse-d1', pass: true, reasons: [] }),
  s(13, 24, { type: 'awaiting_approval', draftId: 'pulse-d1', agent: 'pulse' }),
  s(14, 10, { type: 'draft_submitted', runId: 'pulse-1', agent: 'pulse', draftId: 'pulse-d2', kind: 'comment', summary: 'Reply to a question in a direct message' }),
  s(14, 19, { type: 'sentinel_result', draftId: 'pulse-d2', pass: true, reasons: [] }),
  s(14, 20, { type: 'awaiting_approval', draftId: 'pulse-d2', agent: 'pulse' }),

  // 14:25 Approved from the phone over WhatsApp.
  s(14, 25, { type: 'approved', draftId: 'pulse-d1', mode: 'whatsapp' }),
  s(14, 27, { type: 'approved', draftId: 'pulse-d2', mode: 'whatsapp' }),
  s(14, 32, { type: 'run_started', runId: 'courier-3', agent: 'courier', task: 'Sending approved replies' }),
  s(14, 40, { type: 'sent', draftId: 'pulse-d1', channel: 'instagram' }),
  s(14, 46, { type: 'sent', draftId: 'pulse-d2', channel: 'facebook' }),
  s(14, 52, { type: 'run_finished', runId: 'courier-3', agent: 'courier', status: 'ok', costUsd: 0.01 }),

  // 15:00 Muse plans next week; the plan is approved as a plan (no send today), then Lumen makes the images.
  s(15, 0, { type: 'run_started', runId: 'muse-1', agent: 'muse', task: "Planning next week's content" }),
  s(15, 8, { type: 'progress', runId: 'muse-1', agent: 'muse', text: 'Instagram captions and hooks' }),
  s(15, 18, { type: 'progress', runId: 'muse-1', agent: 'muse', text: 'Facebook posts' }),
  s(15, 24, { type: 'run_finished', runId: 'pulse-1', agent: 'pulse', status: 'ok', costUsd: 0.14 }),
  s(15, 28, { type: 'progress', runId: 'muse-1', agent: 'muse', text: 'LinkedIn posts' }),
  s(15, 36, { type: 'draft_submitted', runId: 'muse-1', agent: 'muse', draftId: 'muse-plan1', kind: 'plan', summary: 'Next week: 3 Instagram, 2 Facebook and 2 LinkedIn posts with captions and image briefs' }),
  s(15, 45, { type: 'sentinel_result', draftId: 'muse-plan1', pass: true, reasons: [] }),
  s(15, 46, { type: 'awaiting_approval', draftId: 'muse-plan1', agent: 'muse' }),
  s(16, 30, { type: 'approved', draftId: 'muse-plan1', mode: 'plan' }),
  s(16, 35, { type: 'run_started', runId: 'lumen-1', agent: 'lumen', task: 'Making images for the approved plan' }),
  s(16, 50, { type: 'run_finished', runId: 'muse-1', agent: 'muse', status: 'ok', costUsd: 0.27 }),
  ...counted(16, 52, 16, 3, 'lumen-1', 'lumen', 'Image ready'),
  s(17, 36, { type: 'run_finished', runId: 'lumen-1', agent: 'lumen', status: 'ok', costUsd: 0.45 }),

  // 18:00 Herald sends the daily WhatsApp report.
  s(18, 0, { type: 'run_started', runId: 'herald-1', agent: 'herald', task: 'Sending the daily WhatsApp report' }),
  s(18, 6, { type: 'progress', runId: 'herald-1', agent: 'herald', text: 'Report sent: 12 sent, 1 plan approved, 0 waiting' }),
  s(18, 12, { type: 'run_finished', runId: 'herald-1', agent: 'herald', status: 'ok', costUsd: 0.03 }),
];
