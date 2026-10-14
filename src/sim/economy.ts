import type { GameState, Order } from './types';
import { PLOTS, FIXTURES, DIFFICULTY, CLOSE_TIME } from './layout';
import { productDef } from './products';
import { emptyDayStats } from './newGame';
import { popup, cue, withRng } from './state';
import { spawnDeliveryTruck } from './cars';
import { doorOutside } from './people';
import { rivalDay } from './rivals';
import { computeScores } from './customers';
import { marketDay, inShortage } from './market';
import { closingCharges, checkFailState, addBill, PAYROLL_TAX } from './money';
import { staffNight, autoOrder, managerPrices, wageFor } from './staff';
import { applyUnlocks } from './progression';
import { marketingDay } from './marketing';
import { franchiseDay } from './franchise';

export interface Supplier { id: string; name: string; priceMul: number; minOrder: number; etaSeconds: number; blurb: string; /** Days until the invoice is due (0 = pay now). */ terms: number }
export const SUPPLIERS: Supplier[] = [
  { id: 'local', name: 'Town Wholesale', priceMul: 1.0, minOrder: 0, etaSeconds: 90, blurb: 'Fair prices, delivers within the hour and a half. Pay on order.', terms: 0 },
  { id: 'bulk', name: 'BigBox Supply', priceMul: 0.88, minOrder: 150, etaSeconds: 180, blurb: 'Cheaper by the pallet; $150 minimum, slower truck, invoice due in 3 days.', terms: 3 },
  { id: 'express', name: 'Dash Deliveries', priceMul: 1.15, minOrder: 0, etaSeconds: 40, blurb: 'Pricey but at your back door in forty minutes. Pay on order.', terms: 0 },
];

export function supplier(id: string): Supplier { return SUPPLIERS.find((s) => s.id === id) ?? SUPPLIERS[0]!; }

export function unitCost(productId: string, supplierId: string, state?: GameState): number {
  const def = productDef(productId);
  const market = state ? state.market.priceMul[def.category] : 1;
  return Math.round(def.cost * supplier(supplierId).priceMul * market * 100) / 100;
}

export function placeOrder(state: GameState, supplierId: string, lines: { productId: string; qty: number }[]): Order | string {
  const sup = supplier(supplierId);
  const shortLines = lines.filter((l) => l.qty > 0 && inShortage(state, l.productId));
  const clean = lines.filter((l) => l.qty > 0 && !inShortage(state, l.productId)).map((l) => ({ productId: l.productId, qty: Math.floor(l.qty), unitCost: unitCost(l.productId, sup.id, state) }));
  if (clean.length === 0) return shortLines.length ? `${productDef(shortLines[0]!.productId).name} is in shortage: no supplier has it this week.` : 'Nothing to order.';
  for (const l of shortLines) state.notices.push({ day: state.day, text: `${productDef(l.productId).name} left off the order: in shortage this week.`, kind: 'event' });
  const total = Math.round(clean.reduce((a, l) => a + l.qty * l.unitCost, 0) * 100) / 100;
  if (total < sup.minOrder) return `${sup.name} needs a $${sup.minOrder} minimum.`;
  const onTerms = sup.terms > 0;
  if (!onTerms && total > state.cash) return `Not enough cash ($${total.toFixed(2)}).`;
  const units = clean.reduce((a, l) => a + l.qty, 0);
  const inStorage = state.shop.storage.reduce((a, s) => a + s.qty, 0);
  if (inStorage + units > state.shop.storageCapacity) return `The pallet only has room for ${state.shop.storageCapacity - inStorage} more units.`;
  if (onTerms) addBill(state, `${sup.name} invoice`, total, sup.terms);
  else state.cash -= total;
  state.today.cogs += 0; // stock is an asset; cost is recognised when sold
  // While the shop is still being fitted out the truck is quick, so the first five minutes keep moving.
  const eta = state.phase === 'setup' ? Math.min(sup.etaSeconds, 20) : sup.etaSeconds;
  const order: Order = { id: state.nextId++, supplierId: sup.id, lines: clean, total, placedDay: state.day, placedTime: state.time, eta, state: 'pending' };
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
  return state.people.filter((p) => p.kind === 'staff').reduce((a, p) => a + wageFor(p), 0);
}

/** Close the books for the day. Called once when the last customer has left. */
export function closeDay(state: GameState): void {
  const t = state.today;
  t.rent = dailyRent(state);
  t.utilities = dailyUtilities(state);
  t.wages = dailyWages(state);
  t.tax = Math.round(t.wages * PAYROLL_TAX * 100) / 100;
  const bills = t.rent + t.utilities + t.wages + t.tax;
  state.cash -= bills;
  const extra = closingCharges(state);
  t.loans = extra.loans; t.bills = extra.bills; t.theft = extra.theft;
  t.profit = Math.round((t.revenue - t.cogs - bills - extra.theft - extra.loans * 0.3) * 100) / 100;
  checkFailState(state);
  t.endCash = state.cash;
  t.satisfaction = t.satisfactionN ? t.satisfaction / t.satisfactionN : 0.5;
  // Reputation drifts toward today's satisfaction; awareness grows with served customers.
  const shop = state.shop;
  shop.reputation += Math.max(-0.03, Math.min(0.03, (t.satisfaction - shop.reputation) * 0.3));
  shop.awareness = Math.min(1, shop.awareness + 0.02 + t.served * 0.002);
  state.scores.last = computeScores(state);
  staffNight(state);
  franchiseDay(state);
  // The owner tidies up overnight.
  state.shop.litter = [];
  state.shop.cleanliness = Math.min(1, state.shop.cleanliness + 0.35);
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
  // Yesterday's waits fade; rivals make their moves.
  state.scores.waitSum *= 0.4; state.scores.waitSamples = Math.max(1, Math.floor(state.scores.waitSamples * 0.4));
  state.scores.avgWait = state.scores.waitSamples ? state.scores.waitSum / state.scores.waitSamples : 20;
  if (state.notices.length > 40) state.notices.splice(0, state.notices.length - 40);
  rivalDay(state);
  marketDay(state);
  applyUnlocks(state);
  marketingDay(state);
  dailyAutomation(state);
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

/** Orderers and managers act at opening time. */
export function dailyAutomation(state: GameState): void {
  const staff = state.people.filter((p) => p.kind === 'staff');
  const manager = staff.find((p) => p.role === 'manager');
  const orderer = staff.find((p) => p.role === 'orderer');
  if (manager) { autoOrder(state, state.rules, state.rules.spendCap); managerPrices(state, state.rules); }
  else if (orderer) autoOrder(state, { ...state.rules, reorderPoint: 0.8 }, Math.min(state.rules.spendCap, state.cash * 0.5));
}
