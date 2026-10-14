import { openGame } from './testUtil';
import { describe, it, expect } from 'vitest';
import { tick, applyCommand, DAY_SECONDS, TICK, resetGridCache, type GameState } from './index';

function day(s: GameState): void {
  for (let i = 0; i < (DAY_SECONDS + 130) / TICK && s.phase !== 'night'; i++) { tick(s); if (i % 6 === 0) applyCommand(s, { type: 'scan' }); }
}

describe('franchises and checkout', () => {
  it('a branch reports every night and pays or costs money', () => {
    const s = openGame({ seed: 31, plotId: 'main', name: 'Corner', tutorial: false });
    resetGridCache();
    s.cash = 6000;
    while (!s.staffPool.some((c) => c.role === 'manager')) { day(s); applyCommand(s, { type: 'openTomorrow' }); }
    const m = s.staffPool.find((c) => c.role === 'manager')!;
    expect(applyCommand(s, { type: 'openFranchise', plotId: 'hill', managerId: m.id }).ok).toBe(true);
    expect(s.franchises.length).toBe(1);
    day(s);
    expect(s.franchises[0]!.history.length).toBe(1);
    expect(s.notices.some((n) => n.text.includes('Corner Hillside'))).toBe(true);
  });
  it('card fees land in other costs and kiosks serve without a cashier', () => {
    const s = openGame({ seed: 32, plotId: 'east', name: 'T', tutorial: false });
    resetGridCache();
    s.cash = 3000;
    const reg = s.shop.fixtures.find((f) => f.type === 'register')!;
    expect(applyCommand(s, { type: 'placeFixture', fixtureType: 'kiosk', x: 0.5, z: -2, rot: 2 }).ok).toBe(true);
    // Remove the staffed register so everyone must use the kiosk.
    s.shop.fixtures = s.shop.fixtures.filter((f) => f.id !== reg.id);
    s.shop.layoutVersion++;
    for (let i = 0; i < 8000; i++) tick(s);
    expect(s.today.served).toBeGreaterThan(3);
    expect(s.today.other).toBeGreaterThan(0);
    expect(s.stuckRescues).toBe(0);
  });
});
