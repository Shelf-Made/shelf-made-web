/**
 * World layout constants. 1 unit = 1 store tile. x runs east, z runs south. The town is one
 * crossroads: Main Road runs east–west along z = ROAD_Z, a side street (Elm Street) crosses it at
 * x = 0. A shop takes each corner. North corners face south onto Main Road; south corners are
 * the same layout turned half round (their doors face north), so shop-relative coordinates mean
 * the same thing on every corner and only the frame (origin + flip) changes.
 */
import type { Plot, Vec2, FixtureDef, FixtureType, CornerId, FloorStyle } from './types';

export const TICK = 0.05;
/** 12 game hours of 60 real seconds each. */
export const DAY_SECONDS = 12 * 60;
export const OPEN_HOUR = 8;
export const CLOSE_TIME = DAY_SECONDS;

/** Main Road: westbound on the north lane, eastbound on the south lane (traffic keeps right). */
export const ROAD_Z = 2.5;
export const LANE_WEST_Z = 2.0;
export const LANE_EAST_Z = 3.0;
export const SIDEWALK_N_Z = 1.25;
export const SIDEWALK_S_Z = 3.75;
/** Elm Street: southbound on the west lane, northbound on the east lane. Kerbs at |x| = SIDE_HALF. */
export const SIDE_X = 0;
export const LANE_SOUTH_X = -0.5;
export const LANE_NORTH_X = 0.5;
export const SIDE_HALF = 1.0;
/** Elm Street sidewalks (centre lines); between kerb and sidewalk is a parking lane on the east side, a verge on the west. */
export const SIDEWALK_W_X = -2.2;
export const SIDEWALK_E_X = 2.2;
/** Zebra crossings, one on each arm, 1 unit wide: x of the two on Main Road, z of the two on Elm Street. */
export const ZEBRA = { west: -2.2, east: 2.2, north: 0.5, south: 4.5 } as const;
/** Where a car's centre waits at a red light, per direction of travel. */
export const STOP_LINE = { eastbound: -3.9, westbound: 3.9, southbound: -1.1, northbound: 6.1 } as const;
/** The town area: everything that matters lies within |x| < MAP_X, z in MAP_Z. */
export const MAP_X = 26;
export const MAP_Z = { north: -16, south: 21 } as const;
/** Where traffic and walkers appear and vanish, out in the fog along each road. */
export const ROAD_FAR = 90;
/** Every corner owns this rectangle (shop-relative), big enough for the largest shop with the doubled lot. */
export const PLOT_RECT = { x0: -8, z0: -11.6, x1: 12.6, z1: 2.55 };
/** Shop-relative z of the frontage sidewalk's centre line (the same on every corner). */
export const FRONT_WALK_Z = SIDEWALK_N_Z + 1.6;

export const WALK_SPEED = 1.6;
export const CAR_ROAD_SPEED = 6;
export const CAR_LOT_SPEED = 2.2;

/** A shop's frame: where its (0,0) sits in the world, and whether it is turned half round. */
export interface Frame { originX: number; originZ: number; flip?: boolean }
export function toWorld(f: Frame, x: number, z: number): Vec2 { return f.flip ? { x: f.originX - x, z: f.originZ - z } : { x: f.originX + x, z: f.originZ + z }; }
export function toLocal(f: Frame, x: number, z: number): Vec2 { return f.flip ? { x: f.originX - x, z: f.originZ - z } : { x: x - f.originX, z: z - f.originZ }; }
export function rectToWorld(f: Frame, r: Rect): Rect {
  return f.flip ? { x0: f.originX - r.x1, z0: f.originZ - r.z1, x1: f.originX - r.x0, z1: f.originZ - r.z0 } : { x0: f.originX + r.x0, z0: f.originZ + r.z0, x1: f.originX + r.x1, z1: f.originZ + r.z1 };
}
export function yawToWorld(f: Frame, yaw: number): number { return f.flip ? yaw + Math.PI : yaw; }
export function dirToWorld(f: Frame, d: Vec2): Vec2 { return f.flip ? { x: -d.x, z: -d.z } : d; }

/** The four corners. The player picks one of the first three; the south-east corner always goes to a rival. */
export const CORNERS: Record<CornerId, Frame & { id: CornerId; name: string }> = {
  nw: { id: 'nw', name: 'north-west corner', originX: -15.5, originZ: -1.6 },
  ne: { id: 'ne', name: 'north-east corner', originX: 10.9, originZ: -1.6 },
  sw: { id: 'sw', name: 'south-west corner', originX: -10.9, originZ: 2 * ROAD_Z + 1.6, flip: true },
  se: { id: 'se', name: 'south-east corner', originX: 15.5, originZ: 2 * ROAD_Z + 1.6, flip: true },
};
export const CORNER_IDS: CornerId[] = ['nw', 'ne', 'sw', 'se'];

export const PLOTS: Plot[] = [
  { id: 'main', name: 'Main Road corner', corner: 'ne', blurb: 'On the busy side of Main Road. Drivers pull in on the way past: more trade, higher rent, shoppers in a hurry.', rent: 40, traffic: 1.2, mix: { bargain: 0.9, convenience: 1.4, loyalist: 0.9, impulse: 1.1 } },
  { id: 'elm', name: 'Elm Street corner', corner: 'nw', blurb: 'Where Elm Street comes down from the houses. Regulars who notice prices and stay loyal; less passing trade.', rent: 30, traffic: 0.8, mix: { bargain: 1.3, convenience: 0.7, loyalist: 1.3, impulse: 0.8 } },
  { id: 'bus', name: 'Bus stop corner', corner: 'sw', blurb: 'Right by the bus stop. Commuters and the after-school crowd: snacks and drinks fly off the shelf.', rent: 35, traffic: 1.0, mix: { bargain: 0.9, convenience: 1.0, loyalist: 0.8, impulse: 1.5 } },
];
/** The corner nobody can buy: whatever it faces, it trades like the town average. */
export const RIVAL_CORNER: CornerId = 'se';

export function plotDef(plotId: string): Plot { return PLOTS.find((p) => p.id === plotId) ?? PLOTS[0]!; }
export function cornerOfPlot(plotId: string): CornerId { return plotDef(plotId).corner; }

/** The bus stop: a shelter on the south sidewalk of Main Road, west of the crossing. */
export const BUS_STOP: Vec2 = { x: -6.2, z: SIDEWALK_S_Z };
/** Shared parallel bays on Elm Street's east kerb, north of the crossing; cars park facing north, 3.4 apart so each can pull in and out past its neighbours. */
export const STREET_BAYS: { x: number; z: number; yaw: number }[] = [-4.6, -8.0, -11.4].map((z) => ({ x: SIDE_HALF + 0.5, z, yaw: Math.PI }));

/**
 * The neighbourhoods the roads lead to, off the map: each has a road sign at the edge of town.
 * Flyers go out there; franchises and MegaMart's extra branches open there.
 */
export const OFFMAP_SITES: { id: string; name: string; km: number; dir: 'east' | 'west' | 'north' | 'south'; traffic: number }[] = [
  { id: 'hillside', name: 'Hillside', km: 1, dir: 'west', traffic: 0.85 },
  { id: 'eastend', name: 'East End', km: 2, dir: 'east', traffic: 1.1 },
  { id: 'elmheights', name: 'Elm Heights', km: 1, dir: 'north', traffic: 0.9 },
  { id: 'riverside', name: 'Riverside', km: 3, dir: 'south', traffic: 1.0 },
];

/**
 * Billboards standing on the crossroads, each a real board: by the bus shelter, at the town edge on Main Road,
 * and up on tall legs where Elm Street leaves town (y lifts the board off the ground).
 */
export const BILLBOARDS: { id: string; name: string; rent: number; reach: number; x: number; z: number; y: number; yaw: number }[] = [
  { id: 'bus', name: 'Bus shelter', rent: 35, reach: 0.05, x: BUS_STOP.x - 2.1, z: SIDEWALK_S_Z + 0.55, y: 0, yaw: Math.PI },
  { id: 'edge', name: 'Main Road, edge of town', rent: 45, reach: 0.06, x: -27.5, z: ROAD_Z - 3.2, y: 0, yaw: Math.PI / 2 },
  { id: 'roof', name: 'High board on Elm Street', rent: 30, reach: 0.04, x: 4.6, z: -16.5, y: 1.8, yaw: 0.35 },
];

/**
 * The traffic light: one timed cycle in sim seconds (it keeps running while the clock is stopped
 * for setup). Main Road green, Elm Street green, then an all-walk phase when every car waits and
 * walkers may use any zebra. Amber and all-red gaps clear the junction between phases.
 */
export const LIGHT_PHASES: { phase: LightPhase; len: number }[] = [
  { phase: 'main', len: 14 }, { phase: 'mainAmber', len: 2 }, { phase: 'allRed', len: 1 },
  { phase: 'side', len: 8 }, { phase: 'sideAmber', len: 2 }, { phase: 'allRed', len: 1 },
  { phase: 'walk', len: 7 }, { phase: 'allRed', len: 1 },
];
export type LightPhase = 'main' | 'mainAmber' | 'side' | 'sideAmber' | 'walk' | 'allRed';
export const LIGHT_CYCLE = LIGHT_PHASES.reduce((a, p) => a + p.len, 0);
export function lightAt(tick: number): { phase: LightPhase; left: number } {
  let t = (tick * TICK) % LIGHT_CYCLE;
  for (const p of LIGHT_PHASES) { if (t < p.len) return { phase: p.phase, left: p.len - t }; t -= p.len; }
  return { phase: 'allRed', left: 0 };
}
/** May a car on this road cross its stop line now? Amber counts as stop unless the car is already at the line. */
export function greenFor(road: 'main' | 'side', tick: number): 'go' | 'amber' | 'stop' {
  const { phase } = lightAt(tick);
  if (phase === road) return 'go';
  if (phase === `${road}Amber`) return 'amber';
  return 'stop';
}
/** Walkers may step onto a zebra only in the walk phase, with time to get across. */
export function walkMayStart(tick: number): boolean { const l = lightAt(tick); return l.phase === 'walk' && l.left > 2.2; }

/**
 * Store-relative layout of the starter shop. (0,0) is the front door tile centre; the shop extends
 * north (negative z). One bare room: concrete floor and four walls. Walls are 0.5 thick and stand
 * OUTSIDE the floor rectangle, so nothing placed on the floor can clip into them. `storeroom` is a
 * zero-height strip along the back wall (kept so depth maths stays in one place).
 */
export const WALL_T = 0.5;
export const STARTER = {
  floor: { x0: -2.5, z0: -6, x1: 2.5, z1: 0 },        // 5 x 6 tiles, front wall outside z = 0
  storeroom: { x0: -2.5, z0: -6, x1: 2.5, z1: -6 },   // no separate room
  door: { x: 0, z: 0 },
  backDoor: { x: 0, z: -6 },
  /** Where trucks drop boxes: two tiles inside, beside the back door. Never buildable, never walkable. */
  delivery: { x0: -2.5, z0: -6, x1: -0.5, z1: -5 },
  /** Front apron (paving) in front of the shop. */
  apron: { x0: -3.5, z0: 0, x1: 7, z1: 1.2 },
  /** Walkway from the door to the sidewalk. */
  walkway: { x: 0 },
  /** Parking: nose-in bays facing west, along the shop's east wall. */
  bays: [
    { x: 4.1, z: -4.9, yaw: Math.PI / 2 },
    { x: 4.1, z: -3.8, yaw: Math.PI / 2 },
    { x: 4.1, z: -2.7, yaw: Math.PI / 2 },
    { x: 4.1, z: -1.6, yaw: Math.PI / 2 },
  ],
  aisle: { x0: 4.95, z0: -5.6, x1: 6.95, z1: -0.5 },
  driveway: { x0: 5.0, z0: -0.5, x1: 6.9, z1: 1.5 },
  /** Service lane down the west side to the back door. */
  serviceLane: { x0: -5.4, z0: -8.2, x1: -3.6, z1: 1.5 },
};

/** Units of stock an extra Pallet holds. */
export const PALLET_UNITS = 60;
/** Room for deliveries: the pallet by the back door, and every extra Pallet on the floor. */
export function storageCap(shop: { storageCapacity: number; fixtures: { type: FixtureType }[] }): number {
  return shop.storageCapacity + PALLET_UNITS * shop.fixtures.filter((f) => f.type === 'pallet').length;
}
/** The delivery zone for any floor: two tiles in the back-left corner beside the back door. */
export function deliveryZone(floor: Rect): Rect { return { x0: floor.x0, z0: floor.z0, x1: floor.x0 + 2, z1: floor.z0 + 1 }; }

export interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface LotLayout {
  apron: Rect; walkwayX: number; bays: { x: number; z: number; yaw: number }[]; aisle: Rect; driveway: Rect; serviceLane: Rect; backYard: Rect;
  truckStop: { x: number; z: number; yaw: number }; plot: Rect; halfW: number; depth: number;
}

/**
 * The lot around a shop of any size: parking along the east wall, service lane down the west, yard
 * behind, all laid out from the floor's outer edges (its bounding rectangle: a shop grown a tile at a
 * time need not be symmetric about its door).
 */
export function lotLayout(shop: { floor: Rect; storeroom: Rect; lotRows?: number }): LotLayout {
  const east = shop.floor.x1, west = -shop.floor.x0;
  const halfW = (east + west) / 2;
  const depth = shop.floor.z1 - Math.min(shop.floor.z0, shop.storeroom.z0);
  const rows = shop.lotRows ?? 1;
  const bays: { x: number; z: number; yaw: number }[] = [];
  const n = Math.min(8, Math.floor((depth - 1.2) / 1.1));
  for (let k = 0; k < n; k++) bays.push({ x: east + 1.6, z: -(depth - 1.1) + k * 1.1, yaw: Math.PI / 2 });
  if (rows > 1) for (let k = 0; k < n; k++) bays.push({ x: east + 6.0, z: -(depth - 1.1) + k * 1.1, yaw: -Math.PI / 2 });
  const eastEdge = rows > 1 ? east + 7.2 : east + 4.5;
  return {
    halfW, depth,
    apron: { x0: -west - 1, z0: WALL_T, x1: eastEdge, z1: 1.2 },
    walkwayX: 0,
    bays,
    aisle: { x0: east + 2.45, z0: -(depth - 0.4), x1: east + 4.45, z1: -0.5 },
    driveway: { x0: east + 2.5, z0: -0.5, x1: east + 4.4, z1: 1.5 },
    serviceLane: { x0: -west - 2.9, z0: -(depth + 2.4), x1: -west - 1.1, z1: 1.5 },
    backYard: { x0: -west - 1.1, z0: -(depth + 2.4), x1: eastEdge, z1: -depth - WALL_T },
    truckStop: { x: -west + 1.3, z: -(depth + 1.4), yaw: Math.PI / 2 },
    plot: { x0: -8, z0: -(depth + 3), x1: Math.max(8, eastEdge + 0.8), z1: 1.5 },
  };
}

// ---- The floor, tile by tile. It grows a tile at a time inside the market hall's footprint: `floor`
// is its bounding rectangle and `gaps` the tiles inside that are not floor yet (keys "x,z" of their
// corner). A shop without gaps is the plain rectangle every older save has.

/** The most floor a shop can have (the front wall never moves). */
export const MAX_FLOOR: Rect = { x0: -4.5, z0: -8, x1: 4.5, z1: 0 };
export const tileKey = (x: number, z: number): string => `${x},${z}`;
type FloorShape = { floor: Rect; gaps?: string[] };
const gapSets = new WeakMap<string[], Set<string>>();
function gapSet(shop: FloorShape): Set<string> | null {
  if (!shop.gaps?.length) return null;
  let g = gapSets.get(shop.gaps);
  if (!g) { g = new Set(shop.gaps); gapSets.set(shop.gaps, g); }
  return g;
}
/** Is the tile with its corner at (x, z) shop floor? */
export function isFloor(shop: FloorShape, x: number, z: number): boolean {
  const f = shop.floor, e = 1e-6;
  if (x < f.x0 - e || x + 1 > f.x1 + e || z < f.z0 - e || z + 1 > f.z1 + e) return false;
  return !gapSet(shop)?.has(tileKey(x, z));
}
/** Every floor tile's corner. */
export function floorTileList(shop: FloorShape): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const f = shop.floor;
  for (let z = f.z0; z < f.z1 - 1e-6; z++) for (let x = f.x0; x < f.x1 - 1e-6; x++) if (isFloor(shop, x, z)) out.push({ x, z });
  return out;
}
export function floorTileCount(shop: FloorShape): number {
  const f = shop.floor;
  return Math.round((f.x1 - f.x0) * (f.z1 - f.z0)) - (shop.gaps?.length ?? 0);
}
/**
 * What a tile of floor costs when the shop has `n`: a little more as it grows, fitted so growing to the
 * old sizes costs what they did (about $900 to the 7×7, $1,500 more to the 9×8).
 */
export function tilePriceAt(n: number): number { return Math.round(39.7 + 0.85 * Math.max(0, n - 30)); }
/** What the next tile of floor costs. */
export function tilePrice(shop: FloorShape): number { return tilePriceAt(floorTileCount(shop)); }
/** The name the old sizes went by, from how much floor there is (goals and reviews still speak of them). */
export function sizeOfTiles(n: number): 'starter' | 'medium' | 'large' { return n >= 72 ? 'large' : n >= 49 ? 'medium' : 'starter'; }

/** Shop sizes you can grow into. Costs include the land. */
export const SHOP_SIZES: { id: string; name: string; floor: Rect; storeroom: Rect; cost: number }[] = [
  { id: 'starter', name: 'Corner shop (5×6)', floor: { x0: -2.5, z0: -6, x1: 2.5, z1: 0 }, storeroom: { x0: -2.5, z0: -6, x1: 2.5, z1: -6 }, cost: 0 },
  { id: 'medium', name: 'Neighbourhood grocer (7×7)', floor: { x0: -3.5, z0: -7, x1: 3.5, z1: 0 }, storeroom: { x0: -3.5, z0: -7, x1: 3.5, z1: -7 }, cost: 900 },
  { id: 'large', name: 'Market hall (9×8)', floor: { x0: -4.5, z0: -8, x1: 4.5, z1: 0 }, storeroom: { x0: -4.5, z0: -8, x1: 4.5, z1: -8 }, cost: 2400 },
];
export const LOT_EXPANSION_COST = 500;

/** Where the store's frame sits for a plot: the front door tile centre, just behind the apron. */
export function storeFrame(plotId: string): Frame {
  const c = CORNERS[cornerOfPlot(plotId)];
  return { originX: c.originX, originZ: c.originZ, flip: !!c.flip };
}

export const FIXTURES: Record<FixtureType, FixtureDef> = {
  // Checkout.
  register: { type: 'register', name: 'Checkout counter', price: 180, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'checkout' },
  kiosk: { type: 'kiosk', name: 'Self-checkout', price: 650, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 3, category: 'checkout' },
  rack: { type: 'rack', name: 'Checkout rack', price: 45, w: 1, d: 1, slots: 2, capacity: 8, chilled: false, upkeep: 0, category: 'checkout' },
  // Shelves and fridges.
  shelf: { type: 'shelf', name: 'Shelf', price: 85, w: 1, d: 1, slots: 4, capacity: 8, chilled: false, upkeep: 0, category: 'shelves' },
  endcap: { type: 'endcap', name: 'End cap', price: 70, w: 1, d: 1, slots: 2, capacity: 6, chilled: false, upkeep: 0, category: 'shelves' },
  produce: { type: 'produce', name: 'Produce stand', price: 60, w: 1, d: 1, slots: 2, capacity: 10, chilled: false, upkeep: 0, accepts: ['produce'], category: 'shelves' },
  /** More room for deliveries, on the shop floor wherever you put it. */
  pallet: { type: 'pallet', name: 'Pallet', price: 60, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'shelves' },
  fridge: { type: 'fridge', name: 'Chiller', price: 200, w: 1, d: 1, slots: 4, capacity: 6, chilled: true, upkeep: 6, category: 'shelves' },
  freezer: { type: 'freezer', name: 'Tall fridge', price: 300, w: 1, d: 1, slots: 2, capacity: 12, chilled: true, upkeep: 8, accepts: ['dairy', 'meat'], category: 'shelves' },
  // Furniture.
  bench: { type: 'bench', name: 'Bench', price: 45, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'furniture', looks: 0.08, looksCap: 2 },
  sofa: { type: 'sofa', name: 'Cushioned bench', price: 70, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'furniture', looks: 0.09, looksCap: 2 },
  cafe: { type: 'cafe', name: 'Café table', price: 120, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'furniture', looks: 0.12, looksCap: 2 },
  desk: { type: 'desk', name: 'Help desk', price: 150, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 1, category: 'furniture', looks: 0.05, looksCap: 1 },
  basketStack: { type: 'basketStack', name: 'Baskets', price: 30, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'furniture', looks: 0.1, looksCap: 1 },
  trolleys: { type: 'trolleys', name: 'Trolley bay', price: 90, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'furniture', looks: 0.05, looksCap: 1 },
  bin: { type: 'bin', name: 'Litter bin', price: 20, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'furniture', looks: 0.04, looksCap: 2 },
  speaker: { type: 'speaker', name: 'Music speaker', price: 60, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 1, category: 'furniture', looks: 0.05, looksCap: 1 },
  screen: { type: 'screen', name: 'Promo screen', price: 140, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 2, category: 'furniture', looks: 0.07, looksCap: 2 },
  bookcase: { type: 'bookcase', name: 'Magazine shelf', price: 55, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'furniture', looks: 0.06, looksCap: 2 },
  // Decor.
  plant: { type: 'plant', name: 'Plant', price: 25, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'decor', looks: 0.13, looksCap: 4 },
  flowers: { type: 'flowers', name: 'Flower table', price: 35, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'decor', looks: 0.1, looksCap: 3 },
  sign: { type: 'sign', name: 'Aisle sign', price: 40, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'decor', looks: 0.1, looksCap: 3 },
  rug: { type: 'rug', name: 'Rug', price: 30, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'decor', walkable: true, looks: 0.08, looksCap: 3 },
  doormat: { type: 'doormat', name: 'Doormat', price: 12, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'decor', walkable: true, looks: 0.06, looksCap: 1 },
  // Walls and doors inside the shop.
  wall: { type: 'wall', name: 'Wall', price: 40, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'walls' },
  wallWindow: { type: 'wallWindow', name: 'Wall with window', price: 70, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'walls', looks: 0.04, looksCap: 4 },
  /** A window put into the outside wall behind its tile (shelves can still stand in front of it). */
  window: { type: 'window', name: 'Window', price: 25, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'walls', walkable: true, onWall: true },
  doorway: { type: 'doorway', name: 'Doorway', price: 55, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'walls', walkable: true },
  railing: { type: 'railing', name: 'Railing', price: 25, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'walls' },
  gate: { type: 'gate', name: 'Gate', price: 35, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'walls', walkable: true },
  // Lights.
  floorLamp: { type: 'floorLamp', name: 'Floor lamp', price: 45, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 1, category: 'lights', looks: 0.07, looksCap: 4 },
  wallLight: { type: 'wallLight', name: 'Wall light', price: 30, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 1, category: 'lights', walkable: true, onWall: true, looks: 0.06, looksCap: 4 },
  pendant: { type: 'pendant', name: 'Hanging light', price: 40, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 1, category: 'lights', walkable: true, looks: 0.06, looksCap: 6 },
  neon: { type: 'neon', name: 'Neon sign', price: 80, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 1, category: 'lights', walkable: true, onWall: true, looks: 0.1, looksCap: 2 },
};

/** Floor finishes: the price per tile, and what each adds to how the shop looks. */
export const FLOORS: { id: FloorStyle; name: string; perTile: number; looks: number }[] = [
  { id: 'lino', name: 'Checker lino', perTile: 0, looks: 0 },
  { id: 'concrete', name: 'Polished concrete', perTile: 3, looks: 0.06 },
  { id: 'checker', name: 'Black and white tiles', perTile: 5, looks: 0.14 },
  { id: 'colour', name: 'Tiles in your colours', perTile: 5, looks: 0.14 },
  { id: 'wood', name: 'Wooden boards', perTile: 7, looks: 0.2 },
  { id: 'stone', name: 'White stone', perTile: 9, looks: 0.22 },
];

export const DIFFICULTY = {
  relaxed: { cash: 1200, rentMul: 0.8, demandMul: 1.2, patienceMul: 1.3 },
  standard: { cash: 800, rentMul: 1.0, demandMul: 1.0, patienceMul: 1.0 },
  hard: { cash: 600, rentMul: 1.2, demandMul: 0.85, patienceMul: 0.85 },
} as const;
