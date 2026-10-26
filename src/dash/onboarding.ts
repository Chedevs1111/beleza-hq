// The onboarding wizard's model: the steps, what each one says about privacy, and the state of each connection.
// Pure data and functions, no DOM. No step ever asks for a password, token or key: the email password goes into the
// Anthropic vault (typed by the owner there) and the social networks sign in on their own pages, so a step has only
// the fields below. Real linking arrives with the private server (stage 3); until then `live` is false everywhere.

export type StepId = 'welcome' | 'email' | 'socials' | 'website' | 'whatsapp' | 'review';

export interface Step {
  id: StepId;
  title: string;
  /** What to have ready before connecting. */
  needs: string[];
  /** Plain words on who sees what. */
  privacy: string;
}

export const STEPS: readonly Step[] = [
  {
    id: 'welcome',
    title: 'Welcome to Beleza HQ',
    needs: [],
    privacy: 'Beleza HQ never asks for a password, token or API key on any screen. Secrets are typed where they belong, never here.',
  },
  {
    id: 'email',
    title: 'Email',
    needs: ['The info@belezamedia.com mailbox', 'Your Anthropic vault, to store the mailbox password'],
    privacy: 'info@belezamedia.com (Afrihost IMAP/SMTP). You type the mailbox password into the Anthropic vault yourself; Beleza HQ never sees it.',
  },
  {
    id: 'socials',
    title: 'Social networks',
    needs: ['Instagram', 'Facebook', 'LinkedIn'],
    privacy: "Instagram, Facebook and LinkedIn through Composio. You sign in on each network's own page.",
  },
  {
    id: 'website',
    title: 'Website',
    needs: ['belezamedia.com', 'Cloudflare Web Analytics on the site'],
    privacy: 'belezamedia.com: contact-form enquiries become leads, a monthly speed and SEO check, and visit stats (Cloudflare Web Analytics).',
  },
  {
    id: 'whatsapp',
    title: 'WhatsApp',
    needs: ['A WhatsApp sender for Herald'],
    privacy: "Herald's daily report and WhatsApp approvals (stage 4).",
  },
  {
    id: 'review',
    title: 'Review',
    needs: [],
    privacy: 'Nothing is connected until you finish each step on its own page. You can come back any time from Settings.',
  },
];

/** The steps that link something outside. Welcome and review only talk about them. */
export const CONNECT_STEPS: readonly StepId[] = ['email', 'socials', 'website', 'whatsapp'];

const IDS: readonly StepId[] = STEPS.map((s) => s.id);

export function isStepId(x: unknown): x is StepId {
  return typeof x === 'string' && (IDS as readonly string[]).includes(x);
}

export const stepIndex = (id: StepId): number => IDS.indexOf(id);
export const nextStep = (id: StepId): StepId | undefined => IDS[stepIndex(id) + 1];
export const prevStep = (id: StepId): StepId | undefined => IDS[stepIndex(id) - 1];

export type ConnState = 'not-connected' | 'needs-server' | 'connected' | 'error';

export const STATE_LABEL: Record<ConnState, string> = {
  'not-connected': 'Not connected',
  'needs-server': 'Needs the private server',
  connected: 'Connected',
  error: 'Needs attention',
};

/** Why Connect and Test connection are switched off on the public demo. */
export const DEMO_NOTE = 'Available once the private Beleza HQ server is set up (stage 3)';

export interface OnboardingEnv {
  /** True only when the private server is answering. False on the public demo, so every connect step needs it. */
  live: boolean;
  /** What the server reports for each step; read only when `live`. */
  connections: Partial<Record<StepId, ConnState>>;
}

/** The state of one step. Steps that connect nothing (welcome, review) are always not-connected. */
export function stepState(step: StepId, env: OnboardingEnv): ConnState {
  if (!CONNECT_STEPS.includes(step)) return 'not-connected';
  if (!env.live) return 'needs-server';
  return env.connections[step] ?? 'not-connected';
}

/** The Review list: every connection with its state. */
export function connectionRows(env: OnboardingEnv): { id: StepId; title: string; state: ConnState }[] {
  return CONNECT_STEPS.map((id) => ({ id, title: STEPS[stepIndex(id)].title, state: stepState(id, env) }));
}

/** The wizard opens by itself on a first visit to the bare address; a deep link is never redirected. */
export function shouldOpenWelcome(hash: string, alreadyOnboarded: boolean): boolean {
  return !alreadyOnboarded && (hash === '' || hash === '#' || hash === '#/');
}
