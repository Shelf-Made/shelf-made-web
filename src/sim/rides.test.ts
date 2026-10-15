import { describe, it, expect } from 'vitest';
import { applyCommand, tick, TICK, type GameState } from './index';
import { openGame } from './testUtil';
import { toWorld, zOnLevel } from './layout';
import { fixtureFacingWorld } from './grid';
import { levelOfPerson } from './storeys';
import type { FixtureType, Person } from './types';

function shop(seed: number): GameState {
  const s = openGame({ seed, plotId: 'main', name: 'Upstairs', tutorial: false });
  s.cash = 50000;
  return s;
}
const place = (s: GameState, fixtureType: FixtureType, x: number, z: number, rot: 0 | 1 | 2 | 3 = 0) => applyCommand(s, { type: 'placeFixture', fixtureType, x, z, rot });
/** Stairs (or an escalator, or a lift) beside the counter: the foot a tile in from the door, the top a tile behind them. */
const STAIRS = { x: 0.5, z: -2 };
const owner = (s: GameState) => s.people.find((p) => p.kind === 'owner')!;
const put = (p: Person, at: { x: number; z: number }) => { p.x = p.px = at.x; p.z = p.pz = at.z; };
/** Into the stairs from their foot (against the way they face). */
const into = (s: GameState) => { const f = fixtureFacingWorld(s.shop, 0); return { x: -f.x, z: -f.z }; };
const foot = (s: GameState) => toWorld(s.shop, STAIRS.x + 0.5, STAIRS.z + 1.5);
const run = (s: GameState, secs: number, until?: () => boolean) => { for (let i = 0; i < secs / TICK; i++) { tick(s); if (until?.()) return; } };

describe('riding the stairs with the keys', () => {
  it('carries the manager to the top once on, whatever the keys do (let go, or a card opened)', () => {
    const s = shop(71);
    expect(place(s, 'stairs', STAIRS.x, STAIRS.z).ok).toBe(true);
    const o = owner(s);
    put(o, foot(s));
    const d = into(s);
    applyCommand(s, { type: 'moveDir', x: d.x, z: d.z });
    run(s, 0.2);
    expect(o.climb).toBeDefined();
    // Let go a step onto the stairs (a card opening does the same).
    applyCommand(s, { type: 'moveDir', x: 0, z: 0 });
    run(s, 4, () => o.climb === undefined);
    expect(o.climb).toBeUndefined();
    expect(levelOfPerson(s.shop, o)).toBe(1);
    // The keys walk them on along the floor up there...
    const at = { x: o.x, z: o.z };
    applyCommand(s, { type: 'moveDir', x: d.x, z: d.z });
    run(s, 0.5);
    expect(Math.hypot(o.x - at.x, o.z - at.z)).toBeGreaterThan(0.4);
    applyCommand(s, { type: 'moveDir', x: 0, z: 0 });
    // ...and Use at the top takes them back down.
    const stairs = s.shop.fixtures.find((f) => f.type === 'stairs')!;
    put(o, toWorld(s.shop, STAIRS.x + 0.5, zOnLevel(STAIRS.z - 1.5, 1)));
    expect(applyCommand(s, { type: 'ride', fixtureId: stairs.id }).ok).toBe(true);
    applyCommand(s, { type: 'moveDir', x: 0, z: 0 });
    run(s, 4, () => o.climb === undefined);
    expect(levelOfPerson(s.shop, o)).toBe(0);
  });
});
