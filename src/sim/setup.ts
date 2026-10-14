/**
 * A sensible first fit-out, used by tests, the balance harness and screenshot runs so they start
 * where a new player would after the first five minutes: a counter by the door, two shelves, a
 * chiller, stocked, doors open. Everything goes through the normal commands.
 */
import type { GameState } from './types';
import { applyCommand } from './commands';
import { STARTER_SHELF, STARTER_FRIDGE } from './products';
import { fixtureBackWorld } from './grid';

export function quickSetup(state: GameState, open = true): void {
  const cash = state.cash;
  state.cash += 2000; // fit-out is free here; the player's starting cash is left as it was
  const f = state.shop.floor;
  // Counter beside the door facing into the shop; the till is worked from the door side.
  const r1 = applyCommand(state, { type: 'placeFixture', fixtureType: 'register', x: f.x1 - 1, z: f.z1 - 3, rot: 2 });
  const r2 = applyCommand(state, { type: 'placeFixture', fixtureType: 'shelf', x: f.x0, z: f.z0 + 2, rot: 1 });
  const r3 = applyCommand(state, { type: 'placeFixture', fixtureType: 'shelf', x: f.x0, z: f.z0 + 3, rot: 1 });
  const r4 = applyCommand(state, { type: 'placeFixture', fixtureType: 'fridge', x: f.x1 - 1, z: f.z0, rot: 3 });
  for (const r of [r1, r2, r3, r4]) if (!r.ok) throw new Error(`quickSetup: ${r.message}`);
  const shelves = state.shop.fixtures.filter((x) => x.type === 'shelf');
  STARTER_SHELF.forEach((pid, i) => { const sh = shelves[Math.floor(i / 4)]; if (sh && sh.slots[i % 4]) sh.slots[i % 4] = { productId: pid, qty: 8 }; });
  const chiller = state.shop.fixtures.find((x) => x.type === 'fridge');
  if (chiller) STARTER_FRIDGE.forEach((pid, i) => { chiller.slots[i] = { productId: pid, qty: 6 }; });
  state.shop.storage = [{ productId: 'pasta', qty: 10, day: state.day }, { productId: 'bread', qty: 8, day: state.day }, { productId: 'chips', qty: 8, day: state.day }, { productId: 'milk', qty: 6, day: state.day }];
  state.cash = cash;
  const owner = state.people.find((p) => p.kind === 'owner');
  const reg = state.shop.fixtures.find((x) => x.type === 'register');
  if (owner && reg) { const b = fixtureBackWorld(state.shop, reg); owner.x = owner.px = b.x; owner.z = owner.pz = b.z; owner.path = []; owner.state = 'idle'; }
  // The fit-out stands in for ordering and stocking by hand, so those tips are behind you too.
  for (const step of ['order', 'stock']) if (!state.tutorial.completed.includes(step)) state.tutorial.completed.push(step);
  if (open && state.phase === 'setup') applyCommand(state, { type: 'openShop' });
}
