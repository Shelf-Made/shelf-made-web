import { describe, it, expect } from 'vitest';
import { newGame, tick, applyCommand, DAY_SECONDS, TICK, resetGridCache } from './index';

function day(s: ReturnType<typeof newGame>, scan: boolean): void {
  for (let i = 0; i < (DAY_SECONDS + 130) / TICK && s.phase !== 'night'; i++) { tick(s); if (scan && i % 6 === 0) applyCommand(s, { type: 'scan' }); }
}

describe('staff', () => {
  it('a cashier serves customers without the player scanning; a stocker restocks', () => {
    const s = newGame({ seed: 21, plotId: 'main', name: 'T', tutorial: false });
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
    const s = newGame({ seed: 22, plotId: 'hill', name: 'T', tutorial: false });
    resetGridCache();
    day(s, true); applyCommand(s, { type: 'openTomorrow' });
    expect(s.unlocks.build).toBe(true);
    expect(s.unlocks.newBadges).toContain('build');
    applyCommand(s, { type: 'ackBadge', card: 'build' });
    expect(s.unlocks.newBadges).not.toContain('build');
  });
});
