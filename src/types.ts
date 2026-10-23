export type AgentId =
  | 'tempo' | 'scout' | 'echo' | 'atlas' | 'quill'
  | 'linx' | 'forge' | 'muse' | 'lumen' | 'pulse'
  | 'sentinel' | 'herald' | 'courier' | 'ledger' | 'keeper';

export type ZoneId = 'growth' | 'studio' | 'ops' | 'client';

export interface Agent {
  id: AgentId;
  name: string;
  role: string;
  zone: ZoneId;
  parked: boolean;
  parkedReason?: string;
  look: { model: string };
}
