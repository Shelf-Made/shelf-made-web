import type { GameState, Order, DayPlan } from './types';
import { managerSavedOrders } from './savedOrders';
import { PLOTS, FIXTURES, DIFFICULTY, CLOSE_TIME, storageCap, storageUsed } from './layout';
import { PRODUCTS, productDef, inSeason, holidayName, holidayOn, sizeOf, HOLIDAY_DAYS, type Holiday } from './products';
import { emptyDayStats } from './newGame';
import { popup, cue, withRng } from './state';
import { spawnDeliveryTruck, deliverOrder } from './cars';
import { BAY_ETA } from './frontage';
import { doorOutside } from './people';
import { rivalDay, rivalsNight, planRivals } from './rivals';
import { computeScores, priceIndex, playerShare } from './customers';
import { marketDay, inShortage } from './market';
import { closingCharges, checkFailState, addBill, PAYROLL_TAX, formatMoney, dollars } from './money';
import { staffNight, autoOrder, managerPrices, wageToday } from './staff';
import { reviewsNight, ratingPull } from './reviews';
import { applyUnlocks } from './progression';
import { marketingDay, planEvents } from './marketing';
import { trackGoals, checkGoals, goalsMorning } from './goals';
import { franchiseDay } from './franchise';
import { nightNotes } from './report';
import { skyFor, forecastFor } from './weather';
import { sweepTown } from './life';

export interface Supplier { id: string; name: string; priceMul: number; minOrder: number; etaSeconds: number; blurb: string; /** Days until the invoice is due (0 = pay now). */ terms: number }
export const SUPPLIERS: Supplier[] = [
  { id: 'local', name: 'Town Wholesale', priceMul: 1.0, minOrder: 0, etaSeconds: 90, blurb: 'Fair prices, delivers within the hour and a half. Pay on order.', terms: 0 },
  { id: 'bulk', name: 'BigBox Supply', priceMul: 0.88, minOrder: 150, etaSeconds: 180, blurb: 'Cheaper by the pallet; $150 minimum, slower truck, invoice due in 3 days.', terms: 3 },
  { id: 'express', name: 'Dash Deliveries', priceMul: 1.15, minOrder: 0, etaSeconds: 40, blurb: 'Pricey but at your back door in forty minutes. Pay on order.', terms: 0 },
];

export function supplier(id: string): Supplier { return SUPPLIERS.find((s) => s.id === id) ?? SUPPLIERS[0]!; }

export function unitCost(productId: string, supplierId: string, state?: GameState): number {
  const def = productDef(productId);
  const market = state ? state.market.priceMul[def.category] ?? 1 : 1;
  return Math.round(def.cost * supplier(supplierId).priceMul * market * 100) / 100;
}

/** Instant delivery: straight onto the pallet, no truck to wait for, for this much more. */
export const INSTANT_MUL = 1.25;

export function placeOrder(state: GameState, supplierId: string, lines: { productId: string; qty: number }[], instant = false): Order | string {
  const sup = supplier(supplierId);
  // A holiday's goods out of their time are left off like a shortage, so one line never stops the rest
  // (a saved order made at Easter, say, still brings its bread afterwards).
  const offSeason = lines.filter((l) => l.qty > 0 && !inSeason(productDef(l.productId), state.day));
  const shortLines = lines.filter((l) => l.qty > 0 && !offSeason.includes(l) && inShortage(state, l.productId));
  const clean = lines.filter((l) => l.qty > 0 && !offSeason.includes(l) && !inShortage(state, l.productId)).map((l) => ({ productId: l.productId, qty: Math.floor(l.qty), unitCost: Math.round(unitCost(l.productId, sup.id, state) * (instant ? INSTANT_MUL : 1) * 100) / 100 }));
  const holiday = (pid: string) => holidayName(productDef(pid).season!);
  if (clean.length === 0) return offSeason.length ? `${productDef(offSeason[0]!.productId).name} is only sold around ${holiday(offSeason[0]!.productId)}.` : shortLines.length ? `${productDef(shortLines[0]!.productId).name} is in shortage: no supplier has it this week.` : 'Nothing to order.';
  const total = Math.round(clean.reduce((a, l) => a + l.qty * l.unitCost, 0) * 100) / 100;
  if (total < sup.minOrder) return `${sup.name} needs a ${dollars(sup.minOrder)} minimum.`;
  const onTerms = sup.terms > 0;
  if (!onTerms && total > state.cash) return `Not enough cash (${formatMoney(total)}).`;
  // Room on the pallets by size: a watermelon or a Christmas tree takes more than a tin.
  const units = clean.reduce((a, l) => a + l.qty * sizeOf(l.productId), 0);
  const inStorage = storageUsed(state.shop);
  const cap = storageCap(state.shop);
  if (inStorage + units > cap) return `The pallets only have room for ${Math.max(0, cap - inStorage)} more units${clean.some((l) => sizeOf(l.productId) > 1) ? ' (bulky goods take more room)' : ''}.`;
  // What was left off, said once the order really goes (not again at each try of one that cannot).
  for (const l of offSeason) state.notices.push({ day: state.day, text: `${productDef(l.productId).name} left off the order: only sold around ${holiday(l.productId)}.`, kind: 'event' });
  for (const l of shortLines) state.notices.push({ day: state.day, text: `${productDef(l.productId).name} left off the order: in shortage this week.`, kind: 'event' });
  if (onTerms) addBill(state, `${sup.name} invoice`, total, sup.terms);
  else state.cash -= total;
  state.today.cogs += 0; // stock is an asset; cost is recognised when sold
  // While the shop is still being fitted out the truck is quick, so the first five minutes keep moving.
  const eta = (state.phase === 'setup' ? Math.min(sup.etaSeconds, 20) : sup.etaSeconds) * (state.shop.loadingBay ? BAY_ETA : 1);
  const order: Order = { id: state.nextId++, supplierId: sup.id, lines: clean, total, placedDay: state.day, placedTime: state.time, eta, state: 'pending' };
  state.orders.push(order);
  cue(state, 'order');
  if (instant) deliverOrder(state, order);
  if (!state.tutorial.completed.includes('order')) {
    // Reward handled by completeTutorial via people.ts to keep one code path.
  }
  return order;
}

/**
 * Where a wholesale order is, for the Stock card: still being packed (how long until the truck sets
 * off), the truck on the road (it has left the depot and is driving round), or at the back door
 * (the truck has pulled up and is unloading onto the pallet).
 */
export function deliveryStatus(state: GameState, order: Order): { text: string; here: boolean } {
  if (order.state === 'delivered') return { text: 'Delivered', here: true };
  if (order.state === 'pending') {
    const m = Math.max(0, order.eta);
    return { text: m <= 60 ? `${Math.max(5, Math.ceil(m / 5) * 5)} min` : `${Math.ceil(m / 60)} h`, here: false };
  }
  const truck = state.cars.find((c) => c.orderId === order.id);
  return truck?.state === 'unloading' ? { text: 'At the back door', here: true } : { text: 'On the road', here: false };
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
  return state.people.filter((p) => p.kind === 'staff').reduce((a, p) => a + wageToday(p, state.time), 0);
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
  t.profit = Math.round((t.revenue + (t.charging ?? 0) - t.cogs - bills - extra.theft - extra.loans * 0.3) * 100) / 100;
  checkFailState(state);
  t.endCash = state.cash;
  t.satisfaction = t.satisfactionN ? t.satisfaction / t.satisfactionN : 0.5;
  // The last reviews of the day go up. Reputation drifts toward today's satisfaction, and (once the
  // listing has a few reviews) toward its star rating too: people read them. Awareness grows with served customers.
  reviewsNight(state);
  const shop = state.shop;
  const pull = ratingPull(state);
  const target = pull === null ? t.satisfaction : 0.75 * t.satisfaction + 0.25 * pull;
  shop.reputation += Math.max(-0.03, Math.min(0.03, (target - shop.reputation) * 0.3));
  shop.awareness = Math.min(1, shop.awareness + 0.02 + t.served * 0.002);
  state.scores.last = computeScores(state);
  // What the rivals watch: your prices, your share of each kind of shopper, your reputation.
  t.mine = { priceIndex: Math.round(priceIndex(state) * 1000) / 1000, share: playerShare(state, state.scores.last), reputation: shop.reputation };
  staffNight(state);
  franchiseDay(state);
  // The rivals' books, and everyone's shoppers at the crossroads today (the share the night card and goals use).
  const rivals = rivalsNight(state);
  const shoppers: Record<string, number> = { player: Math.max(0, t.customers - t.turnedAway) };
  for (const [id, n] of Object.entries(rivals)) shoppers[id] = Math.round(n);
  for (const f of state.franchises) if (f.corner) shoppers[`corner-${f.corner}`] = f.history[f.history.length - 1]?.customers ?? 0;
  t.shoppers = shoppers;
  // The owner tidies up overnight; the street sweeper does the town.
  state.shop.litter = [];
  sweepTown(state);
  state.shop.cleanliness = Math.min(1, state.shop.cleanliness + 0.35);
  state.history.push({ ...t, complaints: structuredClone(t.complaints), shoppers: { ...shoppers } });
  state.phase = 'night';
  trackGoals(state);
  checkGoals(state, 'night');
  // Tomorrow is decided tonight, so the night card can say what is coming.
  state.tomorrow = planDay(state, state.day + 1);
  state.history[state.history.length - 1]!.log = nightNotes(state);
  cue(state, 'night');
}

/** Roll a day's rival moves and events (applied when it opens). */
export function planDay(state: GameState, day: number): DayPlan {
  const rv = planRivals(state, day);
  const ev = planEvents(state, day);
  // The sky: a heavy-rain forecast may be a thunderstorm, a grey one drizzle; the forecast says which.
  const sky = skyFor(ev.weather, state.seed, day);
  const said = forecastFor(ev.weather, sky);
  if (said !== ev.weather) { ev.notices = ev.notices.map((n) => (n === ev.weather ? said! : n)); ev.weather = said; }
  const rumours = [...rv.rumours];
  if (state.marketing.openingEventDay === day) rumours.push('Your opening-day event is tomorrow: bunting, balloons and a crowd.');
  return { day, ...ev, rivals: rv.rivals, rumours, sky };
}

/** Start the next day: spoilage, fresh stats, doors open. */
/** The holidays coming round: a word two days ahead (time to order), on the day, and when it is over. */
export function holidayNotices(state: GameState): void {
  const d = state.day, today = holidayOn(d), soon = holidayOn(d, 2), was = holidayOn(d - 1);
  const goods = (h: Holiday) => PRODUCTS.filter((p) => p.season === h).map((p) => p.name.toLowerCase()).join(', ');
  if (soon && !today && holidayOn(d - 1, 2) !== soon) state.notices.push({ day: d, text: `${holidayName(soon)} in two days: order its goods now (Stock → Holidays: ${goods(soon)}).`, kind: 'event' });
  if (today && was !== today) state.notices.push({ day: d, text: `${holidayName(today)} starts today! Its goods sell fast for ${HOLIDAY_DAYS} days.`, kind: 'event' });
  if (was && !today) state.notices.push({ day: d, text: `${holidayName(was)} is over: nobody comes in for its goods now. Recycle what is left, on the shelves or the pallet, in the Stock card.`, kind: 'event' });
}

export function openTomorrow(state: GameState): void {
  if (state.phase !== 'night') return;
  state.day++;
  state.time = 0;
  state.today = emptyDayStats(state.day);
  // Yesterday's breaks were paid for at closing: today's are counted afresh.
  for (const p of state.people) if (p.breakSecs) p.breakSecs = undefined;
  state.phase = 'open';
  // Yesterday's waits fade; rivals make their moves.
  state.scores.waitSum *= 0.4; state.scores.waitSamples = Math.max(1, Math.floor(state.scores.waitSamples * 0.4));
  state.scores.avgWait = state.scores.waitSamples ? state.scores.waitSum / state.scores.waitSamples : 20;
  if (state.notices.length > 40) state.notices.splice(0, state.notices.length - 40);
  // What was decided last night (an old save loaded at night has no plan yet: roll it now).
  const plan = state.tomorrow && state.tomorrow.day === state.day ? state.tomorrow : planDay(state, state.day);
  state.tomorrow = null;
  state.sky = plan.sky ?? skyFor(plan.weather, state.seed, state.day);
  rivalDay(state, plan);
  marketDay(state);
  holidayNotices(state);
  applyUnlocks(state);
  marketingDay(state, plan);
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
  goalsMorning(state);
  if (!state.tutorial.completed.includes('openTomorrow') && state.day === 2) {
    // completed via commands (keeps reward logic in one place)
  }
  cue(state, 'open');
}

export function isClosingTime(state: GameState): boolean { return state.time >= CLOSE_TIME; }

/** Orderers and managers act at opening time (not one on a break). */
export function dailyAutomation(state: GameState): void {
  const staff = state.people.filter((p) => p.kind === 'staff' && !p.onBreak);
  const manager = staff.find((p) => p.role === 'manager');
  const orderer = staff.find((p) => p.role === 'orderer');
  // Your saved orders first (their conditions are yours), then the manager's own top-ups.
  managerSavedOrders(state, true);
  if (manager) { autoOrder(state, state.rules, state.rules.spendCap); managerPrices(state, state.rules); }
  else if (orderer) autoOrder(state, { ...state.rules, reorderPoint: 0.8 }, Math.min(state.rules.spendCap, state.cash * 0.5));
}
