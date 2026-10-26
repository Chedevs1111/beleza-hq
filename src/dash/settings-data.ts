// What the Settings page lists: timetables, connections, rules and approval modes (spec §3, §5). Plain data plus the one
// shared answer to "why can't this agent run right now?", used by Settings and the command bar. No DOM.
import type { Agent, AgentId } from '../types';
import type { StepId } from './onboarding';
import type { DashStore } from './store';

/** When each agent works (spec §3). */
export const SCHEDULES: Record<AgentId, string> = {
  tempo: 'Daily 06:30',
  scout: 'Mon–Fri 07:30',
  echo: 'Daily 08:00',
  atlas: 'Mon–Fri 08:30 · monthly site check',
  quill: 'Mon–Fri 09:00',
  linx: 'Mon–Fri 09:00',
  forge: 'On each yes reply',
  muse: 'Mon 07:00',
  lumen: 'After a plan is approved',
  pulse: '09:00, 13:00, 17:00',
  sentinel: 'Every draft',
  herald: 'Daily 18:00',
  courier: 'Per approved item',
  ledger: 'Parked — waiting for first client',
  keeper: 'Parked — waiting for invoices',
};

export const NOT_CONNECTED = 'Not connected — stage 3';

/** The outside services the team will use once they are connected (stage 3). */
export const CONNECTIONS: { name: string; used: string; /** The onboarding step that sets it up, when there is one. */ step?: StepId }[] = [
  { name: 'Afrihost mail', used: 'Used by Echo and Courier', step: 'email' },
  { name: 'Composio Instagram / Facebook / LinkedIn', used: 'Used by Linx, Pulse and Courier', step: 'socials' },
  { name: 'Higgsfield', used: 'Used by Lumen' },
  { name: 'WhatsApp via Sent.dm / Meta', used: 'Used by Herald', step: 'whatsapp' },
  { name: 'Anthropic API', used: 'Used by all bots' },
  { name: 'Website (belezamedia.com)', used: 'Used by Atlas and Echo: contact-form enquiries become leads, a monthly speed and SEO check, and visit stats', step: 'website' },
];

/** What Sentinel checks on every draft (spec §3). Read-only. */
export const BRAND_RULES: string[] = [
  'POPIA: one ask per message, a clear way to opt out, and nobody on the do-not-contact list is ever contacted.',
  'HPCSA: messages to health clients keep to the council’s advertising rules.',
  'Brand voice: warm, plain and specific, in the Beleza style.',
  'No invented claims: every fact comes from the business’s own published details.',
  'A draft that fails a check goes back to its author to be redrafted.',
  'Do-not-contact entries are never deleted.',
];

export interface ApprovalMode {
  name: string;
  note: string;
  /** Not built yet; shown with a "Stage 4" chip. */
  later?: string;
}

export const APPROVAL_MODES: ApprovalMode[] = [
  { name: 'Per item', note: 'Approve each email, post or reply on its own.' },
  { name: 'Plan', note: 'Approve a whole week of content at once.' },
  { name: 'WhatsApp', note: 'Approve from the daily WhatsApp report.', later: 'Stage 4' },
];

/** What Settings says after Pause: the demo's scripted day is not gated by it. */
export const PAUSE_NOTE = 'Run now is blocked while paused. In the demo the scripted day still plays; real timetables pause from stage 3.';

export const DICTATION_NOTE = 'Speech is sent to Google for recognition (POPIA).';

export type NotRunnable = 'Parked' | 'Paused' | 'Already working';

/**
 * Why "Run now" would do nothing for this agent, or undefined when it would run. Parked first, then paused, then
 * already working. `paused` is read live, so toggling a pause changes the answer at once.
 */
export function whyNotRunnable(
  agent: AgentId,
  ctx: { store: DashStore; roster: readonly Agent[]; paused: ReadonlySet<AgentId> },
): NotRunnable | undefined {
  if (ctx.roster.find((a) => a.id === agent)?.parked) return 'Parked';
  if (ctx.paused.has(agent)) return 'Paused';
  if (ctx.store.hasOpenRun(agent)) return 'Already working';
  return undefined;
}

/** One sentence for the reason, shared by Settings and the command bar. */
export function reasonText(name: string, reason: NotRunnable, parkedReason?: string): string {
  switch (reason) {
    case 'Parked': return `${name} is parked${parkedReason ? `: ${parkedReason}` : ''}.`;
    case 'Paused': return `${name} is paused.`;
    case 'Already working': return `${name} is already working.`;
  }
}
