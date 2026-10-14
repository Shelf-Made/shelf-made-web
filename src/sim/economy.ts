import type { GameState, Order } from './types';
import { PLOTS, FIXTURES, DIFFICULTY, CLOSE_TIME } from './layout';
import { productDef } from './products';
import { emptyDayStats } from './newGame';
import { popup, cue, withRng } from './state';
import { spawnDeliveryTruck } from './cars';
import { doorOutside } from './people';

export interface Supplier { id: string; name: string; priceMul: number; minOrder: number; etaSeconds: number; blurb: string }
export const SUPPLIERS: Supplier[] = [
  { id: 'local', name: 'Valley Wholesale', priceMul: 1.0, minOrder: 0, etaSeconds: 90, blurb: 'Fair prices, delivers within the hour and a half.' },
  { id: 'bulk', name: 'BigBox Supply', priceMul: 0.88, minOrder: 150, etaSeconds: 180, blurb: 'Cheaper by the pallet; $150 minimum, slower truck.' },
  { id: 'express', name: 'Dash Deliveries', priceMul: 1.15, minOrder: 0, etaSeconds: 40, blurb: 'Pricey but at your back door in forty minutes.' },
];

export function supplier(id: string): Supplier { return SUPPLIERS.find((s) => s.id === id) ?? SUPPLIERS[0]!; }

export function unitCost(productId: string, supplierId: string): number {
  return Math.round(productDef(productId).cost * supplier(supplierId).priceMul * 100) / 100;
}

export function placeOrder(state: GameState, supplierId: string, lines: { productId: string; qty: number }[]): Order | string {
  const sup = supplier(supplierId);
  const clean = lines.filter((l) => l.qty > 0).map((l) => ({ productId: l.productId, qty: Math.floor(l.qty), unitCost: unitCost(l.productId, sup.id) }));
  if (clean.length === 0) return 'Nothing to order.';
  const total = Math.round(clean.reduce((a, l) => a + l.qty * l.unitCost, 0) * 100) / 100;
  if (total < sup.minOrder) return `${sup.name} needs a $${sup.minOrder} minimum.`;
  if (total > state.cash) return `Not enough cash ($${total.toFixed(2)}).`;
  const units = clean.reduce((a, l) => a + l.qty, 0);
  const inStorage = state.shop.storage.reduce((a, s) => a + s.qty, 0);
  if (inStorage + units > state.shop.storageCapacity) return `Storeroom only has room for ${state.shop.storageCapacity - inStorage} more units.`;
  state.cash -= total;
  state.today.cogs += 0; // stock is an asset; cost is recognised when sold
  const order: Order = { id: state.nextId++, supplierId: sup.id, lines: clean, total, placedDay: state.day, placedTime: state.time, eta: sup.etaSeconds, state: 'pending' };
  state.orders.push(order);
  cue(state, 'order');
  if (!state.tutorial.completed.includes('order')) {
    // Reward handled by completeTutorial via people.ts to keep one code path.
  }
  return order;
}

export function tickOrders(state: GameState, dt: number): void {
  for (const o of state.orders) {
    if (o.state !== 'pending') continue;
    o.eta -= dt;
    if (o.eta <= 0) { o.state = 'arriving'; spawnDeliveryTruck(state, o); }
  }
  if (state.orders.length > 30) state.orders = state.orders.filter((o) => o.state !== 'delivered').concat(state.orders.filter((o) => o.state === 'delivered').slice(-10));
}

export function dailyRent(state: GameState): number {
  const plot = PLOTS.find((p) => p.id === state.shop.plotId) ?? PLOTS[0]!;
  return Math.round(plot.rent * DIFFICULTY[state.difficulty].rentMul);
}

export function dailyUtilities(state: GameState): number {
  return state.shop.fixtures.reduce((a, f) => a + FIXTURES[f.type].upkeep, 0) + 4;
}

export function dailyWages(state: GameState): number {
  return state.people.filter((p) => p.kind === 'staff').reduce((a, p) => a + (p.wage ?? 0), 0);
}

/** Close the books for the day. Called once when the last customer has left. */
export function closeDay(state: GameState): void {
  const t = state.today;
  t.rent = dailyRent(state);
  t.utilities = dailyUtilities(state);
  t.wages = dailyWages(state);
  const bills = t.rent + t.utilities + t.wages;
  state.cash -= bills;
  t.profit = Math.round((t.revenue - t.cogs - bills) * 100) / 100;
  t.endCash = state.cash;
  t.satisfaction = t.satisfactionN ? t.satisfaction / t.satisfactionN : 0.5;
  // Reputation drifts toward today's satisfaction; awareness grows with served customers.
  const shop = state.shop;
  shop.reputation += Math.max(-0.03, Math.min(0.03, (t.satisfaction - shop.reputation) * 0.3));
  shop.awareness = Math.min(1, shop.awareness + 0.02 + t.served * 0.002);
  state.history.push({ ...t });
  state.phase = 'night';
  cue(state, 'night');
}

/** Start the next day: spoilage, fresh stats, doors open. */
export function openTomorrow(state: GameState): void {
  if (state.phase !== 'night') return;
  state.day++;
  state.time = 0;
  state.today = emptyDayStats(state.day);
  state.phase = 'open';
  // Spoilage: shelf and storage entries past their life are thrown out.
  let spoiled = 0;
  for (const f of state.shop.fixtures) for (const s of f.slots) {
    if (!s.productId || s.qty === 0) continue;
    const def = productDef(s.productId);
    if (def.shelfLife > 0 && withRng(state, 'spoil', (r) => r.chance(1 / (def.shelfLife + 1)))) { const lose = Math.ceil(s.qty * 0.25); s.qty -= lose; spoiled += lose; }
  }
  state.shop.storage = state.shop.storage.filter((e) => {
    const def = productDef(e.productId);
    if (def.shelfLife > 0 && state.day - e.day > def.shelfLife) { spoiled += e.qty; return false; }
    return true;
  });
  if (spoiled > 0) popup(state, doorOutside(state), `${spoiled} items spoiled`, 'bad', 1.4);
  if (!state.tutorial.completed.includes('openTomorrow') && state.day === 2) {
    // completed via commands (keeps reward logic in one place)
  }
  cue(state, 'open');
}

export function isClosingTime(state: GameState): boolean { return state.time >= CLOSE_TIME; }
