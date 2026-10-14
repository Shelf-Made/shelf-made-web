import { openGame } from './testUtil';
import { describe, it, expect } from 'vitest';
import { tick, applyCommand, computeScores, playerShare, DAY_SECONDS, TICK, resetGridCache } from './index';

describe('customers and rivals', () => {
  it('prices move the price score and bargain share', () => {
    const s = openGame({ seed: 9, plotId: 'main', name: 'T' });
    s.rivals[0]!.open = true;
    const before = playerShare(s).bargain;
    for (const id of Object.keys(s.prices)) applyCommand(s, { type: 'setPrice', productId: id, price: s.prices[id]! * 1.4 });
    expect(computeScores(s).price).toBeLessThan(0.3);
    expect(playerShare(s).bargain).toBeLessThan(before);
  });
  it('rivals open on schedule and run sales', () => {
    const s = openGame({ seed: 4, plotId: 'main', name: 'T' });
    resetGridCache();
    for (let day = 1; day <= 4; day++) {
      for (let i = 0; i < (DAY_SECONDS + 130) / TICK && s.phase !== 'night'; i++) { tick(s); if (i % 6 === 0) applyCommand(s, { type: 'scan' }); }
      applyCommand(s, { type: 'openTomorrow' });
    }
    expect(s.rivals.find((r) => r.id === 'discount')!.open).toBe(true);
    expect(s.notices.some((n) => /opened/.test(n.text))).toBe(true);
    expect(s.stuckRescues).toBe(0);
  });
  it('customers respect budgets and the shop records misses', () => {
    const s = openGame({ seed: 2, plotId: 'bus', name: 'T' });
    resetGridCache();
    for (let i = 0; i < 6000; i++) { tick(s); if (i % 4 === 0) applyCommand(s, { type: 'scan' }); }
    expect(s.today.served).toBeGreaterThan(3);
    expect(s.scores.waitSamples).toBeGreaterThan(0);
  });
});
