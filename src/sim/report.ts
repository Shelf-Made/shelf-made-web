/**
 * The end-of-day report the night card shows: the money split by what it went on, why the day went
 * the way it did (the top complaints, each pointing at the card that fixes it), the crossroads'
 * shares, the active goal and what tomorrow brings. Pure: built from the closed day's stats.
 */
import type { GameState, DayStats, DayLogNotes, CardId } from './types';
import { productDef } from './products';
import { activeGoal, goalProgress } from './goals';
import { storeScheme, shopScheme } from './schemes';

export interface Complaint { text: string; count: number; card: Exclude<CardId, null | 'settings'> }
export interface ShareBar { id: string; name: string; colour: string; share: number; change: number | null; closed: boolean; mine: boolean }

export interface NightReport {
  day: number;
  profit: number;
  revenue: number;
  costs: { goods: number; rentPower: number; staff: number; other: number };
  cash: number;
  customers: number; served: number; walkedOut: number; turnedAway: number;
  complaints: Complaint[];
  shares: ShareBar[];
  goal: DayLogNotes['goal'];
  tomorrow: DayLogNotes['tomorrow'];
  /** The night just closed (Open tomorrow is the way on), or an earlier day read back from Stats. */
  latest: boolean;
}

/** Every complaint of the day in plain words, most frequent first. */
export function complaintsOf(d: DayStats): Complaint[] {
  const c = d.complaints;
  const out: Complaint[] = [];
  if (!c) return out;
  for (const [id, n] of Object.entries(c.outOfStock)) out.push({ text: `Out of ${productDef(id).name.toLowerCase()}`, count: n, card: 'stock' });
  for (const [id, n] of Object.entries(c.pricey)) out.push({ text: `${productDef(id).name} too pricey`, count: n, card: 'prices' });
  if (c.queue) out.push({ text: 'Waited too long', count: c.queue, card: 'staff' });
  if (c.lotFull) out.push({ text: 'Lot full', count: c.lotFull, card: 'build' });
  if (c.dirty) out.push({ text: 'Messy floor', count: c.dirty, card: 'staff' });
  return out.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
}

/** Today's share of the crossroads' shoppers for every store (closed ones greyed), with the change since yesterday. */
export function shareBars(state: GameState, d: DayStats, prev: DayStats | undefined): ShareBar[] {
  const sh = d.shoppers ?? {};
  const total = Object.values(sh).reduce((a, b) => a + b, 0) || 1;
  const prevTotal = prev?.shoppers ? Object.values(prev.shoppers).reduce((a, b) => a + b, 0) || 1 : 0;
  const bar = (id: string, name: string, colour: string, closed: boolean, mine: boolean): ShareBar => {
    const share = (sh[id] ?? 0) / total;
    const before = prev?.shoppers && prevTotal ? (prev.shoppers[id] ?? 0) / prevTotal : null;
    return { id, name, colour, share, change: before === null ? null : share - before, closed, mine };
  };
  const bars: ShareBar[] = [bar('player', state.shop.name, shopScheme(state).primary, false, true)];
  for (const r of state.rivals) {
    if (r.boughtDay !== undefined) {
      const f = state.franchises.find((x) => x.corner === r.corner);
      bars.push(bar(`corner-${r.corner}`, f?.name ?? state.shop.name, shopScheme(state).primary, false, true));
    } else bars.push(bar(r.id, r.name, storeScheme(state, r.id).primary, !r.open, false));
  }
  return bars;
}

/** The goal's progress and tomorrow's plan as the night card shows them tonight (kept with the day's stats at close). */
export function nightNotes(state: GameState): DayLogNotes {
  const g = activeGoal(state);
  const p = g ? goalProgress(state, g) : null;
  const t = state.tomorrow;
  return {
    goal: g && p ? { title: g.title, frac: p.frac, delta: p.frac - state.goals.dayStart, text: p.text, reward: g.rewardText } : null,
    tomorrow: t ? { weather: t.weather, festival: t.festival, rumours: [...t.rumours], sky: t.sky } : null,
  };
}

/**
 * The night card for a closed day: the last one by default, or any earlier day by number (its log in
 * Stats). Earlier days show the goal and forecast as they stood that night; saves from before those
 * were kept leave them out.
 */
export function nightReport(state: GameState, day?: number): NightReport | null {
  const at = day === undefined ? state.history.length - 1 : state.history.findIndex((h) => h.day === day);
  const d = state.history[at];
  if (!d) return null;
  const prev = state.history[at - 1];
  const latest = at === state.history.length - 1 && state.phase === 'night';
  const notes = d.log ?? (latest ? nightNotes(state) : { goal: null, tomorrow: null });
  return {
    day: d.day, profit: d.profit, revenue: d.revenue, cash: latest ? state.cash : d.endCash,
    costs: { goods: d.cogs, rentPower: d.rent + d.utilities, staff: d.wages + d.tax, other: Math.round((d.theft + d.loans * 0.3) * 100) / 100 },
    customers: d.customers, served: d.served, walkedOut: d.walkedOut, turnedAway: d.turnedAway,
    complaints: complaintsOf(d).slice(0, latest ? 3 : 5),
    shares: shareBars(state, d, prev),
    goal: notes.goal, tomorrow: notes.tomorrow, latest,
  };
}
