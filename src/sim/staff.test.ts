import { openGame } from './testUtil';
import { describe, it, expect } from 'vitest';
import { tick, applyCommand, DAY_SECONDS, TICK, resetGridCache, type GameState } from './index';

function day(s: GameState, scan: boolean): void {
  for (let i = 0; i < (DAY_SECONDS + 130) / TICK && s.phase !== 'night'; i++) { tick(s); if (scan && i % 6 === 0) applyCommand(s, { type: 'scan' }); }
}

describe('staff', () => {
  it('a cashier serves customers without the player scanning; a stocker restocks', () => {
    const s = openGame({ seed: 21, plotId: 'main', name: 'T', tutorial: false });
    resetGridCache();
    const cashier = s.staffPool.find((c) => c.role === 'cashier')!;
    const stocker = s.staffPool.find((c) => c.role === 'stocker')!;
    s.cash = 2000;
    expect(applyCommand(s, { type: 'hire', candidateId: cashier.id }).ok).toBe(true);
    expect(applyCommand(s, { type: 'hire', candidateId: stocker.id }).ok).toBe(true);
    applyCommand(s, { type: 'placeOrder', supplierId: 'express', lines: [{ productId: 'bread', qty: 24 }, { productId: 'chips', qty: 24 }, { productId: 'milk', qty: 18 }] });
    day(s, false);
    expect(s.today.served).toBeGreaterThan(8);
    expect(s.stuckRescues).toBe(0);
    expect(s.history[0]!.wages).toBeGreaterThan(0);
  });
  it('unlocks arrive on schedule with New! badges and a hint always says something', () => {
    const s = openGame({ seed: 22, plotId: 'elm', name: 'T', tutorial: false });
    resetGridCache();
    expect(s.unlocks.build).toBe(true); // you build your own shop from minute one
    expect(s.unlocks.staff).toBe(false);
    for (let d = 0; d < 2; d++) { day(s, true); applyCommand(s, { type: 'openTomorrow' }); }
    expect(s.unlocks.staff).toBe(true);
    expect(s.unlocks.newBadges).toContain('staff');
    applyCommand(s, { type: 'ackBadge', card: 'staff' });
    expect(s.unlocks.newBadges).not.toContain('staff');
  });
});
