/**
 * Saved orders: an order you made once, kept to place again with one click, and placed by a manager
 * (when you have one) whenever the condition you set for it is met: every morning, every few days,
 * when the pallet runs low, or when one product runs low. Never more than once a day each, never
 * while it is still on its way, and never leaving less in the till than you said.
 */
import type { GameState, SavedOrder, OrderRule } from './types';
import { placeOrder, unitCost } from './economy';
import { productDef } from './products';
import { storageUsed } from './layout';
import { dollars } from './money';

export const MAX_SAVED = 8;

/** What a saved order costs at today's prices. */
export function savedOrderCost(state: GameState, o: SavedOrder): number {
  return Math.round(o.lines.reduce((a, l) => a + l.qty * unitCost(l.productId, o.supplierId, state), 0) * 100) / 100;
}

/** The condition in words (the Stock card shows it). */
export function ruleText(r: OrderRule): string {
  switch (r.kind) {
    case 'never': return 'Only when I place it';
    case 'daily': return 'Every morning';
    case 'everyDays': return `Every ${r.days} days`;
    case 'palletBelow': return `When the pallet has under ${r.units} units`;
    case 'productBelow': return `When ${productDef(r.productId).name.toLowerCase()} is under ${r.units} (shelves and pallet)`;
  }
}

export function saveOrder(state: GameState, name: string, supplierId: string, lines: { productId: string; qty: number }[]): string | null {
  const clean = lines.filter((l) => l.qty > 0).map((l) => ({ productId: l.productId, qty: Math.floor(l.qty) }));
  if (!clean.length) return 'Add something to the order first.';
  const list = (state.savedOrders ??= []);
  if (list.length >= MAX_SAVED) return `${MAX_SAVED} saved orders is the most: delete one first.`;
  list.push({ id: state.nextId++, name: name.trim().slice(0, 30) || `Order ${list.length + 1}`, supplierId, lines: clean, when: { kind: 'never' }, minCash: 200 });
  return null;
}

export function editSavedOrder(state: GameState, id: number, patch: Partial<Pick<SavedOrder, 'name' | 'when' | 'minCash' | 'supplierId'>>): string | null {
  const o = state.savedOrders?.find((x) => x.id === id);
  if (!o) return 'No such saved order.';
  if (patch.name !== undefined) o.name = patch.name.trim().slice(0, 30) || o.name;
  if (patch.when) o.when = patch.when;
  if (patch.minCash !== undefined) o.minCash = Math.max(0, Math.round(patch.minCash));
  if (patch.supplierId) o.supplierId = patch.supplierId;
  return null;
}

export function deleteSavedOrder(state: GameState, id: number): string | null {
  const list = state.savedOrders ?? [];
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return 'No such saved order.';
  list.splice(i, 1);
  return null;
}

/** Place a saved order now (by hand, or the manager's). */
export function placeSaved(state: GameState, id: number, byManager = false): string | null {
  const o = state.savedOrders?.find((x) => x.id === id);
  if (!o) return 'No such saved order.';
  const cost = savedOrderCost(state, o);
  if (state.cash < cost) return `Need ${dollars(cost)}.`;
  const res = placeOrder(state, o.supplierId, o.lines);
  if (typeof res === 'string') return res;
  res.savedId = o.id;
  o.lastDay = state.day;
  if (byManager) state.notices.push({ day: state.day, text: `Your manager placed "${o.name}" (${dollars(res.total)}): ${ruleText(o.when).toLowerCase()}.`, kind: 'staff' });
  return null;
}

/** How many of a product there are, on the shelves and the pallet together. */
function onHand(state: GameState, productId: string): number {
  let n = 0;
  for (const f of state.shop.fixtures) for (const s of f.slots) if (s.productId === productId) n += s.qty;
  for (const e of state.shop.storage) if (e.productId === productId) n += e.qty;
  return n;
}

/** Is a saved order's condition met right now? (`morning`: the start-of-day check.) */
export function ruleMet(state: GameState, o: SavedOrder, morning: boolean): boolean {
  const r = o.when;
  switch (r.kind) {
    case 'never': return false;
    case 'daily': return morning;
    case 'everyDays': return morning && (o.lastDay === undefined || state.day - o.lastDay >= r.days);
    // (Room used, as the pallet counts it: a Christmas tree takes five units of it.)
    case 'palletBelow': return storageUsed(state.shop) < r.units;
    case 'productBelow': return onHand(state, r.productId) < r.units;
  }
}

/**
 * The manager goes through the saved orders: each whose condition holds is placed, once a day at most,
 * not while the last one is still on its way, and only leaving at least its cash floor in the till.
 */
export function managerSavedOrders(state: GameState, morning: boolean): void {
  if (!state.savedOrders?.length) return;
  if (!state.people.some((p) => p.kind === 'staff' && p.role === 'manager' && !p.onBreak)) return;
  for (const o of state.savedOrders) {
    if (o.lastDay === state.day) continue;
    if (state.orders.some((x) => x.savedId === o.id && x.state !== 'delivered')) continue;
    if (!ruleMet(state, o, morning)) continue;
    if (state.cash - savedOrderCost(state, o) < o.minCash) continue;
    placeSaved(state, o.id, true);
  }
}
