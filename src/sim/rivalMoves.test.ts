import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { tick, applyCommand, TICK, type GameState } from './index';
import { planRivals, rivalDay, computeMods, MOVE_DAYS, triggeredMoves } from './rivals';
import { explainChoice, rivalScores, computeScores, TYPE_WEIGHTS } from './customers';
import { spawnCustomer } from './people';
import { spawnRivalShopper } from './rivalShoppers';
import { inspectPerson } from './inspect';
import { emptyDayStats } from './newGame';
import type { CustomerType, DayStats, StoreScores } from './types';

const SHARE = { bargain: 0.4, convenience: 0.4, loyalist: 0.4, impulse: 0.4 };
/** Three closed days in which the player looks like `mine` (and had `shoppers`). */
function watchedDays(s: GameState, mine: Partial<NonNullable<DayStats['mine']>>[], shoppers?: Record<string, number>): void {
  s.history = mine.map((m, i) => ({ ...emptyDayStats(i + 1), shoppers: shoppers ?? { player: 30, discount: 30, premium: 30, chain: 30 }, mine: { priceIndex: 1, share: { ...SHARE }, reputation: 0.5, ...m } }));
  s.day = mine.length;
}
function openAll(s: GameState): void { for (const r of s.rivals) { r.open = true; r.saleDaysLeft = 0; r.nextSaleDay = 999; } }
/** The night plan, then the next morning applying it (as closeDay and openTomorrow do). */
function nightAndMorning(s: GameState) { const plan = planRivals(s, s.day + 1); s.day++; rivalDay(s, plan); return plan; }
const rival = (s: GameState, id: string) => s.rivals.find((r) => r.id === id)!;

describe('rivals answer the player', () => {
  it('Cheapo price-matches when your prices undercut it, with a rumour the night before, then cools down', () => {
    const s = openGame({ seed: 31, plotId: 'main', name: 'Undercut' });
    openAll(s);
    const c = rival(s, 'discount');
    watchedDays(s, [{ priceIndex: 1.0 }, { priceIndex: 1.0 }, { priceIndex: 1.0 }]);
    expect(triggeredMoves(s, c)).toEqual([]);
    watchedDays(s, [{ priceIndex: 0.8 }, { priceIndex: 0.8 }, { priceIndex: 0.8 }]);
    expect(triggeredMoves(s, c)).toEqual(['priceMatch']);
    const plan = nightAndMorning(s);
    expect(plan.rivals.find((p) => p.id === 'discount')?.move).toBe('priceMatch');
    expect(plan.rumours.some((t) => t.includes('price match'))).toBe(true);
    expect(c.responses?.some((r) => r.move === 'priceMatch')).toBe(true);
    expect(c.mods!.price).toBeGreaterThan(0.03);
    expect(rivalScores(c).price).toBeGreaterThan(rivalScores({ ...c, mods: undefined }).price);
    expect(s.notices.some((n) => n.text.includes('matching your prices'))).toBe(true);
    // Still undercut the next nights, but the move is on cooldown.
    for (let i = 0; i < 5; i++) { s.history.push({ ...s.history[s.history.length - 1]! }); const p = nightAndMorning(s); expect(p.rivals.find((x) => x.id === 'discount')?.move).toBeUndefined(); }
  });

  it('bargain hunters drifting your way also set Cheapo off', () => {
    const s = openGame({ seed: 32, plotId: 'main', name: 'Drift' });
    openAll(s);
    watchedDays(s, [{ share: { ...SHARE, bargain: 0.3 } }, { share: { ...SHARE, bargain: 0.33 } }, { share: { ...SHARE, bargain: 0.36 } }]);
    expect(triggeredMoves(s, rival(s, 'discount'))).toEqual(['priceMatch']);
  });

  it('Fresh & Fine renovates when your reputation outshines it: closed two days, then better', () => {
    const s = openGame({ seed: 33, plotId: 'main', name: 'Shine' });
    openAll(s);
    const f = rival(s, 'premium');
    f.reputation = 0.6;
    watchedDays(s, [{ reputation: 0.8 }, { reputation: 0.8 }, { reputation: 0.8 }]);
    expect(triggeredMoves(s, f)).toContain('renovation');
    // Only Fresh & Fine has a reason to move, so it is the day's move.
    const plan = nightAndMorning(s);
    expect(plan.rivals.find((p) => p.id === 'premium')?.move).toBe('renovation');
    expect(f.open).toBe(false);
    expect(f.renovatingUntil).toBe(s.day + MOVE_DAYS.renovation);
    nightAndMorning(s);
    expect(f.open).toBe(false);
    const reopen = nightAndMorning(s);
    expect(reopen.rumours.some((t) => t.includes('reopens'))).toBe(true);
    expect(f.open).toBe(true);
    expect(f.mods!.quality).toBeGreaterThan(0.05);
    expect(f.mods!.service).toBeGreaterThan(0.03);
  });

  it('MegaMart answers a bigger share with a sale, a billboard or longer hours; its billboard is not for rent', () => {
    const s = openGame({ seed: 34, plotId: 'main', name: 'Big' });
    openAll(s);
    const m = rival(s, 'chain');
    watchedDays(s, [{}, {}, {}], { player: 60, discount: 20, premium: 20, chain: 30 });
    expect(triggeredMoves(s, m)).toEqual(['bigSale', 'billboard', 'longHours']);
    m.moveCooldown = { bigSale: 99, longHours: 99 };
    nightAndMorning(s);
    expect(m.billboard).toBeTruthy();
    s.cash = 5000;
    expect(applyCommand(s, { type: 'billboard', siteId: m.billboard! }).ok).toBe(false);
  });

  it('at most one rival moves a day, and only the rivals stream is drawn on', () => {
    const s = openGame({ seed: 35, plotId: 'main', name: 'Busy' });
    openAll(s);
    rival(s, 'premium').reputation = 0.5;
    watchedDays(s, [{ priceIndex: 0.7, reputation: 0.9 }, { priceIndex: 0.7, reputation: 0.9 }, { priceIndex: 0.7, reputation: 0.9 }], { player: 80, discount: 10, premium: 10, chain: 20 });
    expect(s.rivals.filter((r) => triggeredMoves(s, r).length > 0).length).toBe(3);
    const before = { ...s.rng };
    for (let d = 0; d < 6; d++) {
      const plan = planRivals(s, s.day + 1);
      expect(plan.rivals.filter((p) => p.move).length).toBeLessThanOrEqual(1);
      s.day++; rivalDay(s, plan);
    }
    for (const k of Object.keys(before)) if (k !== 'rivals') expect(s.rng[k]).toBe(before[k]);
  });

  it('moves count down and fade: full strength, then fading over the last three days, then gone', () => {
    const s = openGame({ seed: 36, plotId: 'main', name: 'Fade' });
    const c = rival(s, 'discount');
    c.responses = [{ move: 'priceMatch', from: 10, until: 16 }];
    expect(computeMods(c, 9).price).toBe(0);
    expect(computeMods(c, 10).price).toBeCloseTo(0.05);
    expect(computeMods(c, 14).price).toBeCloseTo(0.05);
    expect(computeMods(c, 15).price).toBeLessThan(0.05);
    expect(computeMods(c, 16).price).toBeLessThan(computeMods(c, 15).price);
    expect(computeMods(c, 17).price).toBe(0);
    // And the morning after, the rival is back to its own self.
    openAll(s); s.day = 17; c.responses = [{ move: 'priceMatch', from: 10, until: 16 }];
    rivalDay(s, { rivals: [] });
    expect(c.responses).toEqual([]);
    expect(c.mods!.price).toBe(0);
  });
});

describe('why shoppers chose a store', () => {
  it('names the two scores that weigh most for each type', () => {
    const ones: StoreScores = { price: 1, availability: 1, layout: 1, wait: 1, parking: 1, awareness: 1 };
    expect(explainChoice('bargain', ones)).toEqual(['price', 'awareness']);
    expect(explainChoice('convenience', ones)).toEqual(['wait', 'availability']);
    expect(explainChoice('loyalist', ones)).toEqual(['availability', 'awareness']);
    expect(explainChoice('impulse', ones)).toEqual(['layout', 'awareness']);
    // A store that is cheap but badly stocked: a bargain hunter still came for the price, a loyalist for its awareness.
    const cheap: StoreScores = { price: 1, availability: 0.1, layout: 0.5, wait: 0.5, parking: 0.5, awareness: 0.6 };
    expect(explainChoice('bargain', cheap)).toEqual(['price', 'awareness']);
    expect(explainChoice('loyalist', cheap)).toEqual(['awareness', 'price']);
    // Always the two biggest weight × score contributions.
    for (const t of Object.keys(TYPE_WEIGHTS) as CustomerType[]) {
      const two = explainChoice(t, cheap), w = TYPE_WEIGHTS[t];
      const all = (Object.keys(w) as (keyof StoreScores)[]).map((k) => w[k] * cheap[k]).sort((a, b) => b - a);
      expect(w[two[0]!] * cheap[two[0]!]).toBeCloseTo(all[0]!);
      expect(w[two[1]!] * cheap[two[1]!]).toBeCloseTo(all[1]!);
    }
  });

  it('every shopper carries their reasons from the moment they set out, and the panel says them in plain words', () => {
    const s = openGame({ seed: 37, plotId: 'main', name: 'Why' });
    openAll(s);
    const p = spawnCustomer(s, true)!;
    expect(p.store).toBe('player');
    expect(p.why).toEqual(explainChoice(p.ctype!, computeScores(s)));
    spawnRivalShopper(s, rival(s, 'discount'));
    const q = s.people[s.people.length - 1]!;
    expect(q.rivalId).toBe('discount');
    expect(q.ctype).toBeTruthy();
    expect(q.why?.length).toBe(2);
    // Walk them through a while: our customer's panel shows the list, basket and patience; theirs says why Cheapo.
    for (let i = 0; i < 120 / TICK; i++) { tick(s); if (i % 6 === 0) applyCommand(s, { type: 'scan' }); }
    const mine = s.people.find((x) => x.kind === 'customer' && (x.listIdx ?? 0) > 0) ?? p;
    const info = inspectPerson(s, mine.id);
    if (info) {
      expect(info.kind).toBe('customer');
      expect(info.whyLabel).toBe('Came here because…');
      expect(info.why?.length).toBe(2);
      expect(info.list?.length).toBeGreaterThan(0);
      expect(info.name).toMatch(/^\w+ \w+$/);
    }
    const theirs = s.people.find((x) => x.rivalId === 'discount');
    if (theirs) {
      const t = inspectPerson(s, theirs.id)!;
      expect(t.kind).toBe('shopper');
      expect(t.whyLabel).toMatch(/Cheapo because…$/);
      expect(t.why!.every((w) => w.length > 3)).toBe(true);
    }
    // Staff show their job; you are not inspectable.
    expect(inspectPerson(s, s.people.find((x) => x.kind === 'owner')!.id)).toBeNull();
  });
});
