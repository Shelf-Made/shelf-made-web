/** Systems unlock over the first days; a hint says what to do next. */
import type { GameState, CardId } from './types';

export const UNLOCK_DAY: Record<Exclude<CardId, null | 'stock' | 'prices' | 'stats' | 'settings'>, number> = { build: 2, staff: 3, marketing: 5 };

export function applyUnlocks(state: GameState): void {
  for (const [card, day] of Object.entries(UNLOCK_DAY) as [keyof typeof UNLOCK_DAY, number][]) {
    if (state.day >= day && !state.unlocks[card]) {
      state.unlocks[card] = true;
      if (!state.unlocks.newBadges.includes(card)) state.unlocks.newBadges.push(card);
      state.notices.push({ day: state.day, text: card === 'build' ? 'Build mode is open: add shelves, fridges and more.' : card === 'staff' ? 'You can hire staff now. A cashier takes over the register.' : 'Marketing is open: flyers, billboards and deals.', kind: 'info' });
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
  if (state.cash < 60 && state.loans.length === 0) return 'Cash is tight. A small loan now is cheaper than missing rent.';
  if (empty > 0 && storage > 0) return 'Some shelves are empty but the storeroom has stock: click a shelf to restock it' + (state.unlocks.staff && !hasStocker ? ', or hire a stocker.' : '.');
  if (empty > 0 && !pending) return 'Shelves are selling out and nothing is on order. Order stock before the afternoon rush.';
  if (line >= 3 && !hasCashier) return state.unlocks.staff ? 'A line is forming. Hire a cashier so you can stop scanning.' : 'A line is forming. Keep scanning (Space) and the staff card unlocks on day 3.';
  if (t.turnedAway >= 3) return 'Drivers are leaving because the lot is full. More parking is in Build mode.';
  if (shop.fixtures.filter((f) => FIX_SELL.has(f.type)).length < 4 && state.unlocks.build && state.cash > 300) return 'You have room and cash: add a shelf or a produce crate in Build mode.';
  if (state.scores.last && state.scores.last.price < 0.4) return 'Your prices are well above the town average. Bargain hunters are walking past.';
  if (shop.awareness < 0.5 && state.unlocks.marketing) return 'Not many people know the shop yet. A flyer campaign brings new faces.';
  if (shop.cleanliness < 0.6) return 'The floor is getting messy. A cleaner keeps shoppers happy.';
  return 'Things look steady. Watch the Stats card for what shoppers rate low, and plan the next shelf.';
}

const FIX_SELL = new Set(['shelf', 'fridge', 'freezer', 'produce', 'endcap', 'rack']);
