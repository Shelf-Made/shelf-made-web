/**
 * Franchises: more stores out of town (named sites off the map, signposted from the crossroads),
 * each run by a manager you hire. A lighter simulation
 * for stores you are not watching: one daily roll per store, driven by the manager's
 * skill, your shared reputation and the rules. Stock comes from a central warehouse
 * (your storeroom orders), reports and alerts arrive each night.
 */
import type { GameState, Franchise, Candidate } from './types';
import { OFFMAP_SITES } from './layout';
import { withRng } from './state';
import { expectedByType } from './customers';

export const FRANCHISE_COST = 2800;
export const FRANCHISE_RENT = 35;

export function openFranchise(state: GameState, siteId: string, managerId: number): string | null {
  if (state.franchises.some((f) => f.siteId === siteId)) return 'You already have a store there.';
  const site = OFFMAP_SITES.find((p) => p.id === siteId);
  if (!site) return 'No such site.';
  if (state.rivals.some((r) => r.branches.includes(siteId))) return `MegaMart already trades in ${site.name}.`;
  const c = state.staffPool.find((x) => x.id === managerId && x.role === 'manager');
  if (!c) return "Pick a manager from today's pool.";
  if (state.cash < FRANCHISE_COST) return `Need $${FRANCHISE_COST} for the lease and fit-out.`;
  state.cash -= FRANCHISE_COST;
  state.staffPool = state.staffPool.filter((x) => x.id !== c.id);
  const f: Franchise = { id: state.nextId++, siteId: site.id, name: `${state.shop.name} ${site.name}`, manager: c, openedDay: state.day, stockLevel: 0.6, reputation: state.shop.reputation, cashToday: 0, history: [], alerts: [] };
  state.franchises.push(f);
  state.notices.push({ day: state.day, text: `${f.name} opens tomorrow with ${c.name} as manager.`, kind: 'info' });
  return null;
}

export function closeFranchise(state: GameState, id: number): string | null {
  const i = state.franchises.findIndex((f) => f.id === id);
  if (i < 0) return 'No such store.';
  const f = state.franchises[i]!;
  state.franchises.splice(i, 1);
  state.cash += Math.round(FRANCHISE_COST * 0.4);
  state.notices.push({ day: state.day, text: `${f.name} closed; the lease sold for $${Math.round(FRANCHISE_COST * 0.4)}.`, kind: 'money' });
  return null;
}

export function replaceManager(state: GameState, id: number, managerId: number): string | null {
  const f = state.franchises.find((x) => x.id === id);
  const c = state.staffPool.find((x) => x.id === managerId && x.role === 'manager');
  if (!f || !c) return 'No such store or manager.';
  state.staffPool = state.staffPool.filter((x) => x.id !== c.id);
  f.manager = c;
  state.notices.push({ day: state.day, text: `${c.name} now manages ${f.name}.`, kind: 'staff' });
  return null;
}

/** One day for every branch: a quick model of what a managed store makes. */
export function franchiseDay(state: GameState): void {
  const by = expectedByType(state);
  const baseCustomers = (by.bargain + by.convenience + by.loyalist + by.impulse) * 0.8;
  for (const f of state.franchises) {
    const plot = OFFMAP_SITES.find((p) => p.id === f.siteId) ?? OFFMAP_SITES[0]!;
    withRng(state, 'franchise', (r) => {
      const m = f.manager;
      // Stock: the manager reorders by the rules; poor ones let shelves run bare.
      const reorder = Math.min(1.2, state.rules.reorderPoint);
      f.stockLevel = Math.max(0.1, Math.min(1, f.stockLevel * 0.55 + (0.35 + m.skill * 0.5) * reorder * r.range(0.8, 1.1)));
      const customers = Math.round(baseCustomers * plot.traffic * (0.6 + f.reputation * 0.6) * r.range(0.85, 1.15));
      const served = Math.round(customers * (0.55 + f.stockLevel * 0.4) * (0.7 + m.speed * 0.3));
      const basket = 7.5 * (0.9 + m.skill * 0.2) * Math.min(state.rules.priceMax, Math.max(state.rules.priceMin, 1.05));
      const revenue = served * basket;
      const cogs = revenue * 0.56;
      const shrink = revenue * (0.03 - m.skill * 0.02);
      const wages = m.wage + 2 * 42;
      const profit = Math.round((revenue - cogs - shrink - wages * 1.12 - FRANCHISE_RENT - 8) * 100) / 100;
      state.cash += profit;
      f.cashToday = profit;
      f.history.push({ day: state.day, customers, served, revenue: Math.round(revenue), profit });
      if (f.history.length > 30) f.history.shift();
      const alerts: string[] = [];
      if (f.stockLevel < 0.35) alerts.push('shelves running bare');
      if (profit < 0) alerts.push('lost money today');
      if (m.skill < 0.4 && r.chance(0.25)) alerts.push('manager mishandled an order');
      f.alerts = alerts;
      f.reputation = Math.max(0, Math.min(1, f.reputation + (0.35 + f.stockLevel * 0.5 - f.reputation) * 0.15));
      // Shared brand: branches drag or lift the main shop a little.
      state.shop.reputation = Math.max(0, Math.min(1, state.shop.reputation + (f.reputation - state.shop.reputation) * 0.04));
      state.notices.push({ day: state.day, text: `${f.name}: ${served} of ${customers} served, ${profit >= 0 ? '+' : ''}$${profit.toFixed(0)}${alerts.length ? ' · ' + alerts.join(', ') : ''}.`, kind: profit < 0 ? 'money' : 'info' });
    });
  }
}

export function managerCandidates(state: GameState): Candidate[] { return state.staffPool.filter((c) => c.role === 'manager'); }
