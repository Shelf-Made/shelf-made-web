/**
 * Supply side: daily wholesale price swings per category, shortages, and the supplier
 * catalogue's reaction to them. Deterministic from the 'market' RNG stream.
 */
import type { GameState } from './types';
import type { Category } from './products';
import { CATEGORY_NAMES, CORE_PRODUCTS } from './products';
import { withRng } from './state';

export const CATEGORIES: Category[] = ['produce', 'dairy', 'meat', 'dry', 'drinks', 'household'];
/** The aisles and departments beyond the first six: their prices drift on their own stream (so the first six roll as before). */
export const MORE_CATEGORIES: Category[] = ['bakery', 'frozen', 'pets', 'toys', 'clothing', 'electronics', 'home', 'books', 'sports', 'beauty', 'seasonal'];

export interface MarketState { priceMul: Record<Category, number>; shortages: Record<string, number> }

export function makeMarket(): MarketState {
  return { priceMul: Object.fromEntries([...CATEGORIES, ...MORE_CATEGORIES].map((c) => [c, 1])) as Record<Category, number>, shortages: {} };
}

/** Roll the day's wholesale prices and shortages. Writes notices for anything a shopkeeper would notice. */
export function marketDay(state: GameState): void {
  const m = state.market;
  withRng(state, 'market', (r) => {
    for (const c of CATEGORIES) {
      // Mean-reverting random walk: produce and meat swing most.
      const vol = c === 'produce' ? 0.12 : c === 'meat' ? 0.1 : c === 'dairy' ? 0.07 : 0.04;
      const next = m.priceMul[c] + (1 - m.priceMul[c]) * 0.35 + r.normal(0, vol);
      m.priceMul[c] = Math.max(0.7, Math.min(1.6, Math.round(next * 100) / 100));
      if (m.priceMul[c] >= 1.25) state.notices.push({ day: state.day, text: `${CATEGORY_NAMES[c]} wholesale prices are up ${Math.round((m.priceMul[c] - 1) * 100)}% today.`, kind: 'event' });
      else if (m.priceMul[c] <= 0.82) state.notices.push({ day: state.day, text: `${CATEGORY_NAMES[c]} are cheap at wholesale today (${Math.round((1 - m.priceMul[c]) * 100)}% off).`, kind: 'event' });
    }
    for (const id of Object.keys(m.shortages)) { m.shortages[id] = (m.shortages[id] ?? 1) - 1; if (m.shortages[id]! <= 0) delete m.shortages[id]; }
    if (state.day >= 3 && r.chance(0.18)) {
      const p = r.pick(CORE_PRODUCTS);
      if (!m.shortages[p.id]) {
        m.shortages[p.id] = r.int(2, 4);
        state.notices.push({ day: state.day, text: `Shortage: no ${p.name.toLowerCase()} from any supplier for ${m.shortages[p.id]} days.`, kind: 'event' });
      }
    }
  });
  // The rest drift gently (an older save starts them level).
  withRng(state, 'departments', (r) => {
    for (const c of MORE_CATEGORIES) {
      const was = m.priceMul[c] ?? 1;
      m.priceMul[c] = Math.max(0.8, Math.min(1.3, Math.round((was + (1 - was) * 0.4 + r.normal(0, 0.04)) * 100) / 100));
    }
  });
}

export function inShortage(state: GameState, productId: string): boolean { return (state.market.shortages[productId] ?? 0) > 0; }
