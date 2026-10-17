/**
 * The stock tool, the storage racks and recycling. With the stock tool out, a click on a shelf (or a
 * drag across a row of them) tops it up straight from the pallet, no walking with boxes; Supply tops up
 * every shelf there is a way to. Storage racks give the pallet more room. Stock you do not want goes
 * for recycling at half what it cost.
 */
import type { GameState, Fixture } from './types';
import { FIXTURES } from './layout';
import { pickCarryTask, placeOnFixture, getsTo, completeTutorial } from './people';
import { productDef } from './products';
import { popup, cue } from './state';
import { fixtureCentre } from './grid';
import { formatMoney } from './money';

/** What recycling pays back, of what the stock cost. */
export const RECYCLE_BACK = 0.5;

/**
 * Fill a shelf up from the pallet: each slot topped up with what it holds (oldest boxes first), and empty
 * slots given something that fits. Returns how many units went on.
 */
export function topUp(state: GameState, f: Fixture): number {
  if (!FIXTURES[f.type].slots || !getsTo(state, f)) return 0;
  let moved = 0;
  for (let guard = 0; guard < 40; guard++) {
    const t = pickCarryTask(state, f, true), before = moved;
    if (!t) break;
    let want = t.qty;
    // Off the pallet, oldest first.
    for (const e of state.shop.storage.filter((x) => x.productId === t.productId).sort((a, b) => a.day - b.day)) {
      if (want <= 0) break;
      const take = Math.min(e.qty, want);
      e.qty -= take; want -= take;
      // (As the manager stocks: a product new to this shelf may take a sold-out slot.)
      const left = placeOnFixture(state, f, t.productId, take, !f.slots.some((s) => s.productId === t.productId));
      e.qty += left;
      moved += take - left;
      if (left > 0) break;
    }
    state.shop.storage = state.shop.storage.filter((e) => e.qty > 0);
    if (moved === before) break;
  }
  if (moved > 0) {
    const c = fixtureCentre(state.shop, f);
    popup(state, c, `+${moved}`, 'money', 1.1);
    cue(state, 'stock');
    // (The first day's "stock a shelf" step, done with the tool as well as by hand.)
    completeTutorial(state, 'stock');
  }
  return moved;
}

/** Supply: every shelf there is a way to, topped up from the pallet, the emptiest first. */
export function topUpAll(state: GameState): number {
  const ratio = (f: Fixture) => f.slots.reduce((a, s) => a + s.qty, 0) / Math.max(1, FIXTURES[f.type].slots * FIXTURES[f.type].capacity);
  let moved = 0;
  for (const f of state.shop.fixtures.filter((x) => FIXTURES[x.type].slots > 0).sort((a, b) => ratio(a) - ratio(b))) moved += topUp(state, f);
  return moved;
}

/**
 * Recycle every unit of a product on the pallet, for half what it cost (`shelves`: every unit on the
 * shelves instead, a holiday's leftovers once it is over, and its slots come free for something else).
 * Returns what it paid.
 */
export function recycle(state: GameState, productId: string, shelves = false): number {
  let qty = 0;
  if (shelves) {
    for (const f of state.shop.fixtures) for (const s of f.slots) if (s.productId === productId) { qty += s.qty; s.productId = null; s.qty = 0; }
  } else {
    qty = state.shop.storage.filter((e) => e.productId === productId).reduce((a, e) => a + e.qty, 0);
    state.shop.storage = state.shop.storage.filter((e) => e.productId !== productId);
  }
  if (!qty) return 0;
  const back = Math.round(qty * productDef(productId).cost * RECYCLE_BACK * 100) / 100;
  state.cash = Math.round((state.cash + back) * 100) / 100;
  state.today.other = Math.round((state.today.other - back) * 100) / 100;
  const o = state.people.find((p) => p.kind === 'owner');
  if (o) popup(state, o, `Recycled: ${formatMoney(back)}`, 'money', 1.2);
  cue(state, 'coin');
  return back;
}
