import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { applyCommand, tick, TICK, type GameState } from './index';
import { floorTileList, wallSegments, tileKey, refundOf, FIXTURES, CHANGED_MIND, DAY_SECONDS } from './layout';

describe('paint, pictures, looks and refunds', () => {
  it('paints a tile any colour, repaints it another for just the paint, and the eyedropper colour is kept', () => {
    const s = openGame({ seed: 50, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 999;
    const t = floorTileList(s.shop)[3]!;
    expect(applyCommand(s, { type: 'paintFloor', x: t.x, z: t.z, style: 'paint', colour: '#123456' }).ok).toBe(true);
    expect(s.shop.tileColors?.[tileKey(t.x, t.z)]).toBe('#123456');
    const cash = s.cash;
    expect(applyCommand(s, { type: 'paintFloor', x: t.x, z: t.z, style: 'paint', colour: '#123456' }).ok).toBe(false);
    expect(applyCommand(s, { type: 'paintFloor', x: t.x, z: t.z, style: 'paint', colour: '#ABCDEF' }).ok).toBe(true);
    expect(cash - s.cash).toBe(4);
    // Another finish takes the paint off.
    expect(applyCommand(s, { type: 'paintFloor', x: t.x, z: t.z, style: 'marble' }).ok).toBe(true);
    expect(s.shop.tileColors?.[tileKey(t.x, t.z)]).toBeUndefined();
    // A wall too.
    const w = wallSegments(s.shop)[0]!;
    expect(applyCommand(s, { type: 'paintWall', key: w.key, style: 'paint', colour: '#FF00AA' }).ok).toBe(true);
    expect(s.shop.wallColors?.[w.key]).toBe('#FF00AA');
  });

  it('lays your own picture once you have chosen one (a small one)', () => {
    const s = openGame({ seed: 51, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 999;
    const t = floorTileList(s.shop)[2]!;
    expect(applyCommand(s, { type: 'paintFloor', x: t.x, z: t.z, style: 'photo' }).message).toMatch(/picture first/);
    expect(applyCommand(s, { type: 'setFloorImage', dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(200_000) }).ok).toBe(false);
    expect(applyCommand(s, { type: 'setFloorImage', dataUrl: 'data:image/jpeg;base64,AAAA' }).ok).toBe(true);
    expect(applyCommand(s, { type: 'paintFloor', x: t.x, z: t.z, style: 'photo' }).ok).toBe(true);
  });

  // A plant put down on the first free tile.
  const plant = (s: GameState, variant?: number) => {
    const f = s.shop.floor;
    for (let z = f.z0; z < f.z1; z++) for (let x = f.x0; x < f.x1; x++) if (applyCommand(s, { type: 'placeFixture', fixtureType: 'plant', x, z, rot: 0, variant }).ok) return s.shop.fixtures[s.shop.fixtures.length - 1]!;
    throw new Error('nowhere for a plant');
  };
  const sell = (s: GameState, id: number) => { const cash = s.cash; expect(applyCommand(s, { type: 'removeFixture', fixtureId: id }).ok).toBe(true); return s.cash - cash; };
  const ahead = (s: GameState, seconds: number) => { for (let i = 0; i < seconds / TICK && s.phase !== 'night'; i++) tick(s); };

  it('a piece sold just after it was bought fetches all it cost; once it has traded, 60%', () => {
    const s = openGame({ seed: 52, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 999;
    const placed = plant(s, 2);
    expect(placed.variant).toBe(2);
    expect(refundOf(placed, s)).toBe(FIXTURES.plant.price);
    expect(refundOf(placed, { day: s.day + 1, time: 0 })).toBe(Math.round(FIXTURES.plant.price * 0.6));
    expect(sell(s, placed.id)).toBe(FIXTURES.plant.price);
    // A few minutes of trading: still a change of mind. A while longer: it has done its job, 60% back.
    const again = plant(s);
    ahead(s, CHANGED_MIND - 1);
    expect(refundOf(again, s)).toBe(FIXTURES.plant.price);
    ahead(s, 2);
    expect(sell(s, again.id)).toBe(Math.round(FIXTURES.plant.price * 0.6));
  });

  it('a piece put in for the day and sold that night fetches 60%, but one put in at night is all back till the doors open', () => {
    const s = openGame({ seed: 53, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 999;
    // Put in as the doors open, and sold once the day is done: it traded all day.
    const morning = plant(s);
    ahead(s, DAY_SECONDS + 130);
    expect(s.phase).toBe('night');
    expect(s.today.customers).toBeGreaterThan(0);
    expect(sell(s, morning.id)).toBe(Math.round(FIXTURES.plant.price * 0.6));
    // Put in at night: the clock stands still with the doors shut, so it is all back however long you think.
    const night = plant(s);
    for (let i = 0; i < 600; i++) tick(s);
    expect(refundOf(night, s)).toBe(FIXTURES.plant.price);
    // The doors open on it: from then on it is in use like any other piece.
    expect(applyCommand(s, { type: 'openTomorrow' }).ok).toBe(true);
    ahead(s, CHANGED_MIND + 1);
    expect(sell(s, night.id)).toBe(Math.round(FIXTURES.plant.price * 0.6));
  });
});
