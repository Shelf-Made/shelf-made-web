/**
 * Rival stores: a discounter, a premium grocer and an expanding chain. They open over the
 * first days, keep a simple state, and act through the same command layer as the player.
 */
import type { GameState, RivalState } from './types';
import { withRng, popup, cue } from './state';

export const RIVAL_DEFS: Omit<RivalState, 'open' | 'saleDaysLeft' | 'nextSaleDay' | 'cash' | 'reputation'>[] = [
  { id: 'discount', name: 'Cheapo', kind: 'discount', opensDay: 3, priceIndex: 0.86, availability: 0.6, quality: 0.35, service: 0.55, parking: 0.8, awareness: 0.6, x: -20, z: 8.9, stores: 1 },
  { id: 'premium', name: 'Fresh & Fine', kind: 'premium', opensDay: 6, priceIndex: 1.22, availability: 0.85, quality: 0.9, service: 0.8, parking: 0.6, awareness: 0.5, x: 20, z: 8.9, stores: 1 },
  { id: 'chain', name: 'MegaMart', kind: 'chain', opensDay: 10, priceIndex: 0.95, availability: 0.9, quality: 0.65, service: 0.7, parking: 0.95, awareness: 0.75, x: 44, z: 8.9, stores: 1 },
];

export function makeRivals(): RivalState[] {
  return RIVAL_DEFS.map((d) => ({ ...d, open: false, saleDaysLeft: 0, nextSaleDay: d.opensDay + 2, cash: 5000, reputation: 0.5 }));
}

/** Rival decisions at the start of each day: open, run sales, drift toward their strategy, advertise. */
export function rivalDay(state: GameState): void {
  for (const r of state.rivals) {
    if (!r.open && state.day >= r.opensDay) {
      r.open = true;
      popup(state, { x: r.x, z: r.z - 2 }, `${r.name} just opened across the road`, 'info', 2.2);
      state.notices.push({ day: state.day, text: `${r.name} opened across the road. Expect a few shoppers to stray.`, kind: 'rival' });
      cue(state, 'bad');
      continue;
    }
    if (!r.open) continue;
    if (r.saleDaysLeft > 0) { r.saleDaysLeft--; if (r.saleDaysLeft === 0) r.awareness = Math.max(0.3, r.awareness - 0.05); }
    else if (state.day >= r.nextSaleDay) {
      r.saleDaysLeft = r.kind === 'discount' ? 2 : 1;
      r.nextSaleDay = state.day + withRng(state, 'rivals', (rr) => rr.int(4, 8));
      popup(state, { x: r.x, z: r.z - 2 }, `${r.name} is running a sale!`, 'bad', 2.2);
      state.notices.push({ day: state.day, text: `${r.name} is running a sale. Bargain hunters will drift over for ${r.saleDaysLeft} day${r.saleDaysLeft > 1 ? 's' : ''}.`, kind: 'rival' });
      cue(state, 'bad');
    }
    // Awareness grows slowly; the chain keeps expanding (second site counts as more awareness and parking).
    r.awareness = Math.min(1, r.awareness + 0.01);
    if (r.kind === 'chain' && state.day > r.opensDay + 8 && r.stores < 3 && withRng(state, 'rivals', (rr) => rr.chance(0.15))) {
      r.stores++; r.awareness = Math.min(1, r.awareness + 0.1); r.parking = Math.min(1, r.parking + 0.03);
      state.notices.push({ day: state.day, text: `${r.name} opened another branch in town.`, kind: 'rival' });
    }
    // Reputation drifts toward quality, dented by the player's reputation lead.
    r.reputation += (r.quality * 0.6 + r.service * 0.4 - r.reputation) * 0.1 - Math.max(0, state.shop.reputation - r.reputation) * 0.02;
  }
}

export function rivalOnSale(state: GameState): RivalState | undefined { return state.rivals.find((r) => r.open && r.saleDaysLeft > 0); }
