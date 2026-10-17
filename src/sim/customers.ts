/**
 * Customer types, store scoring and the town's choice between stores. Pure functions over
 * GameState; the tick uses them to decide who walks in.
 */
import type { GameState, CustomerType, RivalState, StoreScores } from './types';
import { PRODUCTS, productDef, holidayOn } from './products';
import { plotDef, PLOTS, DIFFICULTY, FIXTURES, shopArea } from './layout';
import { bikePull, lotAppeal } from './lot';
import { frontagePull } from './frontage';

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
  // Every open floor counts: shelves upstairs have the room up there.
  const tiles = shopArea(shop);
  // (Walls are no fixtures to shop at: round the shop or across it, they stand on edges.)
  const fixtures = shop.fixtures.filter((f) => f.type !== 'register' && f.type !== 'kiosk' && !FIXTURES[f.type].walkable && !FIXTURES[f.type].outdoor && !FIXTURES[f.type].edge);
  const density = fixtures.length / Math.max(1, tiles);
  const densityScore = density < 0.15 ? density / 0.15 * 0.6 : density <= 0.45 ? 0.6 + (density - 0.15) / 0.3 * 0.4 : Math.max(0.2, 1 - (density - 0.45) * 2);
  const endcaps = Math.min(2, fixtures.filter((f) => f.type === 'endcap' || f.type === 'rack').length) * 0.08;
  const signs = Math.min(2, fixtures.filter((f) => f.type === 'sign').length) * 0.06;
  const decor = Math.min(3, shop.fixtures.filter((f) => f.type !== 'sign' && !f.free && (FIXTURES[f.type].looks ?? 0) > 0).length) * 0.03;
  // A lot that looks cared for (flowers, trees, paving) draws people in off the street.
  return clamp01(densityScore * 0.75 + endcaps + signs + decor + 0.06 * lotAppeal(shop));
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

/**
 * A rival's six scores. Its moves in answer to the player (price matching, a renovation, longer hours...)
 * shift its own scores through `r.mods`; the weights and the softmax never change.
 */
export function rivalScores(r: RivalState): StoreScores {
  const sale = r.saleDaysLeft > 0;
  const m = r.mods;
  const idx = r.priceIndex * (1 - (m?.price ?? 0)) * (sale ? 0.82 - (m?.saleDepth ?? 0) : 1);
  return {
    price: clamp01(0.5 + (1 - idx) * 1.6),
    availability: clamp01(r.availability + (m?.availability ?? 0)), layout: clamp01(r.quality + (m?.quality ?? 0)), wait: clamp01(r.service + (m?.service ?? 0)), parking: r.parking,
    awareness: clamp01(r.awareness + (m?.awareness ?? 0) + (sale ? 0.15 + (m?.saleDepth ?? 0) : 0)),
  };
}

/** A rival's price index today, after any price match (sales aside). */
export function rivalPriceIndex(r: RivalState): number { return r.priceIndex * (1 - (r.mods?.price ?? 0)); }

const SCORE_ORDER: (keyof StoreScores)[] = ['price', 'availability', 'layout', 'wait', 'parking', 'awareness'];

/**
 * Why a shopper of this type chose a store: the two scores that contributed most (weight × score, the weights
 * of the table in docs/DESIGN.md §3.2), biggest first. Ties go in the table's column order.
 */
export function explainChoice(type: CustomerType, scores: StoreScores): (keyof StoreScores)[] {
  const w = TYPE_WEIGHTS[type];
  return SCORE_ORDER.map((k, i) => ({ k, v: w[k] * scores[k], i })).sort((a, b) => b.v - a.v || a.i - b.i).slice(0, 2).map((x) => x.k);
}

/** A reason in plain words, as the shopper would say it. `item` is something on their list, when there is one. */
export function reasonText(key: keyof StoreScores, type: CustomerType, opts: { item?: string; drove?: boolean; rival?: boolean } = {}): string {
  switch (key) {
    case 'price': return opts.item ? `Cheapest ${opts.item.toLowerCase()} in town` : type === 'bargain' ? 'The lowest prices around' : 'Fair prices';
    case 'availability': return type === 'loyalist' ? 'Always has my brands' : 'Always has what I need';
    case 'layout': return type === 'impulse' ? 'Fun to look around' : 'Clean and easy to find things';
    case 'wait': return 'In and out fast';
    case 'parking': return opts.drove ? 'Easy to park' : 'Close to home';
    case 'awareness': return opts.rival ? 'Saw their ads everywhere' : 'Heard good things about it';
  }
}

/** Each open rival's shoppers today by customer type (the same model as `rivalShoppersToday`). */
export function rivalShoppersByType(state: GameState, scores = computeScores(state)): Record<string, Record<CustomerType, number>> {
  const open = state.rivals.filter((r) => r.open);
  const shares = rivalShares(state, scores);
  const pool = state.demandBase * (1 + 0.75 * open.length) * state.eventDemand * townGrowth(state.day) * DIFFICULTY[state.difficulty].demandMul * ARRIVALS_PER_EXPECTED;
  const out: Record<string, Record<CustomerType, number>> = {};
  for (const r of open) {
    const plot = PLOTS.find((p) => p.corner === r.corner);
    const k = pool * (plot?.traffic ?? 1) * (0.55 + 0.45 * r.awareness) * (0.7 + 0.6 * r.reputation);
    out[r.id] = {} as Record<CustomerType, number>;
    for (const t of Object.keys(TYPE_BASE) as CustomerType[]) out[r.id]![t] = k * TYPE_BASE[t] * (plot?.mix[t] ?? 1) * (shares[r.id]?.[t] ?? 0);
  }
  return out;
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

/** Each open rival's share of each customer type, on the same softmax as the player's. */
export function rivalShares(state: GameState, scores = computeScores(state)): Record<string, Record<CustomerType, number>> {
  const open = state.rivals.filter((r) => r.open);
  const out: Record<string, Record<CustomerType, number>> = {};
  for (const r of open) out[r.id] = {} as Record<CustomerType, number>;
  for (const type of Object.keys(TYPE_BASE) as CustomerType[]) {
    const k = 4.0;
    const mine = Math.exp(k * weighted(scores, type) * (1 + state.shop.reputation * 0.3));
    const theirs = open.map((r) => Math.exp(k * weighted(rivalScores(r), type) * (1 + r.reputation * 0.3)) * 0.5);
    const total = mine + theirs.reduce((a, b) => a + b, 0);
    open.forEach((r, i) => { out[r.id]![type] = theirs[i]! / total; });
  }
  return out;
}

/** Expected arrivals per type for the day, before the time-of-day curve. */
export function expectedByType(state: GameState): Record<CustomerType, number> {
  const plot = plotDef(state.shop.plotId);
  const base = state.demandBase;
  const openRivals = state.rivals.filter((r) => r.open).length;
  const pool = base * plot.traffic * (1 + 0.75 * openRivals) * (0.55 + 0.45 * state.shop.awareness) * (0.7 + 0.6 * state.shop.reputation) * state.eventDemand * bikePull(state.shop) * frontagePull(state.shop);
  const share = playerShare(state);
  const out = {} as Record<CustomerType, number>;
  for (const type of Object.keys(TYPE_BASE) as CustomerType[]) out[type] = pool * TYPE_BASE[type] * plot.mix[type] * share[type];
  return out;
}

/** Products a type is drawn to when building a shopping list. */
export function listWeight(type: CustomerType, productId: string, stocked: boolean, day = 1): number {
  const p = productDef(productId);
  // Beyond the first range, shoppers only want what you sell; a holiday's goods only around it (and then all the more).
  if (p.extra && !stocked) return 0;
  if (p.season) { if (holidayOn(day) !== p.season) return 0; }
  let w = p.demand * (stocked ? 4 : 0.25) * (p.season ? 1.5 : 1);
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

/** The town grows day by day (the same for every store): 5% a day, up to 2.2x. */
export function townGrowth(day: number): number { return Math.min(2.2, 1 + (day - 1) * 0.05); }

/**
 * Arrivals per expected customer: the tick's spawner runs 15% over the expected rate plus a 35% chance
 * of an extra arrival, over a day curve that averages 0.94. Rivals' shoppers are counted on the same footing.
 */
export const ARRIVALS_PER_EXPECTED = 1.46;

/**
 * How many shoppers each open rival draws today: the town's pool by type, the corner's traffic and mix,
 * the rival's share on the same softmax as the player's, and its awareness and reputation the same way
 * the player's own count them. On the same scale as the player's arrivals, so shares compare fairly.
 */
export function rivalShoppersToday(state: GameState, scores = computeScores(state)): Record<string, number> {
  const by = rivalShoppersByType(state, scores);
  const out: Record<string, number> = {};
  for (const [id, t] of Object.entries(by)) out[id] = Object.values(t).reduce((a, b) => a + b, 0);
  return out;
}
