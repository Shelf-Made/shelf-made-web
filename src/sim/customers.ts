/**
 * Customer types, store scoring and the town's choice between stores. Pure functions over
 * GameState; the tick uses them to decide who walks in.
 */
import type { GameState, CustomerType, RivalState, StoreScores } from './types';
import { PRODUCTS, productDef } from './products';
import { PLOTS } from './layout';

export const TYPE_WEIGHTS: Record<CustomerType, StoreScores> = {
  bargain: { price: 0.45, availability: 0.15, layout: 0.05, wait: 0.1, parking: 0.05, awareness: 0.2 },
  convenience: { price: 0.1, availability: 0.2, layout: 0.1, wait: 0.3, parking: 0.2, awareness: 0.1 },
  loyalist: { price: 0.1, availability: 0.45, layout: 0.1, wait: 0.1, parking: 0.05, awareness: 0.2 },
  impulse: { price: 0.15, availability: 0.15, layout: 0.35, wait: 0.1, parking: 0.05, awareness: 0.2 },
};
export const TYPE_BASE: Record<CustomerType, number> = { bargain: 0.3, convenience: 0.3, loyalist: 0.2, impulse: 0.2 };
export const TYPE_NAMES: Record<CustomerType, string> = { bargain: 'Bargain hunters', convenience: 'Convenience shoppers', loyalist: 'Brand loyalists', impulse: 'Impulse buyers' };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Average of the player's prices over town-average prices, for stocked products (1 = average). */
export function priceIndex(state: GameState): number {
  let sum = 0, n = 0;
  const seen = new Set<string>();
  for (const f of state.shop.fixtures) for (const s of f.slots) {
    if (!s.productId || seen.has(s.productId)) continue;
    seen.add(s.productId);
    const def = productDef(s.productId);
    sum += (state.prices[s.productId] ?? def.basePrice) / def.basePrice; n++;
  }
  return n ? sum / n : 1;
}

/** Share of shelf slots holding stock, 0..1. */
export function shelfFullness(state: GameState): number {
  let filled = 0, total = 0;
  for (const f of state.shop.fixtures) for (const s of f.slots) { total++; if (s.productId && s.qty > 0) filled++; }
  return total ? filled / total : 0;
}

/** Layout quality: variety of fixtures, end caps, signs, and room to walk. */
export function layoutQuality(state: GameState): number {
  const shop = state.shop;
  const tiles = (shop.floor.x1 - shop.floor.x0) * (shop.floor.z1 - shop.floor.z0);
  const fixtures = shop.fixtures.filter((f) => f.type !== 'register' && f.type !== 'kiosk');
  const density = fixtures.length / Math.max(1, tiles);
  const densityScore = density < 0.15 ? density / 0.15 * 0.6 : density <= 0.45 ? 0.6 + (density - 0.15) / 0.3 * 0.4 : Math.max(0.2, 1 - (density - 0.45) * 2);
  const endcaps = Math.min(2, fixtures.filter((f) => f.type === 'endcap' || f.type === 'rack').length) * 0.08;
  const signs = Math.min(2, fixtures.filter((f) => f.type === 'sign').length) * 0.06;
  const decor = Math.min(3, fixtures.filter((f) => f.type === 'plant' || f.type === 'bench').length) * 0.03;
  return clamp01(densityScore * 0.75 + endcaps + signs + decor);
}

export function computeScores(state: GameState): StoreScores {
  const idx = priceIndex(state);
  const t = state.today;
  const found = t.itemsSold + Math.max(0, t.served - 1);
  const foundRatio = t.missedItems + found > 3 ? found / (found + t.missedItems) : shelfFullness(state);
  const byCar = Math.max(1, Math.round(t.customers * 0.55));
  return {
    price: clamp01(0.5 + (1 - idx) * 1.6),
    availability: clamp01(0.35 * shelfFullness(state) + 0.65 * foundRatio),
    layout: clamp01(0.55 * state.shop.cleanliness + 0.45 * layoutQuality(state)),
    wait: clamp01(1 - state.scores.avgWait / 90) * (1 - Math.min(0.6, t.walkedOut / Math.max(1, t.customers) * 1.5)),
    parking: clamp01(1 - t.turnedAway / byCar),
    awareness: clamp01(state.shop.awareness),
  };
}

export function rivalScores(r: RivalState): StoreScores {
  const sale = r.saleDaysLeft > 0;
  return {
    price: clamp01(0.5 + (1 - (sale ? r.priceIndex * 0.82 : r.priceIndex)) * 1.6),
    availability: r.availability, layout: r.quality, wait: r.service, parking: r.parking, awareness: clamp01(r.awareness + (sale ? 0.15 : 0)),
  };
}

export function weighted(scores: StoreScores, type: CustomerType): number {
  const w = TYPE_WEIGHTS[type];
  return scores.price * w.price + scores.availability * w.availability + scores.layout * w.layout + scores.wait * w.wait + scores.parking * w.parking + scores.awareness * w.awareness;
}

/** The player's share of each customer type, against open rivals (softmax, temperature tuned so a clear edge matters but nobody is crushed). */
export function playerShare(state: GameState, scores = computeScores(state)): Record<CustomerType, number> {
  const open = state.rivals.filter((r) => r.open);
  const out = {} as Record<CustomerType, number>;
  for (const type of Object.keys(TYPE_BASE) as CustomerType[]) {
    const k = 4.0;
    const mine = Math.exp(k * weighted(scores, type) * (1 + state.shop.reputation * 0.3));
    let total = mine;
    for (const r of open) total += Math.exp(k * weighted(rivalScores(r), type) * (1 + r.reputation * 0.3)) * 0.5;
    out[type] = mine / total;
  }
  return out;
}

/** Expected arrivals per type for the day, before the time-of-day curve. */
export function expectedByType(state: GameState): Record<CustomerType, number> {
  const plot = PLOTS.find((p) => p.id === state.shop.plotId) ?? PLOTS[0]!;
  const base = state.demandBase;
  const openRivals = state.rivals.filter((r) => r.open).length;
  const pool = base * plot.traffic * (1 + 0.75 * openRivals) * (0.55 + 0.45 * state.shop.awareness) * (0.7 + 0.6 * state.shop.reputation) * state.eventDemand;
  const share = playerShare(state);
  const out = {} as Record<CustomerType, number>;
  for (const type of Object.keys(TYPE_BASE) as CustomerType[]) out[type] = pool * TYPE_BASE[type] * plot.mix[type] * share[type];
  return out;
}

/** Products a type is drawn to when building a shopping list. */
export function listWeight(type: CustomerType, productId: string, stocked: boolean): number {
  const p = productDef(productId);
  let w = p.demand * (stocked ? 4 : 0.25);
  if (type === 'loyalist' && p.brand) w *= 2.8;
  if (type === 'impulse' && p.impulse) w *= 2.2;
  if (type === 'bargain' && p.basePrice < 1.5) w *= 1.4;
  return w;
}

export function budgetFor(type: CustomerType, rnd: number): number {
  const base = type === 'bargain' ? 15 : type === 'convenience' ? 19 : type === 'loyalist' ? 28 : 22;
  return base * (0.7 + rnd * 0.8);
}

export const ALL_PRODUCT_IDS = PRODUCTS.map((p) => p.id);
