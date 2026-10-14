/**
 * Supply side: daily wholesale price swings per category, shortages, and the supplier
 * catalogue's reaction to them. Deterministic from the 'market' RNG stream.
 */
import type { GameState } from './types';
import type { Category } from './products';
import { CATEGORY_NAMES, PRODUCTS } from './products';
import { withRng } from './state';

export const CATEGORIES: Category[] = ['produce', 'dairy', 'meat', 'dry', 'drinks', 'household'];

export interface MarketState { priceMul: Record<Category, number>; shortages: Record<string, number> }

export function makeMarket(): MarketState {
  return { priceMul: { produce: 1, dairy: 1, meat: 1, dry: 1, drinks: 1, household: 1 }, shortages: {} };
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
      const p = r.pick(PRODUCTS);
      if (!m.shortages[p.id]) {
        m.shortages[p.id] = r.int(2, 4);
        state.notices.push({ day: state.day, text: `Shortage: no ${p.name.toLowerCase()} from any supplier for ${m.shortages[p.id]} days.`, kind: 'event' });
      }
    }
  });
}

export function inShortage(state: GameState, productId: string): boolean { return (state.market.shortages[productId] ?? 0) > 0; }
