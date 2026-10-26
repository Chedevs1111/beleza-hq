// The weekly recap: the numbers (pure, tested) and the 1080 x 1080 card that shows them (drawn on a canvas in the
// Beleza palette). Everything is counted in the browser and nothing is sent anywhere. "Hide client names" removes every
// draft summary from the card: `recapLines` is the exact list of text the canvas draws, so that is what the tests check.
import { ROSTER } from '../roster';
import type { AgentId } from '../types';
import { dayNumber, formatMinutes, timeSaved } from './insights';
import type { ApprovalCounts } from './insights';
import type { DashStore } from './store';

export interface RecapData {
  /** Drafts approved by a person (still waiting to send, or sent). */
  approved: number;
  denied: number;
  sent: number;
  busiestAgent?: AgentId;
  /** The ISO day with the most approvals (the latest on a tie). */
  busiestDay?: string;
  minutesSaved: number;
  /** Summaries of the most recent sent drafts. The only client-facing text; `hideClients` drops it. */
  highlights: string[];
}

export interface RecapOptions {
  hideClients: boolean;
}

const HIGHLIGHT_COUNT = 3;

export function recapData(store: DashStore, counts: ApprovalCounts): RecapData {
  const drafts = store.drafts();
  const approvedBy = new Map<AgentId, number>();
  let approved = 0;
  let denied = 0;
  let sent = 0;
  for (const d of drafts) {
    if (d.status === 'rejected') denied += 1;
    if (d.status === 'approved' || d.status === 'sent') {
      approved += 1;
      approvedBy.set(d.agent, (approvedBy.get(d.agent) ?? 0) + 1);
    }
    if (d.status === 'sent') sent += 1;
  }

  const data: RecapData = { approved, denied, sent, minutesSaved: timeSaved(store).minutes, highlights: [] };

  // Busiest agent: most approved drafts; the earlier roster agent on a tie.
  let best = 0;
  for (const a of ROSTER) {
    const n = approvedBy.get(a.id) ?? 0;
    if (n > best) {
      best = n;
      data.busiestAgent = a.id;
    }
  }

  // Busiest day: the highest approval count; the latest on a tie. Junk days and counts are ignored.
  let top: { num: number; iso: string; n: number } | undefined;
  for (const [iso, n] of Object.entries(counts)) {
    const num = dayNumber(iso);
    if (num === undefined || !Number.isFinite(n) || n <= 0) continue;
    if (!top || n > top.n || (n === top.n && num > top.num)) top = { num, iso, n };
  }
  if (top) data.busiestDay = top.iso;

  data.highlights = drafts
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.status === 'sent')
    .sort((a, b) => b.d.at - a.d.at || b.i - a.i)
    .slice(0, HIGHLIGHT_COUNT)
    .map(({ d }) => d.summary);

  return data;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-10-26 -> "Mon 26 Oct". Empty for anything that is not a real date. */
export function dayLabel(iso: string): string {
  const n = dayNumber(iso);
  if (n === undefined) return '';
  const d = new Date(n * 86_400_000);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const nameOf = (a: AgentId): string => ROSTER.find((r) => r.id === a)?.name ?? a;

interface Card {
  brand: string;
  title: string;
  sub: string;
  hero: { value: string; label: string };
  stats: { value: string; label: string }[];
  notes: string[];
  highlightsTitle?: string;
  highlights: string[];
  footer: string;
}

function card(data: RecapData, opts: RecapOptions): Card {
  const notes: string[] = [];
  if (data.busiestAgent) notes.push(`Busiest teammate: ${nameOf(data.busiestAgent)}`);
  const day = data.busiestDay ? dayLabel(data.busiestDay) : '';
  if (day) notes.push(`Busiest day: ${day}`);
  if (opts.hideClients) notes.push('Client names hidden');
  const shown = opts.hideClients ? [] : data.highlights.filter((s) => s.trim().length > 0);
  return {
    brand: 'Beleza HQ',
    title: 'My week with the team',
    sub: data.approved === 0 ? 'A quiet week so far' : 'Approved work, counted and wrapped up',
    hero: { value: formatMinutes(data.minutesSaved), label: 'saved by the team' },
    stats: [
      { value: String(data.approved), label: 'approved' },
      { value: String(data.sent), label: 'sent' },
      { value: String(data.denied), label: 'denied' },
    ],
    notes,
    ...(shown.length > 0 && { highlightsTitle: 'Sent this week' }),
    highlights: shown,
    footer: 'Counted in your browser, never sent anywhere. Demo data.',
  };
}

/** Every line of text the card draws, top to bottom. With `hideClients` there is no draft summary in it. */
export function recapLines(data: RecapData, opts: RecapOptions): string[] {
  const c = card(data, opts);
  return [
    c.brand, c.title, c.sub, c.hero.value, c.hero.label,
    ...c.stats.flatMap((s) => [s.value, s.label]),
    ...c.notes,
    ...(c.highlightsTitle ? [c.highlightsTitle] : []),
    ...c.highlights,
    c.footer,
  ];
}

export const RECAP_SIZE = 1080;
export const RECAP_FILENAME = 'beleza-weekly-recap.png';

const DISPLAY = "'Fraunces', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif";
const UI = "'Space Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif";
const INK = '#f4ecff';
const MUTED = 'rgba(244, 236, 255, 0.62)';
const GOLD = '#e9c26b';
const AMETHYST = '#8b5cf6';

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws the recap card, 1080 x 1080, onto `canvas`. Draws nothing (and does not throw) where 2D drawing is missing. */
export function drawRecap(canvas: HTMLCanvasElement, data: RecapData, opts: RecapOptions): void {
  canvas.width = RECAP_SIZE;
  canvas.height = RECAP_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const c = card(data, opts);
  const S = RECAP_SIZE;
  const pad = 88;

  // Aubergine ground with an amethyst glow and a gold hairline frame.
  const bg = ctx.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, '#0b0810');
  bg.addColorStop(1, '#2a1b3d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);
  const glow = ctx.createRadialGradient(S * 0.82, S * 0.12, 20, S * 0.82, S * 0.12, S * 0.7);
  glow.addColorStop(0, 'rgba(139, 92, 246, 0.42)');
  glow.addColorStop(1, 'rgba(139, 92, 246, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(233, 194, 107, 0.35)';
  ctx.lineWidth = 2;
  roundRect(ctx, 28, 28, S - 56, S - 56, 36);
  ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // The mark: an amethyst tile with the "b" glyph, then the name.
  const markY = pad - 6;
  const tile = ctx.createLinearGradient(pad, markY, pad + 84, markY + 84);
  tile.addColorStop(0, '#a78bfa');
  tile.addColorStop(1, '#6d28d9');
  ctx.fillStyle = tile;
  roundRect(ctx, pad, markY, 84, 84, 24);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.font = `600 66px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.fillText('b', pad + 42, markY + 63);
  ctx.textAlign = 'left';
  ctx.fillStyle = GOLD;
  ctx.font = `600 34px ${DISPLAY}`;
  ctx.fillText(c.brand, pad + 108, markY + 55);

  // Title and line under it.
  ctx.fillStyle = INK;
  ctx.font = `600 68px ${DISPLAY}`;
  ctx.fillText(fit(ctx, c.title, S - pad * 2), pad, 270);
  ctx.fillStyle = MUTED;
  ctx.font = `500 28px ${UI}`;
  ctx.fillText(fit(ctx, c.sub, S - pad * 2), pad, 322);

  // The hero number.
  ctx.fillStyle = GOLD;
  ctx.font = `600 150px ${DISPLAY}`;
  ctx.fillText(fit(ctx, c.hero.value, S - pad * 2), pad, 500);
  ctx.fillStyle = INK;
  ctx.font = `500 34px ${UI}`;
  ctx.fillText(c.hero.label, pad, 556);

  // Three stat tiles.
  const gap = 24;
  const tileW = (S - pad * 2 - gap * 2) / 3;
  const tileY = 612;
  c.stats.forEach((s, i) => {
    const x = pad + i * (tileW + gap);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    roundRect(ctx, x, tileY, tileW, 150, 28);
    ctx.fill();
    ctx.strokeStyle = 'rgba(244, 236, 255, 0.16)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = `600 68px ${DISPLAY}`;
    ctx.fillText(s.value, x + 28, tileY + 82);
    ctx.fillStyle = MUTED;
    ctx.font = `500 26px ${UI}`;
    ctx.fillText(s.label, x + 28, tileY + 124);
  });

  // Notes, then what was sent (only when client names are shown).
  let y = 836;
  ctx.fillStyle = INK;
  ctx.font = `500 30px ${UI}`;
  for (const n of c.notes) {
    ctx.fillText(fit(ctx, n, S - pad * 2), pad, y);
    y += 44;
  }
  if (c.highlightsTitle) {
    y += 6;
    ctx.fillStyle = GOLD;
    ctx.font = `600 22px ${UI}`;
    ctx.fillText(c.highlightsTitle.toUpperCase(), pad, y);
    y += 38;
    ctx.fillStyle = INK;
    ctx.font = `400 27px ${UI}`;
    for (const line of c.highlights) {
      ctx.fillText(fit(ctx, line, S - pad * 2), pad, y);
      y += 38;
    }
  }

  // Footer.
  ctx.fillStyle = MUTED;
  ctx.font = `500 22px ${UI}`;
  ctx.fillText(fit(ctx, c.footer, S - pad * 2), pad, S - 60);
}
