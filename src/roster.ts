import type { Agent, AgentId, ZoneId } from './types';

/** Rocketbox avatar per agent; keys match public/assets/manifest.json `people`. */
const LOOK: Record<AgentId, string> = {
  tempo: 'business_female_01',
  scout: 'male_adult_10',
  echo: 'female_adult_15',
  atlas: 'business_male_03',
  quill: 'female_adult_01',
  linx: 'business_female_04',
  forge: 'male_adult_12',
  muse: 'female_adult_11',
  lumen: 'male_adult_08',
  pulse: 'male_adult_04',
  sentinel: 'business_male_01',
  herald: 'business_female_02',
  courier: 'business_male_06',
  ledger: 'business_female_03',
  keeper: 'business_male_05',
};

function agent(id: AgentId, zone: ZoneId, role: string, parkedReason?: string): Agent {
  return {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    role,
    zone,
    parked: parkedReason !== undefined,
    ...(parkedReason !== undefined && { parkedReason }),
    look: { model: LOOK[id] },
  };
}

export const ROSTER: readonly Agent[] = [
  agent('tempo', 'ops', "Plans Che's day: approvals waiting, follow-ups due, posts going out"),
  agent('scout', 'growth', 'Finds 10 new leads a day and grades them A, B or C'),
  agent('echo', 'ops', 'Reads the inbox, classifies replies, drafts answers, records opt-outs'),
  agent('atlas', 'client', 'Runs factual site checks on A-grade leads and the monthly own-site SEO and speed check'),
  agent('quill', 'growth', 'Writes first emails for A and B leads from the site findings'),
  agent('linx', 'growth', 'Writes LinkedIn connection notes and posts from the content plan'),
  agent('forge', 'growth', 'Builds a one-page summary or proposal when a lead says yes'),
  agent('muse', 'studio', "Plans next week's content for Instagram, Facebook and LinkedIn"),
  agent('lumen', 'studio', 'Makes the images and Reels for an approved plan'),
  agent('pulse', 'studio', 'Drafts replies to new comments and DMs'),
  agent('sentinel', 'ops', 'Checks every draft for POPIA, HPCSA, brand voice and invented claims'),
  agent('herald', 'ops', 'Sends the daily WhatsApp report and handles WhatsApp approvals'),
  agent('courier', 'ops', 'Sends exactly one approved item and rechecks do-not-contact'),
  agent('ledger', 'client', 'Monthly client reports', 'waiting for first client'),
  agent('keeper', 'client', 'Invoice reminders', 'waiting for invoices'),
];

export function agentById(id: AgentId): Agent {
  const found = ROSTER.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown agent: ${id}`);
  return found;
}

export function agentsInZone(z: ZoneId): Agent[] {
  return ROSTER.filter((a) => a.zone === z);
}
