import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { applyCommand } from './index';
import { wallSegments, floorTileCount, levelOfZ } from './layout';
import { canPushWall, wallRun } from './build';
import type { GameState } from './types';

const sideWall = (s: GameState, dir: 'left' | 'right' | 'back' | 'front') => wallSegments(s.shop).filter((w) => w.dir === dir && levelOfZ(w.axis === 'x' ? w.line - 0.5 : w.t) === 0).sort((a, b) => a.t - b.t)[1]!;

describe('moving a wall', () => {
  it('pushes a side wall out a whole row, and pulls it back in, never for a profit', () => {
    const s = openGame({ seed: 41, plotId: 'main', name: 'Walls' });
    s.cash = 50_000;
    const n0 = floorTileCount(s.shop), cash0 = s.cash, w = sideWall(s, 'left');
    const run = wallRun(s.shop, w.key)!;
    expect(run.outside.length).toBeGreaterThan(1);
    const check = canPushWall(s, w.key);
    expect(check.ok).toBe(true);
    expect(applyCommand(s, { type: 'pushWall', key: w.key }).ok).toBe(true);
    const grown = floorTileCount(s.shop) - n0;
    expect(grown).toBe(run.outside.length);
    expect(cash0 - s.cash).toBe(check.price);
    // Pulled back in, from the wall where it now stands: smaller again, some money back, never more than was paid.
    const back = sideWall(s, 'left');
    expect(applyCommand(s, { type: 'pullWall', key: back.key }).ok).toBe(true);
    expect(floorTileCount(s.shop)).toBeLessThan(n0 + grown);
    expect(s.cash).toBeLessThan(cash0);
  });

  it('leaves the front wall where it is', () => {
    const s = openGame({ seed: 42, plotId: 'main', name: 'Walls' });
    s.cash = 50_000;
    const n0 = floorTileCount(s.shop);
    const r = applyCommand(s, { type: 'pushWall', key: sideWall(s, 'front').key });
    expect(r.ok).toBe(false);
    expect(r.message).toBe('The front wall stays where it is');
    expect(floorTileCount(s.shop)).toBe(n0);
  });

  it('pushes only as far as the money goes', () => {
    const s = openGame({ seed: 43, plotId: 'main', name: 'Walls' });
    const w = sideWall(s, 'left'), n0 = floorTileCount(s.shop);
    s.cash = 100; // about two tiles' worth
    expect(applyCommand(s, { type: 'pushWall', key: w.key }).ok).toBe(true);
    expect(floorTileCount(s.shop) - n0).toBeGreaterThan(0);
    expect(floorTileCount(s.shop) - n0).toBeLessThan(wallRun(s.shop, sideWall(s, 'left').key)!.outside.length + 3);
    expect(s.cash).toBeGreaterThanOrEqual(0);
  });
});
