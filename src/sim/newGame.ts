import type { GameState, Difficulty, Shop, Fixture, Person, DayStats, Slot } from './types';
import { PLOTS, STARTER, DIFFICULTY, FIXTURES, storeOrigin } from './layout';
import { PRODUCTS, STARTER_SHELF, STARTER_FRIDGE } from './products';
import { Rng } from './rng';
import { makeRivals } from './rivals';
import { makeMarket } from './market';

export const SAVE_VERSION = 3;

export function emptyDayStats(day: number): DayStats {
  return { day, revenue: 0, cogs: 0, rent: 0, wages: 0, utilities: 0, other: 0, loans: 0, bills: 0, theft: 0, tax: 0, customers: 0, served: 0, walkedOut: 0, turnedAway: 0, missedItems: 0, itemsSold: 0, satisfaction: 0, satisfactionN: 0, profit: 0, endCash: 0 };
}

function makeFixture(id: number, type: Fixture['type'], x: number, z: number, rot: Fixture['rot']): Fixture {
  const def = FIXTURES[type];
  const slots: Slot[] = Array.from({ length: def.slots }, () => ({ productId: null, qty: 0 }));
  const f: Fixture = { id, type, x, z, rot, slots };
  if (type === 'register' || type === 'kiosk') { f.queue = []; f.serving = null; f.scanned = 0; f.staffId = null; }
  return f;
}

export function makeShop(plotId: string, name: string): Shop {
  const plot = PLOTS.find((p) => p.id === plotId) ?? PLOTS[0]!;
  const o = storeOrigin(plot.x);
  const register = makeFixture(1, 'register', 1.5, -2, 2);
  const shelf = makeFixture(2, 'shelf', -1.5, -4, 0);
  const fridge = makeFixture(3, 'fridge', -2.5, -3, 1);
  const baskets = makeFixture(4, 'basketStack', -2.5, -1, 1);
  const plant = makeFixture(5, 'plant', -2.5, -4, 0);
  STARTER_SHELF.forEach((pid, i) => { shelf.slots[i] = { productId: pid, qty: 4 }; });
  STARTER_FRIDGE.forEach((pid, i) => { fridge.slots[i] = { productId: pid, qty: 3 }; });
  return {
    name, plotId: plot.id, originX: o.x, originZ: o.z,
    floor: { ...STARTER.floor }, storeroom: { ...STARTER.storeroom }, door: { ...STARTER.door }, backDoor: { ...STARTER.backDoor },
    fixtures: [register, shelf, fridge, baskets, plant],
    storage: [{ productId: 'pasta', qty: 8, day: 1 }, { productId: 'beans', qty: 8, day: 1 }, { productId: 'cola', qty: 6, day: 1 }, { productId: 'bread', qty: 6, day: 1 }],
    storageCapacity: 120,
    bays: STARTER.bays.map((b) => ({ x: o.x + b.x, z: o.z + b.z, yaw: b.yaw, carId: null })),
    reputation: 0.5, awareness: 0.35, cleanliness: 1, layoutVersion: 1,
  };
}

export function makeOwner(id: number, shop: Shop, rng: Rng): Person {
  const reg = shop.fixtures.find((f) => f.type === 'register')!;
  const x = shop.originX + reg.x + 0.5, z = shop.originZ + reg.z + 0.5 + 1;
  return {
    id, kind: 'owner', look: { model: 12, variant: rng.int(0, 3), height: 1 },
    x, z, yaw: Math.PI, px: x, pz: z, state: 'idle', anim: 'idle', path: [], pathIdx: 0, speed: 1.7, timer: 0,
    task: null, carrying: null, name: 'You', role: 'cashier', skill: 0.6, morale: 1, wage: 0,
  };
}

export function newGame(opts: { seed: number; difficulty?: Difficulty; sandbox?: boolean; plotId?: string; name?: string; tutorial?: boolean }): GameState {
  const difficulty = opts.difficulty ?? 'standard';
  const d = DIFFICULTY[difficulty];
  const rng = new Rng(opts.seed);
  const picked = opts.plotId !== undefined;
  const shop = makeShop(opts.plotId ?? 'main', opts.name ?? 'Shelf Made');
  const prices: Record<string, number> = {};
  for (const p of PRODUCTS) prices[p.id] = p.basePrice;
  const state: GameState = {
    version: SAVE_VERSION, seed: opts.seed, difficulty, sandbox: opts.sandbox ?? false,
    tick: 0, day: 1, time: 0, phase: picked ? 'open' : 'picking',
    cash: opts.sandbox ? 50000 : d.cash,
    shop, prices, people: [], cars: [], orders: [],
    today: emptyDayStats(1), history: [], popups: [],
    tutorial: { enabled: opts.tutorial ?? !opts.sandbox, step: 0, done: false, completed: [], rewardsPaid: 0 },
    unlocks: { prices: true, stock: true, build: opts.sandbox ?? false, staff: opts.sandbox ?? false, marketing: opts.sandbox ?? false, stats: true, newBadges: [] },
    nextId: 100, rng: {}, sounds: [], stuckRescues: 0,
    spawn: { customer: 0, traffic: 0, walker: 0 }, townAvgIndex: 1,
    rivals: makeRivals(), scores: { avgWait: 20, waitSum: 0, waitSamples: 0, last: null }, notices: [], demandBase: 24, eventDemand: 1,
    market: makeMarket(), bills: [], loans: [], brokeDays: 0, rescueOffered: false, gameOver: false,
  };
  state.people.push(makeOwner(state.nextId++, shop, rng));
  return state;
}
