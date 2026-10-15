import { tickLife } from './life';
import { tickReviews } from './reviews';
import type { GameState } from './types';
import { TICK, DAY_SECONDS, DIFFICULTY } from './layout';
import { tickCars, spawnTraffic } from './cars';
import { tickPeople, spawnCustomer, spawnWalker, plotOf, pruneTills } from './people';
import { tickOrders, closeDay, isClosingTime } from './economy';
import { withRng } from './state';
import { expectedByType, townGrowth } from './customers';
import { tickRivalSpawns } from './rivalShoppers';
import { checkGoals } from './goals';
import type { CustomerType } from './types';

/** Customers per day the shop can expect, before the time-of-day curve. */
export function expectedCustomers(state: GameState): number {
  const by = expectedByType(state);
  return (by.bargain + by.convenience + by.loyalist + by.impulse) * DIFFICULTY[state.difficulty].demandMul * townGrowth(state.day);
}

/** Pick a customer type in proportion to today's expected arrivals. */
export function pickType(state: GameState): CustomerType {
  const by = expectedByType(state);
  const types = Object.keys(by) as CustomerType[];
  const total = types.reduce((a, t) => a + by[t], 0) || 1;
  return withRng(state, 'customers', (r) => {
    let x = r.next() * total;
    for (const t of types) { x -= by[t]; if (x <= 0) return t; }
    return 'convenience';
  });
}

/** Busy at lunch and after work. Integrates to roughly 1 over the day. */
export function dayCurve(time: number): number {
  const h = time / 60; // 0..12 → 8am..8pm
  const lunch = Math.exp(-((h - 4.5) ** 2) / 2.2);
  const evening = Math.exp(-((h - 9.5) ** 2) / 2.8);
  return 0.55 + 0.8 * lunch + 0.9 * evening;
}

/** Advance the simulation by one fixed step. */
export function tick(state: GameState): void {
  state.tick++;
  if (state.phase === 'picking' || state.phase === 'night' || state.phase === 'setup') {
    // The world keeps breathing: traffic and walkers; during setup deliveries still arrive and you can work.
    ambient(state, state.phase === 'night' ? 0.4 : 1);
    if (state.phase === 'setup') tickOrders(state, TICK);
    tickCars(state);
    tickPeople(state);
    trimPopups(state);
    return;
  }
  state.time += TICK;
  if (state.phase === 'open') {
    const perSecond = (expectedCustomers(state) / DAY_SECONDS) * dayCurve(state.time) * 1.15;
    state.spawn.customer += perSecond * TICK;
    if (state.spawn.customer >= 1) {
      state.spawn.customer -= 1;
      spawnCustomer(state);
    } else if (withRng(state, 'customers', (r) => r.chance(perSecond * TICK * 0.35))) {
      spawnCustomer(state);
    }
    tickRivalSpawns(state, dayCurve(state.time));
    if (isClosingTime(state)) state.phase = 'closing';
  }
  ambient(state, 1);
  tickOrders(state, TICK);
  tickCars(state);
  tickPeople(state);
  tickLife(state);
  tickReviews(state);
  if (state.phase === 'closing') {
    const customersLeft = state.people.some((p) => p.kind === 'customer');
    if (!customersLeft || state.time > DAY_SECONDS + 120) {
      for (const p of state.people) if (p.kind === 'customer') p.state = 'gone';
      state.people = state.people.filter((p) => p.state !== 'gone');
      pruneTills(state);
      closeDay(state);
    }
  }
  // Goals that can be met mid-day (thirty served, the market hall, a corner bought), once a second.
  if (state.tick % 20 === 0) checkGoals(state, 'now');
  trimPopups(state);
}

function ambient(state: GameState, scale: number): void {
  const plot = plotOf(state);
  state.spawn.traffic += TICK * 0.09 * plot.traffic * scale;
  if (state.spawn.traffic >= 1) { state.spawn.traffic -= 1; spawnTraffic(state); }
  state.spawn.walker += TICK * 0.05 * scale;
  if (state.spawn.walker >= 1) { state.spawn.walker -= 1; spawnWalker(state); }
}

function trimPopups(state: GameState): void {
  const maxAge = 2.2 / TICK;
  if (state.popups.length && state.tick - state.popups[0]!.tick > maxAge) state.popups = state.popups.filter((p) => state.tick - p.tick <= maxAge);
}
