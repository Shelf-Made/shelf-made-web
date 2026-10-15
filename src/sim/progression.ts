/** Systems unlock over the first days; a hint says what to do next. */
import type { GameState, CardId } from './types';

export const UNLOCK_DAY: Record<Exclude<CardId, null | 'stock' | 'prices' | 'stats' | 'settings' | 'build' | 'reviews'>, number> = { staff: 3, marketing: 5 };

export function applyUnlocks(state: GameState): void {
  for (const [card, day] of Object.entries(UNLOCK_DAY) as [keyof typeof UNLOCK_DAY, number][]) {
    if (state.day >= day && !state.unlocks[card]) {
      state.unlocks[card] = true;
      if (!state.unlocks.newBadges.includes(card)) state.unlocks.newBadges.push(card);
      state.notices.push({ day: state.day, text: card === 'staff' ? 'Staff unlocked: a cashier takes the till.' : 'Marketing is open: flyers, billboards and deals.', kind: 'info' });
    }
  }
}

/** One plain sentence about the most useful next move. */
export function hint(state: GameState): string {
  const shop = state.shop;
  const t = state.today;
  const empty = shop.fixtures.reduce((a, f) => a + f.slots.filter((s) => s.productId && s.qty === 0).length, 0);
  const storage = shop.storage.reduce((a, e) => a + e.qty, 0);
  const pending = state.orders.some((o) => o.state !== 'delivered');
  const hasCashier = state.people.some((p) => p.kind === 'staff' && p.role === 'cashier');
  const hasStocker = state.people.some((p) => p.kind === 'staff' && p.role === 'stocker');
  const reg = shop.fixtures.find((f) => f.type === 'register');
  const line = (reg?.queue?.length ?? 0);
  if (state.phase === 'setup') {
    if (!reg && !shop.fixtures.some((f) => f.type === 'kiosk')) return 'Press B and place a checkout counter near the door.';
    if (!shop.fixtures.some((f) => FIX_SELL.has(f.type))) return 'Place a shelf or two (chillers for cold things).';
    const stocked = shop.fixtures.some((f) => f.slots.some((s) => s.productId && s.qty > 0));
    if (!stocked && storage === 0 && !pending) return 'Order stock (Tab). The truck drops boxes at the back door.';
    if (!stocked && storage === 0) return 'The truck is on its way. Arrange the floor while you wait.';
    if (!stocked) return 'F at the pallet for a box, F at a shelf to stock it.';
    return 'All set? Press Open shop.';
  }
  if (state.cash < 60 && state.loans.length === 0) return 'Cash is tight. A small loan now is cheaper than missing rent.';
  if (empty > 0 && storage > 0) return 'Empty shelves, boxes on the pallet: carry one over' + (state.unlocks.staff && !hasStocker ? ', or hire a stocker.' : '.');
  if (empty > 0 && !pending) return 'Shelves selling out and nothing on order.';
  if (line >= 3 && !hasCashier) return state.unlocks.staff ? 'A line is forming: hire a cashier.' : 'A line is forming: keep scanning (Space). Staff opens on day 3.';
  if (t.turnedAway >= 3) return 'The lot is full: more parking on Build.';
  if (shop.fixtures.filter((f) => FIX_SELL.has(f.type)).length < 4 && state.unlocks.build && state.cash > 300) return 'Room and cash to spare: add a shelf.';
  if (state.scores.last && state.scores.last.price < 0.4) return 'Prices well over the town average: bargain hunters walk past.';
  if (shop.awareness < 0.5 && state.unlocks.marketing) return 'Few know the shop yet: try flyers.';
  if (shop.cleanliness < 0.6) return 'The floor is messy: hire a cleaner.';
  return 'Steady. Stats shows what shoppers rate low.';
}

const FIX_SELL = new Set(['shelf', 'fridge', 'freezer', 'produce', 'endcap', 'rack']);
