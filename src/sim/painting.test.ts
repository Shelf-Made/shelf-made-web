import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { applyCommand } from './index';
import { floorTileList, wallSegments, tileKey, refundOf, FIXTURES } from './layout';

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

  it('a piece sold the day it was bought fetches all it cost; later, 60%', () => {
    const s = openGame({ seed: 52, plotId: 'main', name: 'T', tutorial: false });
    s.cash = 999;
    const f = s.shop.floor;
    let placed = null as null | (typeof s.shop.fixtures)[number];
    for (let z = f.z0; z < f.z1 && !placed; z++) for (let x = f.x0; x < f.x1 && !placed; x++) if (applyCommand(s, { type: 'placeFixture', fixtureType: 'plant', x, z, rot: 0, variant: 2 }).ok) placed = s.shop.fixtures[s.shop.fixtures.length - 1]!;
    expect(placed!.variant).toBe(2);
    expect(refundOf(placed!, s.day)).toBe(FIXTURES.plant.price);
    expect(refundOf(placed!, s.day + 1)).toBe(Math.round(FIXTURES.plant.price * 0.6));
    const cash = s.cash;
    expect(applyCommand(s, { type: 'removeFixture', fixtureId: placed!.id }).ok).toBe(true);
    expect(s.cash - cash).toBe(FIXTURES.plant.price);
  });
});
