/**
 * The goal ladder: what to aim for after the first week. One goal is active at a time; each has a
 * plain target, a progress bar and a reward (cash, an unlock or a cosmetic). Goals that can complete
 * mid-day are checked as the day runs; the rest at close.
 */
import type { GameState, DayStats } from './types';
import { popup, cue } from './state';
import { doorOutside } from './people';
import { SHOP_SIZES } from './layout';
import { dollars } from './money';

export interface GoalDef {
  id: string;
  title: string;
  /** The target in plain words. */
  target: string;
  reward: { cash?: number; unlock?: 'signLit' | 'openingEvent' | 'franchises'; ending?: boolean };
  /** The reward in plain words. */
  rewardText: string;
  /** 'now': can complete mid-day (checked every second); 'night': only at close. */
  when: 'now' | 'night';
}

/** A third of the crossroads' shoppers: with three rivals, that makes you the busiest store on almost any week. */
export const SHARE_TARGET = 1 / 3;
export const SHARE_DAYS = 7;
export const CHEAPO_DAYS = 3;
export const GROCER_NET = 120;

export const GOALS: GoalDef[] = [
  { id: 'doors', title: 'Open your doors', target: 'Serve 30 customers in one day', reward: { cash: 100 }, rewardText: '$100', when: 'now' },
  { id: 'regulars', title: 'Regulars', target: 'Reach 60% reputation', reward: { unlock: 'signLit' }, rewardText: 'Lit sign letters', when: 'night' },
  { id: 'cheapo', title: 'Beat the discounter', target: 'Out-sell Cheapo 3 days running', reward: { cash: 250 }, rewardText: '$250', when: 'night' },
  { id: 'grocer', title: 'Neighbourhood grocer', target: 'Move up to the 7×7 shop and net $120 in a day', reward: { unlock: 'openingEvent' }, rewardText: 'Opening-day events (bunting and a crowd)', when: 'night' },
  { id: 'busiest', title: 'Busiest corner', target: 'A third of the crossroads\' shoppers over a week', reward: { cash: 500 }, rewardText: '$500', when: 'night' },
  { id: 'hall', title: 'Market hall', target: 'Move up to the 9×8 market hall with a doubled lot', reward: { unlock: 'franchises' }, rewardText: 'Branches out of town', when: 'now' },
  { id: 'own', title: 'Own the crossroads', target: "Buy a closed rival's corner", reward: { ending: true }, rewardText: 'Crossroads Champion', when: 'now' },
];

export function activeGoal(state: GameState): GoalDef | null { return GOALS[state.goals.index] ?? null; }
export function goalDef(id: string): GoalDef | undefined { return GOALS.find((g) => g.id === id); }

const sizeRank = (id: string) => Math.max(0, SHOP_SIZES.findIndex((s) => s.id === id));

/** The player's shoppers (their own shop plus any corners they bought) and everyone's at the crossroads in a closed day. */
export function crossroadsCount(d: DayStats | undefined): [number, number] | null {
  const sh = d?.shoppers;
  if (!sh) return null;
  let mine = 0, all = 0;
  for (const [k, n] of Object.entries(sh)) { all += n; if (k === 'player' || k.startsWith('corner-')) mine += n; }
  return all > 0 ? [mine, all] : null;
}

/** The player's part of the crossroads in a closed day, 0..1. */
export function playerShareOf(d: DayStats | undefined): number | null {
  const c = crossroadsCount(d);
  return c ? c[0] / c[1] : null;
}

/**
 * The player's share of the crossroads over the last week: the last seven closes on which at least two rivals
 * were trading (the quiet first days do not count). Null until there are seven such days.
 */
export function weekShare(state: GameState): { share: number; days: number } | null {
  let mine = 0, all = 0, days = 0;
  for (let i = state.history.length - 1; i >= 0 && days < SHARE_DAYS; i--) {
    const d = state.history[i]!;
    const rivals = Object.keys(d.shoppers ?? {}).filter((k) => k !== 'player' && !k.startsWith('corner-')).length;
    const c = crossroadsCount(d);
    if (!c || rivals < 2) continue;
    mine += c[0]; all += c[1]; days++;
  }
  return all > 0 ? { share: mine / all, days } : null;
}

/** Cheapo's sales against yours today: out-sold if they are closed or yours are higher. Null before Cheapo opens. */
function outSoldCheapo(state: GameState): boolean | null {
  const c = state.rivals.find((r) => r.id === 'discount');
  if (!c || c.closedDay !== undefined) return true;
  if (!c.open) return null;
  return state.today.revenue > (c.lastSales ?? 0);
}

/** Progress toward a goal, 0..1, and a short line saying where you stand. */
export function goalProgress(state: GameState, g: GoalDef): { frac: number; text: string } {
  const t = state.today, run = state.goals.run;
  switch (g.id) {
    case 'doors': return { frac: Math.min(1, t.served / 30), text: `${Math.min(30, t.served)} of 30 served today` };
    case 'regulars': return { frac: Math.min(1, state.shop.reputation / 0.6), text: `Reputation ${Math.round(state.shop.reputation * 100)}% of 60%` };
    case 'cheapo': {
      const c = state.rivals.find((r) => r.id === 'discount');
      if (c && !c.open && c.closedDay === undefined) return { frac: 0, text: `Cheapo opens on day ${c.opensDay}` };
      return { frac: Math.min(1, run / CHEAPO_DAYS), text: `${run} of ${CHEAPO_DAYS} days ahead of Cheapo${c?.lastSales !== undefined && c.open ? ` (they took ${dollars(c.lastSales)} last night)` : ''}` };
    }
    case 'grocer': {
      if (sizeRank(state.shop.sizeId) < 1) return { frac: Math.min(0.5, (state.cash / (SHOP_SIZES[1]!.cost)) * 0.5), text: `Move up to the 7×7 shop (${dollars(SHOP_SIZES[1]!.cost)}, Build card)` };
      const best = Math.max(0, ...state.history.filter((d) => d.day >= state.goals.since).map((d) => d.profit), state.phase === 'night' ? t.profit : 0);
      return { frac: 0.5 + 0.5 * Math.min(1, best / GROCER_NET), text: `Best day since: ${dollars(best)} of ${dollars(GROCER_NET)}` };
    }
    case 'busiest': {
      const w = weekShare(state);
      if (!w) return { frac: 0, text: 'Your share shows once two rivals are trading' };
      const full = w.days >= SHARE_DAYS;
      return { frac: Math.min(full ? 1 : 0.95, w.share / SHARE_TARGET), text: `${Math.round(w.share * 100)}% of the crossroads over the last ${w.days} day${w.days === 1 ? '' : 's'} (a third over a week)` };
    }
    case 'hall': {
      const big = state.shop.sizeId === 'large', lot = state.shop.lotRows >= 2;
      return { frac: (big ? 0.5 : sizeRank(state.shop.sizeId) * 0.25) + (lot ? 0.5 : 0), text: big && !lot ? 'Now double the lot (Build card)' : !big && lot ? 'Now the 9×8 market hall (Build card)' : big && lot ? 'Done' : 'The 9×8 market hall and a doubled lot (Build card)' };
    }
    case 'own': {
      const bought = state.rivals.some((r) => r.boughtDay !== undefined);
      const fs = state.rivals.find((r) => r.closedDay !== undefined && r.boughtDay === undefined);
      return { frac: bought ? 1 : fs ? 0.5 : 0, text: bought ? 'Done' : fs ? `${fs.name}'s corner is for sale (Build card)` : 'Out-trade a rival until it closes, then buy its corner' };
    }
  }
  return { frac: 0, text: '' };
}

function met(state: GameState, g: GoalDef): boolean {
  switch (g.id) {
    case 'doors': return state.today.served >= 30;
    case 'regulars': return state.shop.reputation >= 0.6 - 1e-9;
    case 'cheapo': return state.goals.run >= CHEAPO_DAYS;
    case 'grocer': return sizeRank(state.shop.sizeId) >= 1 && state.phase === 'night' && state.today.profit >= GROCER_NET;
    case 'busiest': { const w = weekShare(state); return !!w && w.days >= SHARE_DAYS && w.share >= SHARE_TARGET; }
    case 'hall': return state.shop.sizeId === 'large' && state.shop.lotRows >= 2;
    case 'own': return state.rivals.some((r) => r.boughtDay !== undefined);
  }
  return false;
}

/** At close, before the check: the active goal's daily test (out-selling Cheapo). */
export function trackGoals(state: GameState): void {
  const g = activeGoal(state);
  if (!g) return;
  if (g.id === 'cheapo') { const o = outSoldCheapo(state); state.goals.run = o === null ? 0 : o ? state.goals.run + 1 : 0; }
}

/** Check the active goal (and the next, and the next, if they are already met). */
export function checkGoals(state: GameState, when: 'now' | 'night'): void {
  for (let guard = 0; guard < GOALS.length; guard++) {
    const g = activeGoal(state);
    if (!g || (g.when === 'night' && when === 'now') || !met(state, g)) return;
    complete(state, g);
  }
}

function complete(state: GameState, g: GoalDef): void {
  const gs = state.goals;
  gs.done.push({ id: g.id, day: state.day });
  gs.index++; gs.run = 0; gs.since = state.day;
  gs.dayStart = 0;
  gs.celebrate = { id: g.id, tick: state.tick };
  if (g.reward.cash) state.cash += g.reward.cash;
  if (g.reward.unlock && !gs.unlocked.includes(g.reward.unlock)) gs.unlocked.push(g.reward.unlock);
  if (g.reward.ending) { gs.champion = true; state.sandbox = true; }
  const next = activeGoal(state);
  popup(state, doorOutside(state), `Goal: ${g.title}! ${g.reward.cash ? dollars(g.reward.cash, true) : g.rewardText}`, 'money', 2.6);
  state.notices.push({ day: state.day, text: `Goal reached: ${g.title}. Reward: ${g.rewardText}.${next ? ` Next: ${next.title} (${next.target.toLowerCase()}).` : ''}`, kind: 'info' });
  cue(state, 'reward');
  // A goal met as soon as it is active starts from where things stand.
  if (next) gs.dayStart = goalProgress(state, next).frac;
}

/** When the day opens: remember where the active goal stood, for the night card's "today". */
export function goalsMorning(state: GameState): void {
  const g = activeGoal(state);
  state.goals.dayStart = g ? goalProgress(state, g).frac : 1;
}

/**
 * Old saves: tick off what the history shows was already done, in order, stopping at the first goal it
 * cannot tell (out-selling Cheapo was never recorded).
 */
export function inferGoals(state: GameState): void {
  const gs = state.goals;
  const can: Record<string, () => boolean> = {
    doors: () => state.history.some((d) => d.served >= 30),
    regulars: () => state.shop.reputation >= 0.6,
  };
  while (gs.index < GOALS.length) {
    const g = GOALS[gs.index]!;
    const ok = can[g.id];
    if (!ok || !ok()) break;
    gs.done.push({ id: g.id, day: state.day });
    if (g.reward.unlock) gs.unlocked.push(g.reward.unlock);
    gs.index++;
  }
  gs.since = state.day;
  // Branches already open stay open.
  if (state.franchises.length && !gs.unlocked.includes('franchises')) gs.unlocked.push('franchises');
}
