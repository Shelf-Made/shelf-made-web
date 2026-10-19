import { skyFor } from './weather';
import { bakeLot } from './drive';
import { wallsToPieces } from './build';
import type { GameState, Difficulty, Shop, Fixture, Person, DayStats, Slot } from './types';
import { DEFAULT_SCHEME, schemeById } from './schemes';
import { PLOTS, STARTER, DIFFICULTY, FIXTURES, storeFrame, lotLayout, deliveryZone, toWorld, yawToWorld, STREET_BAYS, floorTileList, tileKey } from './layout';
import { PRODUCTS } from './products';
import { Rng } from './rng';
import { makeRivals } from './rivals';
import { makeMarket } from './market';
import { DEFAULT_RULES, refreshPool } from './staff';
import { makeMarketing } from './marketing';
import { SANDBOX_CASH } from './money';

export const SAVE_VERSION = 12;

export function emptyDayStats(day: number): DayStats {
  return { day, revenue: 0, cogs: 0, rent: 0, wages: 0, utilities: 0, other: 0, loans: 0, bills: 0, theft: 0, tax: 0, customers: 0, served: 0, walkedOut: 0, turnedAway: 0, missedItems: 0, itemsSold: 0, satisfaction: 0, satisfactionN: 0, profit: 0, endCash: 0, complaints: emptyComplaints() };
}

export function emptyComplaints(): DayStats['complaints'] { return { outOfStock: {}, pricey: {}, queue: 0, lotFull: 0, dirty: 0 }; }

export function makeGoals(): GameState['goals'] {
  return { index: 0, done: [], unlocked: [], since: 1, run: 0, dayStart: 0, celebrate: null, champion: false, championSeen: false };
}

export function makeFixture(id: number, type: Fixture['type'], x: number, z: number, rot: Fixture['rot']): Fixture {
  const def = FIXTURES[type];
  const slots: Slot[] = Array.from({ length: def.slots }, () => ({ productId: null, qty: 0 }));
  const f: Fixture = { id, type, x, z, rot, slots };
  if (type === 'register' || type === 'kiosk') { f.queue = []; f.serving = null; f.scanned = 0; f.staffId = null; }
  return f;
}

/** The bays a new lot comes with: the first row, front to back. */
const STARTER_BAYS = [0, 1, 2, 3];

/** A bare shell: concrete floor, a front door and a back door (the walls go up as pieces: wallsToPieces). The player fits it out. */
export function makeShop(plotId: string, name: string, scheme: string = DEFAULT_SCHEME): Shop {
  const plot = PLOTS.find((p) => p.id === plotId) ?? PLOTS[0]!;
  const fr = storeFrame(plot.id);
  return {
    name, plotId: plot.id, scheme: schemeById(scheme).id, originX: fr.originX, originZ: fr.originZ, flip: fr.flip,
    floor: { ...STARTER.floor }, storeroom: { ...STARTER.storeroom }, door: { ...STARTER.door }, backDoor: { ...STARTER.backDoor },
    fixtures: [],
    storage: [],
    storageCapacity: 120,
    // Four bays painted along the east wall come with the lot; more go on one at a time.
    bays: lotLayout({ floor: STARTER.floor, storeroom: STARTER.storeroom, bayPlan: STARTER_BAYS }).bays.map((b) => ({ ...toWorld(fr, b.x, b.z), yaw: yawToWorld(fr, b.yaw), carId: null })),
    bayPlan: [...STARTER_BAYS],
    reputation: 0.5, awareness: 0.35, cleanliness: 1, layoutVersion: 1, litter: [], sizeId: 'starter', lotRows: 1,
    // Plain plaster walls come with the shop; finishes go on a stretch at a time.
    wallStyle: 'plain',
    delivery: deliveryZone(STARTER.floor),
    // A ceiling panel over every tile (the floor of a storey above, once stairs go up to it).
    ceilings: [floorTileList({ floor: STARTER.floor }).map((t) => tileKey(t.x, t.z)), [], [], []],
  };
}

/** The manager: you, in person, just inside the front door. */
export function makeOwner(id: number, shop: Shop, rng: Rng): Person {
  const { x, z } = toWorld(shop, shop.door.x + 0.6, shop.door.z - 1.4);
  return {
    id, kind: 'owner', look: { model: 12, variant: rng.int(0, 3), height: 1.04 },
    x, z, yaw: yawToWorld(shop, Math.PI), px: x, pz: z, state: 'idle', anim: 'idle', path: [], pathIdx: 0, speed: 2.0, timer: 0,
    task: null, carrying: null, name: 'You', role: 'manager', skill: 0.6, morale: 1, wage: 0, moveDir: null,
  };
}

export function newGame(opts: { seed: number; difficulty?: Difficulty; sandbox?: boolean; plotId?: string; name?: string; tutorial?: boolean; scheme?: string }): GameState {
  const difficulty = opts.difficulty ?? 'standard';
  const d = DIFFICULTY[difficulty];
  const rng = new Rng(opts.seed);
  const picked = opts.plotId !== undefined;
  const shop = makeShop(opts.plotId ?? 'main', opts.name ?? 'Shelf Made', opts.scheme);
  const prices: Record<string, number> = {};
  for (const p of PRODUCTS) prices[p.id] = p.basePrice;
  const state: GameState = {
    version: SAVE_VERSION, seed: opts.seed, difficulty, sandbox: opts.sandbox ?? false,
    tick: 0, day: 1, time: 0, timeScale: 1, phase: picked ? 'setup' : 'picking',
    cash: opts.sandbox ? SANDBOX_CASH : d.cash,
    shop, prices, people: [], cars: [], orders: [],
    today: emptyDayStats(1), history: [], popups: [], reactions: [],
    tutorial: { enabled: opts.tutorial ?? !opts.sandbox, step: 0, done: false, completed: [], rewardsPaid: 0 },
    unlocks: { prices: true, stock: true, build: true, staff: opts.sandbox ?? false, marketing: opts.sandbox ?? false, stats: true, newBadges: [] },
    nextId: 100, rng: {}, sounds: [], stuckRescues: 0,
    spawn: { customer: 0, traffic: 0, walker: 0 }, townAvgIndex: 1,
    rivals: makeRivals(opts.plotId ?? 'main'), streetBays: STREET_BAYS.map((b) => ({ ...b, carId: null })), rivalSpawn: 0, scores: { avgWait: 20, waitSum: 0, waitSamples: 0, last: null }, notices: [], demandBase: 48, eventDemand: 1,
    market: makeMarket(), bills: [], loans: [], brokeDays: 0, rescueOffered: false, gameOver: false,
    staffPool: [], rules: { ...DEFAULT_RULES }, marketing: makeMarketing(), franchises: [], goals: makeGoals(), tomorrow: null, sky: skyFor(null, opts.seed, 1),
  };
  // Its walls and doors, every one a piece (the front all glass): move, turn and sell them as you like.
  wallsToPieces(state);
  state.people.push(makeOwner(state.nextId++, shop, rng));
  refreshPool(state);
  // The lot, laid as tiles: the paths, lanes, yard and four bays a shop starts with, every bit of it yours to change.
  bakeLot(state, () => state.nextId++);
  return state;
}
