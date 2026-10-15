import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { tick, applyCommand, DAY_SECONDS, TICK, type GameState } from './index';
import { GOALS, activeGoal, checkGoals, trackGoals, weekShare } from './goals';
import { rivalsNight, closeRival, forSale, BROKE_DAYS_TO_CLOSE, CHALLENGER_AFTER } from './rivals';
import { planDay } from './economy';
import { formatMoney, dollars } from './money';
import { nightReport, complaintsOf } from './report';
import { emptyDayStats } from './newGame';
import type { Candidate, DayStats } from './types';

function playDay(s: GameState, scan = true): void {
  for (let i = 0; i < (DAY_SECONDS + 130) / TICK && s.phase !== 'night'; i++) { tick(s); if (scan && i % 6 === 0) applyCommand(s, { type: 'scan' }); }
}
const atGoal = (s: GameState, id: string) => { s.goals.index = GOALS.findIndex((g) => g.id === id); s.goals.run = 0; };
const manager = (s: GameState): Candidate => { const c: Candidate = { id: s.nextId++, name: 'Robin', role: 'manager', skill: 0.7, speed: 1, wage: 80, look: { model: 1, variant: 0, height: 1 } }; s.staffPool.push(c); return c; };
const cheapo = (s: GameState) => s.rivals.find((r) => r.id === 'discount')!;

describe('the goal ladder', () => {
  it('starts at the first goal and completes "Open your doors" as the thirtieth customer is served', () => {
    const s = openGame({ seed: 3, plotId: 'main', name: 'Goals' });
    expect(activeGoal(s)?.id).toBe('doors');
    const cash = s.cash;
    s.today.served = 30;
    for (let i = 0; i < 25; i++) tick(s);
    expect(s.goals.done.map((d) => d.id)).toContain('doors');
    expect(activeGoal(s)?.id).toBe('regulars');
    expect(s.cash).toBeGreaterThanOrEqual(cash + 100 - 5);
    expect(s.goals.celebrate?.id).toBe('doors');
  });

  it('"Regulars" needs 60% reputation, checked at close, and unlocks lit sign letters', () => {
    const s = openGame({ seed: 4, plotId: 'main', name: 'Goals' });
    atGoal(s, 'regulars');
    s.shop.reputation = 0.59; checkGoals(s, 'night');
    expect(activeGoal(s)?.id).toBe('regulars');
    s.shop.reputation = 0.6; checkGoals(s, 'now');
    expect(activeGoal(s)?.id).toBe('regulars');
    checkGoals(s, 'night');
    expect(activeGoal(s)?.id).toBe('cheapo');
    expect(s.goals.unlocked).toContain('signLit');
    expect(applyCommand(s, { type: 'signStyle', style: 'lit' }).ok).toBe(true);
  });

  it('"Beat the discounter" needs three nights running ahead of Cheapo; a night behind starts again', () => {
    const s = openGame({ seed: 5, plotId: 'main', name: 'Goals' });
    atGoal(s, 'cheapo');
    const c = cheapo(s);
    const night = (mine: number, theirs: number) => { s.today.revenue = mine; c.lastSales = theirs; trackGoals(s); checkGoals(s, 'night'); };
    c.open = false; night(500, 100);
    expect(s.goals.run).toBe(0); // Cheapo is not trading yet
    c.open = true;
    night(300, 200); night(300, 200);
    night(100, 200);
    expect(s.goals.run).toBe(0);
    night(300, 200); night(300, 200);
    expect(activeGoal(s)?.id).toBe('cheapo');
    const cash = s.cash;
    night(300, 200);
    expect(activeGoal(s)?.id).toBe('grocer');
    expect(s.cash).toBe(cash + 250);
  });

  it('"Neighbourhood grocer" needs the 7×7 shop and a $120 night', () => {
    const s = openGame({ seed: 6, plotId: 'main', name: 'Goals' });
    atGoal(s, 'grocer');
    s.phase = 'night';
    s.today.profit = 500; checkGoals(s, 'night');
    expect(activeGoal(s)?.id).toBe('grocer'); // still the starter shop
    s.cash = 5000; expect(applyCommand(s, { type: 'expandShop', sizeId: 'medium' }).ok).toBe(true);
    s.today.profit = 119; checkGoals(s, 'night');
    expect(activeGoal(s)?.id).toBe('grocer');
    s.today.profit = 120; checkGoals(s, 'night');
    expect(activeGoal(s)?.id).toBe('busiest');
    expect(s.goals.unlocked).toContain('openingEvent');
    expect(applyCommand(s, { type: 'openingEvent' }).ok).toBe(true);
    expect(s.marketing.openingEventDay).toBe(s.day + 1);
  });

  it('"Busiest corner" needs a third of the shoppers over the last seven competitive days', () => {
    const s = openGame({ seed: 7, plotId: 'main', name: 'Goals' });
    atGoal(s, 'busiest');
    const day = (n: number, sh: Record<string, number>): DayStats => ({ ...emptyDayStats(n), shoppers: sh });
    // Quiet first days (one rival) never count; six good competitive days are not yet a week.
    s.history = [day(1, { player: 90, discount: 10 }), ...Array.from({ length: 6 }, (_, i) => day(i + 2, { player: 40, discount: 30, premium: 30 }))];
    checkGoals(s, 'night');
    expect(activeGoal(s)?.id).toBe('busiest');
    expect(weekShare(s)?.days).toBe(6);
    s.history.push(day(8, { player: 30, discount: 30, premium: 30, chain: 40 }));
    expect(weekShare(s)!.share).toBeGreaterThan(1 / 3);
    checkGoals(s, 'night');
    expect(activeGoal(s)?.id).toBe('hall');
    // A week at a quarter would not have done it.
    const t = openGame({ seed: 7, plotId: 'main', name: 'Goals' });
    atGoal(t, 'busiest');
    t.history = Array.from({ length: 7 }, (_, i) => day(i + 1, { player: 25, discount: 25, premium: 25, chain: 25 }));
    checkGoals(t, 'night');
    expect(activeGoal(t)?.id).toBe('busiest');
  });

  it('"Market hall" completes as soon as the 9×8 hall has its doubled lot, and unlocks branches', () => {
    const s = openGame({ seed: 8, plotId: 'main', name: 'Goals' });
    atGoal(s, 'hall');
    s.cash = 9000;
    expect(applyCommand(s, { type: 'openFranchise', siteId: 'hillside', managerId: manager(s).id }).ok).toBe(false);
    applyCommand(s, { type: 'expandShop', sizeId: 'large' });
    checkGoals(s, 'now');
    expect(activeGoal(s)?.id).toBe('hall');
    applyCommand(s, { type: 'expandLot' });
    checkGoals(s, 'now');
    expect(activeGoal(s)?.id).toBe('own');
    expect(applyCommand(s, { type: 'openFranchise', siteId: 'hillside', managerId: manager(s).id }).ok).toBe(true);
  });

  it('"Own the crossroads": buying a closed corner earns the Champion ending and the sandbox', () => {
    const s = openGame({ seed: 9, plotId: 'main', name: 'Goals' });
    atGoal(s, 'own');
    const c = cheapo(s); c.open = true;
    closeRival(s, c);
    s.cash = 9000;
    expect(applyCommand(s, { type: 'buyCorner', rivalId: c.id, managerId: manager(s).id }).ok).toBe(true);
    checkGoals(s, 'now');
    expect(activeGoal(s)).toBeNull();
    expect(s.goals.champion).toBe(true);
    expect(s.sandbox).toBe(true);
    applyCommand(s, { type: 'ackChampion' });
    expect(s.goals.championSeen).toBe(true);
  });
});

describe('rivals close, their corners sell, challengers move in', () => {
  it('a rival in the red for five closing nights shuts, and only one rival is closed at a time', () => {
    const s = openGame({ seed: 11, plotId: 'main', name: 'Squeeze' });
    for (const r of s.rivals) r.open = true;
    const c = cheapo(s), p = s.rivals.find((r) => r.id === 'premium')!;
    c.cash = -100000; p.cash = -100000;
    for (let i = 1; i < BROKE_DAYS_TO_CLOSE; i++) { rivalsNight(s); expect(c.closedDay).toBeUndefined(); expect(c.brokeDays).toBe(i); }
    rivalsNight(s);
    const closed = s.rivals.filter((r) => r.closedDay !== undefined);
    expect(closed.length).toBe(1);
    expect(closed[0]!.open).toBe(false);
    expect(s.notices.some((n) => n.text.includes('has closed for good'))).toBe(true);
    // The other one is broke too, but waits its turn.
    for (let i = 0; i < 3; i++) rivalsNight(s);
    expect(s.rivals.filter((r) => r.closedDay !== undefined).length).toBe(1);
    // A rival back in the black starts counting again.
    const m = s.rivals.find((r) => r.id === 'chain')!; m.cash = -1; m.brokeDays = 4; m.cash = 100000;
    rivalsNight(s);
    expect(m.brokeDays).toBe(0);
  });

  it("a closed rival's corner can be bought (and only then) and trades as the player's branch", () => {
    const s = openGame({ seed: 12, plotId: 'main', name: 'Buyer' });
    for (const r of s.rivals) r.open = true;
    s.cash = 20000;
    const c = cheapo(s);
    expect(applyCommand(s, { type: 'buyCorner', rivalId: c.id, managerId: manager(s).id }).ok).toBe(false);
    closeRival(s, c);
    expect(forSale(s)).toBe(c);
    expect(applyCommand(s, { type: 'buyCorner', rivalId: c.id, managerId: 999999 }).ok).toBe(false); // nobody to run it
    const cash = s.cash;
    expect(applyCommand(s, { type: 'buyCorner', rivalId: c.id, managerId: manager(s).id }).ok).toBe(true);
    expect(s.cash).toBeLessThan(cash);
    expect(c.boughtDay).toBe(s.day);
    expect(forSale(s)).toBeUndefined();
    const f = s.franchises.find((x) => x.corner === c.corner)!;
    expect(f).toBeTruthy();
    // It reports at night like any branch, and counts as the player's at the crossroads.
    playDay(s);
    expect(f.history.length).toBe(1);
    expect(s.history[s.history.length - 1]!.shoppers![`corner-${c.corner}`]).toBeGreaterThan(0);
    // Ten days on, nobody moves in: it is the player's.
    s.day += CHALLENGER_AFTER + 1; rivalsNight(s);
    expect(s.rivals.some((r) => r.challenger)).toBe(false);
  });

  it('an empty corner gets a challenger after ten days, who opens the next morning', () => {
    const s = openGame({ seed: 13, plotId: 'main', name: 'Challenged' });
    for (const r of s.rivals) r.open = true;
    const c = cheapo(s); const corner = c.corner;
    closeRival(s, c);
    s.day += CHALLENGER_AFTER - 1; rivalsNight(s);
    expect(s.rivals.some((r) => r.challenger)).toBe(false);
    s.day += 1; rivalsNight(s);
    const ch = s.rivals.find((r) => r.challenger)!;
    expect(ch).toBeTruthy();
    expect(ch.corner).toBe(corner);
    expect(ch.name).not.toBe('Cheapo');
    expect(ch.open).toBe(false);
    expect(s.rivals.length).toBe(3);
    // Tonight's plan says so, and the morning opens it.
    s.phase = 'night'; s.tomorrow = planDay(s, s.day + 1);
    expect(s.tomorrow.rivals.find((r) => r.id === ch.id)?.opens).toBe(true);
    expect(s.tomorrow.rumours.some((t) => t.includes(ch.name))).toBe(true);
    applyCommand(s, { type: 'openTomorrow' });
    expect(ch.open).toBe(true);
  });
});

describe('the night card', () => {
  it('counts complaints as they happen: empty shelves, high prices, a full lot, long waits, a messy floor', () => {
    const s = openGame({ seed: 21, plotId: 'main', name: 'Grumbles' });
    // Half the shelves bare, prices doubled on the rest, the lot full, a messy floor, and nobody scanning.
    s.shop.fixtures.forEach((f, i) => f.slots.forEach((sl) => { if (i % 2) sl.qty = 0; }));
    for (const id of Object.keys(s.prices)) s.prices[id] = s.prices[id]! * 2.4;
    for (const b of s.shop.bays) b.carId = -7;
    s.shop.cleanliness = 0.3;
    playDay(s, false);
    const d = s.history[s.history.length - 1]!;
    const c = d.complaints;
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(sum(c.outOfStock)).toBe(d.missedItems);
    expect(sum(c.pricey)).toBeGreaterThan(0);
    expect(c.lotFull).toBe(d.turnedAway);
    expect(c.lotFull).toBeGreaterThan(0);
    expect(c.queue).toBe(d.walkedOut);
    expect(c.dirty).toBeGreaterThan(0);
    // The card shows the top three in plain words, biggest first, each pointing at a card.
    const top = nightReport(s)!.complaints;
    expect(top.length).toBe(3);
    expect(top[0]!.count).toBeGreaterThanOrEqual(top[2]!.count);
    expect(complaintsOf(d).every((x) => ['stock', 'prices', 'staff', 'build'].includes(x.card))).toBe(true);
  });

  it("tomorrow's preview is what actually happens the next day", () => {
    const s = openGame({ seed: 22, plotId: 'main', name: 'Forecast' });
    let sales = 0, weather = 0;
    for (let day = 0; day < 16; day++) {
      playDay(s);
      const plan = s.tomorrow!;
      expect(plan.day).toBe(s.day + 1);
      // The night card shares across the crossroads add up.
      const shares = nightReport(s)!.shares;
      expect(shares.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1, 5);
      applyCommand(s, { type: 'openTomorrow' });
      expect(s.tomorrow).toBeNull();
      expect(s.eventDemand).toBe(plan.eventDemand);
      for (const p of plan.rivals) {
        const r = s.rivals.find((x) => x.id === p.id)!;
        if (p.opens) expect(r.open).toBe(true);
        if (p.sale) { expect(r.saleDaysLeft).toBe(p.sale); sales++; }
      }
      if (plan.weather) { expect(s.notices.some((n) => n.day === s.day && n.text === plan.weather)).toBe(true); weather++; }
      for (const r of s.rivals) if (r.open && r.saleDaysLeft > 0 && !plan.rivals.find((p) => p.id === r.id)?.sale) expect(r.saleDaysLeft).toBeLessThan(2);
    }
    expect(sales).toBeGreaterThan(0);
    expect(weather).toBeGreaterThan(0);
  });

  it("keeps every day's log: each night card can be read again later, as it was that night", () => {
    const s = openGame({ seed: 23, plotId: 'main', name: 'Logbook' });
    const seen: { day: number; profit: number; goal: string | undefined; forecast: string | null | undefined }[] = [];
    for (let day = 0; day < 6; day++) {
      playDay(s);
      const r = nightReport(s)!;
      expect(r.latest).toBe(true);
      seen.push({ day: r.day, profit: r.profit, goal: r.goal?.text, forecast: r.tomorrow?.weather });
      applyCommand(s, { type: 'openTomorrow' });
    }
    expect(s.history.length).toBe(6);
    for (const was of seen) {
      const r = nightReport(s, was.day)!;
      expect(r.latest).toBe(false);
      expect(r.day).toBe(was.day);
      expect(r.profit).toBe(was.profit);
      expect(r.goal?.text).toBe(was.goal);
      expect(r.tomorrow?.weather).toBe(was.forecast);
      expect(r.cash).toBe(s.history.find((h) => h.day === was.day)!.endCash);
    }
    expect(nightReport(s, 99)).toBeNull();
    // Saves from before the logs were kept still read back: just without the goal and forecast.
    delete s.history[0]!.log;
    expect(nightReport(s, 1)).toMatchObject({ day: 1, goal: null, tomorrow: null });
  });

  it('formats money one way, sign before the dollar', () => {
    expect(formatMoney(-140, { cents: false })).toBe('-$140');
    expect(dollars(-140)).toBe('-$140');
    expect(formatMoney(-46.7)).toBe('-$46.70');
    expect(formatMoney(1234.5)).toBe('$1,234.50');
    expect(formatMoney(12, { sign: true })).toBe('+$12.00');
    expect(formatMoney(-0.001)).toBe('$0.00');
    expect(dollars(1500000, true)).toBe('+$1,500,000');
  });
});
