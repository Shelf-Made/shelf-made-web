/**
 * World layout constants. 1 unit = 1 store tile. x runs east, z runs south. The town is one
 * crossroads: Main Road runs east–west along z = ROAD_Z, a side street (Elm Street) crosses it at
 * x = 0. A shop takes each corner. North corners face south onto Main Road; south corners are
 * the same layout turned half round (their doors face north), so shop-relative coordinates mean
 * the same thing on every corner and only the frame (origin + flip) changes.
 */
import { sizeOf } from './products';
import type { Plot, Vec2, FixtureDef, FixtureType, CornerId, FloorStyle, WallStyle, LotSurface } from './types';

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

/**
 * The bus stop: a shelter on the south sidewalk of Main Road, west of the crossing, in front of the bus-stop
 * corner between its walkway and its driveway (both only move away from it as that shop grows), so no truck
 * or car turning into the lot ever drives through it.
 */
export const BUS_STOP: Vec2 = { x: -13.4, z: SIDEWALK_S_Z };
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
  // (Between the bus-stop corner's walkway and its service lane, the other way from the shelter: both move away as it grows.)
  { id: 'bus', name: 'Bus shelter', rent: 35, reach: 0.05, x: -8.9, z: SIDEWALK_S_Z + 0.55, y: 0, yaw: Math.PI },
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
/** Room the pallet's stock takes (bulky goods take more than one unit's room each). */
export function storageUsed(shop: { storage: { productId: string; qty: number }[] }): number {
  return shop.storage.reduce((a, e) => a + e.qty * sizeOf(e.productId), 0);
}
/** Room a storage rack adds. */
export const STORE_RACK_UNITS = 200;
export function storageCap(shop: { storageCapacity: number; fixtures: { type: FixtureType }[] }): number {
  return shop.storageCapacity + PALLET_UNITS * shop.fixtures.filter((f) => f.type === 'pallet').length + STORE_RACK_UNITS * shop.fixtures.filter((f) => f.type === 'storeRack').length;
}
/** The delivery zone for any floor: two tiles in the back-left corner beside the back door. */
export function deliveryZone(floor: Rect): Rect { return { x0: floor.x0, z0: floor.z0, x1: floor.x0 + 2, z1: floor.z0 + 1 }; }

export interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface LotLayout {
  apron: Rect; walkwayX: number; bays: { x: number; z: number; yaw: number }[]; aisle: Rect; driveway: Rect; serviceLane: Rect; backYard: Rect;
  truckStop: { x: number; z: number; yaw: number }; plot: Rect; halfW: number; depth: number;
  /** Every place a bay could be painted (the painted ones are `bays`). */
  slots: BaySlot[];
}

/** A place in the car park where a bay can be painted: `id` is row × 8 + its place in the row, front first. */
export interface BaySlot { id: number; row: number; x: number; z: number; yaw: number }
/** What painting the lines of one more bay costs. */
export const BAY_PRICE = 60;
/** A bay's painted rectangle round its centre. */
export function bayRect(b: { x: number; z: number }): Rect { return { x0: b.x - 0.85, z0: b.z - 0.55, x1: b.x + 0.85, z1: b.z + 0.55 }; }

/**
 * Where bays can go: nose-in along the east wall, and (once one is painted there) a second row facing
 * them across the aisle. As many as fit down the side of the shop, front first, so a bay stays put
 * when the shop grows deeper.
 */
export function baySlots(shop: { floor: Rect; storeroom: Rect }): BaySlot[] {
  const east = shop.floor.x1;
  const depth = shop.floor.z1 - Math.min(shop.floor.z0, shop.storeroom.z0);
  const n = Math.min(8, Math.floor((depth - 1.2) / 1.1));
  const out: BaySlot[] = [];
  for (let row = 0; row < 2; row++) for (let k = 0; k < n; k++) out.push({ id: row * 8 + k, row, x: east + (row ? 6.0 : 1.6), z: -1.6 - k * 1.1, yaw: row ? -Math.PI / 2 : Math.PI / 2 });
  return out;
}
/** Old saves (and rivals) paint whole rows, in the order the bays were always listed: back to front. */
function rowsPlan(slots: BaySlot[], rows: number): number[] {
  return slots.filter((s) => s.row < rows).sort((a, b) => a.row - b.row || b.id - a.id).map((s) => s.id);
}
/** The bays painted, in their order (`plan`, or whole rows), and how many rows the car park spans. */
export function paintedBays(shop: { floor: Rect; storeroom: Rect; lotRows?: number; bayPlan?: number[] }): { bays: BaySlot[]; rows: number; slots: BaySlot[] } {
  const slots = baySlots(shop);
  const plan = shop.bayPlan ?? rowsPlan(slots, shop.lotRows ?? 1);
  const bays = plan.map((id) => slots.find((s) => s.id === id)).filter((s): s is BaySlot => !!s);
  const rows = shop.bayPlan ? (bays.some((b) => b.row > 0) ? 2 : 1) : shop.lotRows ?? 1;
  return { bays, rows, slots };
}

/**
 * The lot around a shop of any size: parking along the east wall, service lane down the west, yard
 * behind, all laid out from the floor's outer edges (its bounding rectangle: a shop grown a tile at a
 * time need not be symmetric about its door).
 */
export function lotLayout(shop: { floor: Rect; storeroom: Rect; lotRows?: number; bayPlan?: number[] }): LotLayout {
  const east = shop.floor.x1, west = -shop.floor.x0;
  const halfW = (east + west) / 2;
  const depth = shop.floor.z1 - Math.min(shop.floor.z0, shop.storeroom.z0);
  const { bays, rows, slots } = paintedBays(shop);
  const eastEdge = rows > 1 ? east + 7.2 : east + 4.5;
  return {
    halfW, depth,
    apron: { x0: -west - 1, z0: WALL_T, x1: eastEdge, z1: 1.2 },
    walkwayX: 0,
    bays: bays.map((b) => ({ x: b.x, z: b.z, yaw: b.yaw })),
    slots,
    aisle: { x0: east + 2.45, z0: -(depth - 0.4), x1: east + 4.45, z1: -0.5 },
    driveway: { x0: east + 2.5, z0: -0.5, x1: east + 4.4, z1: 1.5 },
    serviceLane: { x0: -west - 2.9, z0: -(depth + 2.4), x1: -west - 1.1, z1: 1.5 },
    backYard: { x0: -west - 1.1, z0: -(depth + 2.4), x1: eastEdge, z1: -depth - WALL_T },
    truckStop: { x: -west + 1.3, z: -(depth + 1.4), yaw: Math.PI / 2 },
    plot: { x0: -8, z0: -(depth + 3), x1: Math.max(8, eastEdge + 0.8), z1: 1.5 },
  };
}

// ---- The lot round the shop, for building on: a grid of its own, half a tile off the floor's, so its
// tiles sit flush against the outside of the walls (corners on whole x and half z). Grass where nothing
// is laid; pieces stand on it, never on the paths, lanes and bays the shop needs.

/** The front of the lot: the frontage sidewalk's inner edge (shop-relative). */
export const LOT_FRONT = SIDEWALK_N_Z - 0.3 + 1.6;
export const lotKey = (x: number, z: number): string => `${x},${z}`;
/** The lot tile under a shop-relative point (its corner). */
export function lotTileAt(x: number, z: number): { x: number; z: number } { return { x: Math.floor(x), z: Math.floor(z - 0.5) + 0.5 }; }
/** Is this rectangle on the plot, behind the sidewalk? */
export function inLot(r: Rect): boolean { const e = 1e-6; return r.x0 >= PLOT_RECT.x0 - e && r.x1 <= PLOT_RECT.x1 + e && r.z0 >= PLOT_RECT.z0 - e && r.z1 <= LOT_FRONT + e; }
/** Surfaces to lay on the lot: the price a tile, what each adds to the frontage, how gladly people walk on it (1 = paving). */
export const SURFACES: { id: LotSurface; name: string; perTile: number; curb: number; walk: number }[] = [
  { id: 'gravel', name: 'Gravel', perTile: 4, curb: 0.004, walk: 1.2 },
  { id: 'asphalt', name: 'Asphalt', perTile: 6, curb: 0, walk: 1.1 },
  { id: 'paving', name: 'Sidewalk slabs', perTile: 8, curb: 0.006, walk: 1 },
  { id: 'brick', name: 'Brick paving', perTile: 12, curb: 0.01, walk: 1 },
];
/**
 * A piece's footprint, turned with it: one tile, or two side by side (a billboard), and a deep piece (the
 * stairs) runs back from its tile, away from the way it faces, so its front is always the tile at (x, z).
 */
export function footprintOf(type: FixtureType, x: number, z: number, rot: number): Rect {
  const { w, d } = FIXTURES[type];
  const back = d - 1;
  switch (rot & 3) {
    case 0: return { x0: x, z0: z - back, x1: x + w, z1: z + 1 };
    case 1: return { x0: x - back, z0: z, x1: x + 1, z1: z + w };
    case 2: return { x0: x, z0: z, x1: x + w, z1: z + 1 + back };
    default: return { x0: x, z0: z, x1: x + 1 + back, z1: z + w };
  }
}
export function overlaps(a: Rect, b: Rect, m = 1e-6): boolean { return a.x0 < b.x1 - m && a.x1 > b.x0 + m && a.z0 < b.z1 - m && a.z1 > b.z0 + m; }
/** Does this rectangle touch the building (the floor and the walls round it)? */
export function onBuilding(shop: FloorShape, r: Rect): boolean {
  return floorTileList(shop).some((t) => overlaps(r, { x0: t.x - WALL_T, z0: t.z - WALL_T, x1: t.x + 1 + WALL_T, z1: t.z + 1 + WALL_T }));
}
/**
 * Where the pylon sign stands, shop-relative: on the lawn by the sidewalk, between the service lane
 * (where the delivery truck turns in) and the walkway to the door, never on either. `w` is the board's width.
 */
export function pylonSpot(shape: { floor: Rect; storeroom: Rect; lotRows?: number; bayPlan?: number[] }): { x: number; z: number; w: number } {
  const L = lotLayout(shape);
  const left = L.serviceLane.x1 + 0.35, right = L.walkwayX - 0.5 - 0.35;
  return { x: (left + right) / 2, z: 1.85, w: Math.min(2.6, right - left) };
}
/** What on the lot is spoken for: the apron, the walkway, lanes and yard, the painted bays and the pylon sign. Nothing is built on them. */
export function lotReserved(shop: { floor: Rect; storeroom: Rect; lotRows?: number; bayPlan?: number[] }): Rect[] {
  const L = lotLayout(shop), py = pylonSpot(shop);
  return [
    L.apron, { x0: L.walkwayX - 0.5, z0: L.apron.z0, x1: L.walkwayX + 0.5, z1: LOT_FRONT }, L.aisle, { ...L.driveway, z1: LOT_FRONT }, { ...L.serviceLane, z1: LOT_FRONT }, L.backYard,
    ...L.bays.map(bayRect), { x0: py.x - py.w / 2 - 0.1, z0: py.z - 0.3, x1: py.x + py.w / 2 + 0.1, z1: py.z + 0.3 },
  ];
}

// ---- The floor, tile by tile. It grows a tile at a time inside the market hall's footprint: `floor`
// is its bounding rectangle and `gaps` the tiles inside that are not floor yet (keys "x,z" of their
// corner). A shop without gaps is the plain rectangle every older save has.

/** The most floor a shop can have (the front wall never moves). */
export const MAX_FLOOR: Rect = { x0: -4.5, z0: -8, x1: 4.5, z1: 0 };
type FloorShape = { floor: Rect; gaps?: string[]; ceilings?: string[][]; fixtures?: readonly { type: FixtureType; x: number; z: number; rot: number }[]; layoutVersion?: number };
export const tileKey = (x: number, z: number): string => `${x},${z}`;
const gapSets = new WeakMap<string[], Set<string>>();
function gapSet(shop: FloorShape): Set<string> | null {
  if (!shop.gaps?.length) return null;
  let g = gapSets.get(shop.gaps);
  if (!g) { g = new Set(shop.gaps); gapSets.set(shop.gaps, g); }
  return g;
}
/** Is the tile with its corner at (x, z) shop floor (on any floor of the building: see levelOfZ)? */
export function isFloor(shop: FloorShape, x: number, z: number): boolean {
  if (z < UPPER_Z) return upperFloor(shop, x, z);
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
/** One stretch of outer wall: the edge of a floor tile with no floor beyond it, which way it faces, its line and its middle. */
export interface WallSeg { dir: 'front' | 'back' | 'left' | 'right'; nx: number; nz: number; axis: 'x' | 'z'; line: number; t: number; key: string }
export const wallKey = (dir: string, line: number, t: number): string => `${dir}@${line}@${t}`;
const SEG_DIRS = [
  { dir: 'front' as const, nx: 0, nz: 1, axis: 'x' as const }, { dir: 'back' as const, nx: 0, nz: -1, axis: 'x' as const },
  { dir: 'left' as const, nx: -1, nz: 0, axis: 'z' as const }, { dir: 'right' as const, nx: 1, nz: 0, axis: 'z' as const },
];
/** Every stretch of outer wall round the floor, and round the building on each floor above (in that floor's region). */
export function wallSegments(shop: FloorShape): WallSeg[] {
  const out: WallSeg[] = [];
  for (const t of floorTileList(shop)) for (const d of SEG_DIRS) {
    if (isFloor(shop, t.x + d.nx, t.z + d.nz)) continue;
    const line = d.axis === 'x' ? (d.nz > 0 ? t.z + 1 : t.z) : (d.nx > 0 ? t.x + 1 : t.x);
    const mid = d.axis === 'x' ? t.x + 0.5 : t.z + 0.5;
    out.push({ ...d, line, t: mid, key: wallKey(d.dir, line, mid) });
  }
  if (!shop.fixtures?.some((f) => VERTICAL.has(f.type)) && !shop.ceilings) return out;
  const st = storeysOf(shop);
  for (let L = 1; L < MAX_LEVELS; L++) for (const k of st.inside[L] ?? []) {
    const [x, z] = k.split(',').map(Number) as [number, number];
    for (const d of SEG_DIRS) {
      if (st.inside[L]!.has(tileKey(x + d.nx, z + d.nz))) continue;
      const line = d.axis === 'x' ? zOnLevel(d.nz > 0 ? z + 1 : z, L) : (d.nx > 0 ? x + 1 : x);
      const mid = d.axis === 'x' ? x + 0.5 : zOnLevel(z + 0.5, L);
      out.push({ ...d, line, t: mid, key: wallKey(d.dir, line, mid) });
    }
  }
  return out;
}

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

// ---- Upstairs. A ceiling panel over a tile is also the floor of the storey above (`ceilings`); stairs, an
// escalator or a lift going up from a floor opens the one above it, and the building then stands a storey
// taller all over. Upstairs is walked in a region of its own, LEVEL_DZ further back (shop-relative z) for
// each floor up, past the plot and the floor below: so the sim stays flat (a piece or a person up there
// just has its z shifted, distances between floors are long, and paths cross only by the stairs) and the
// renderer lifts each floor back up over the ground one.

/** Five floors at most: the ground floor and four above it. */
export const MAX_LEVELS = 5;
/** What each floor is called. */
export const FLOOR_NAMES = ['Ground', '1st', '2nd', '3rd', '4th'];
/** How much further back each floor up is walked (shop-relative z). */
export const LEVEL_DZ = -16;
/** One storey's height (the walls are a unit tall). */
export const STOREY = 1;
/** Shop-relative z beyond which a point is upstairs (the plot ends before it). */
const UPPER_Z = -12;
/** The pieces that go up to the next floor. */
export const VERTICAL: ReadonlySet<FixtureType> = new Set<FixtureType>(['stairs', 'escalator', 'elevator']);
/** Which floor a shop-relative z is on (0: the ground floor). */
export function levelOfZ(z: number): number { return z >= UPPER_Z ? 0 : Math.min(MAX_LEVELS - 1, Math.round((-4 - z) / -LEVEL_DZ)); }
/** A ground z carried up to floor `level`. */
export const zOnLevel = (z: number, level: number): number => z + level * LEVEL_DZ;
/** The ground z under a point on any floor. */
export const groundZ = (z: number): number => z - levelOfZ(z) * LEVEL_DZ;
/** Which floor a piece stands on. */
export const levelOf = (f: { z: number }): number => levelOfZ(f.z + 0.5);

export interface Storeys {
  /** Which floors are open (reached by stairs, an escalator or a lift from the floor below): [0] always. */
  built: boolean[];
  /** The highest open floor. */
  top: number;
  /** Floor by floor, the tiles (ground keys "x,z") people can stand on: [0] the ground floor's. */
  floors: Set<string>[];
  /** Floor by floor, the building's footprint there (keys): a whole open floor, or over the floor below where no panel is (a double-height space). */
  inside: Set<string>[];
  /** Openings in each floor (keys): where the stairs, an escalator or a lift come up through it. */
  holes: Set<string>[];
}
// Keyed on the fixtures, checked against the very gaps and ceiling rows it was worked out from (both are only
// ever replaced, never edited): a trial shop with the same counts but other tiles must not be handed another's.
const storeyCache = new WeakMap<object, { sig: string; gaps?: string[]; rows?: string[][]; st: Storeys }>();
/** The panels over floor `level` (keys); an old save has them over the whole ground floor. */
export function panelsOver(shop: FloorShape, level: number): Set<string> {
  const row = shop.ceilings?.[level];
  if (row) return new Set(row);
  return level === 0 && !shop.ceilings ? new Set(groundTiles(shop).map((t) => tileKey(t.x, t.z))) : new Set();
}
function groundTiles(shop: FloorShape): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const f = shop.floor;
  for (let z = f.z0; z < f.z1 - 1e-6; z++) for (let x = f.x0; x < f.x1 - 1e-6; x++) if (isFloor(shop, x, z)) out.push({ x, z });
  return out;
}
/** Every floor of the building: which are open, where people stand on each, and the shape of each. */
export function storeysOf(shop: FloorShape): Storeys {
  const fixtures = shop.fixtures ?? [];
  let sig = `${shop.layoutVersion ?? ''}|${JSON.stringify(shop.floor)}|${shop.gaps?.length ?? 0}|${shop.ceilings?.map((r) => r.length).join(',') ?? '-'}|`;
  for (const f of fixtures) if (VERTICAL.has(f.type)) sig += `${f.type}${f.x},${f.z},${f.rot};`;
  const key = (shop.fixtures ?? shop) as object;
  const hit = storeyCache.get(key);
  if (hit && hit.sig === sig && hit.gaps === shop.gaps && (hit.rows ?? []).every((r, i) => r === shop.ceilings?.[i])) return hit.st;
  const ground = new Set(groundTiles(shop).map((t) => tileKey(t.x, t.z)));
  const st: Storeys = { built: [true], top: 0, floors: [ground], inside: [ground], holes: [new Set()] };
  for (let L = 1; L < MAX_LEVELS; L++) {
    const up = fixtures.filter((f) => VERTICAL.has(f.type) && levelOf(f) === L - 1);
    const built = st.built[L - 1]! && up.length > 0;
    st.built.push(built);
    const holes = new Set<string>();
    for (const f of up) {
      const r = footprintOf(f.type, f.x, groundZ(f.z), f.rot);
      for (let z = r.z0; z < r.z1 - 1e-6; z++) for (let x = r.x0; x < r.x1 - 1e-6; x++) holes.add(tileKey(x, z));
    }
    st.holes.push(holes);
    const panels = panelsOver(shop, L - 1);
    const floor = new Set<string>();
    if (built) for (const k of panels) if (ground.has(k) && !holes.has(k)) floor.add(k);
    st.floors.push(floor);
    // The building there: all of it once the floor is open; else, over an open floor, just where no panel is.
    const inside = new Set<string>();
    if (built) for (const k of st.inside[L - 1]!) inside.add(k);
    else if (st.built[L - 1]) for (const k of st.inside[L - 1]!) if (!panels.has(k)) inside.add(k);
    st.inside.push(inside);
    if (built) st.top = L;
  }
  storeyCache.set(key, { sig, gaps: shop.gaps, rows: shop.ceilings && [...shop.ceilings], st });
  return st;
}
/** The floor area people can shop on: the ground floor and every open floor above it. */
export function shopArea(shop: FloorShape): number {
  const st = storeysOf(shop);
  return st.floors.reduce((a, f, L) => a + (st.built[L] ? f.size : 0), 0);
}
/** Tiles under a double-height space (no panel over them, the building a storey taller there), on every open floor. */
export function highCeilings(shop: FloorShape): number {
  const st = storeysOf(shop);
  let n = 0;
  for (let L = 0; L < MAX_LEVELS - 1; L++) {
    if (!st.built[L]) continue;
    const panels = panelsOver(shop, L);
    for (const k of st.floors[L]!) if (!panels.has(k) && st.inside[L + 1]!.has(k)) n++;
  }
  return n;
}
/** Upstairs: is the tile (its corner, shop-relative on that floor's region) floor people stand on? */
function upperFloor(shop: FloorShape, x: number, z: number): boolean {
  const L = levelOfZ(z + 0.5);
  if (!L) return false;
  return storeysOf(shop).floors[L]?.has(tileKey(x, zOnLevel(z, -L))) ?? false;
}
/** Every floor tile of floor `level` (corners in that floor's region). */
export function levelTileList(shop: FloorShape, level: number): { x: number; z: number }[] {
  if (level === 0) return floorTileList(shop);
  return [...(storeysOf(shop).floors[level] ?? [])].map((k) => { const [x, z] = k.split(',').map(Number) as [number, number]; return { x, z: zOnLevel(z, level) }; });
}
/** Every floor tile of every open floor (corners in each floor's region): the whole shop, for its finish. */
export function shopTileList(shop: FloorShape): { x: number; z: number }[] {
  const st = storeysOf(shop);
  return st.built.flatMap((b, L) => b ? levelTileList(shop, L) : []);
}
/** Is the tile (ground corner) inside the building on floor `level` (floor, an opening, or a double-height space)? */
export function insideOn(shop: FloorShape, level: number, x: number, z: number): boolean { return storeysOf(shop).inside[level]?.has(tileKey(x, z)) ?? false; }
/** Where you come off going up a piece (the tile beyond its top, on the floor above) and get on going down: tile centres, shop-relative. */
export function rideEnds(f: { type: FixtureType; x: number; z: number; rot: number }): { bottom: Vec2; top: Vec2 } {
  const fc = [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }][f.rot & 3]!;
  const bottom = { x: f.x + 0.5 + fc.x, z: f.z + 0.5 + fc.z };
  // A lift comes out the way it went in, a floor up; stairs and an escalator carry on past their top step.
  const d = f.type === 'elevator' ? -1 : FIXTURES[f.type].d;
  return { bottom, top: { x: f.x + 0.5 - fc.x * d, z: zOnLevel(f.z + 0.5 - fc.z * d, 1) } };
}
/** A world point as it really stands: one upstairs (in its floor's region) back over the ground floor, `y` a storey up a floor. */
export function liftWorld(f: Frame, x: number, z: number): { x: number; y: number; z: number; level: number } {
  const l = toLocal(f, x, z);
  const level = l.x > MAX_FLOOR.x0 - 1.5 && l.x < MAX_FLOOR.x1 + 1.5 ? levelOfZ(l.z) : 0;
  if (!level) return { x, y: 0, z, level: 0 };
  const w = toWorld(f, l.x, zOnLevel(l.z, -level));
  return { x: w.x, y: level * STOREY, z: w.z, level };
}
/** A world point on floor `level` (over the ground) carried into that floor's region, where the sim walks it. */
export function sinkWorld(f: Frame, x: number, z: number, level: number): Vec2 {
  if (!level) return { x, z };
  const l = toLocal(f, x, z);
  return toWorld(f, l.x, zOnLevel(l.z, level));
}
/** How long a ride takes (seconds), and how far it counts for on a path (in half-tile steps). */
export const RIDE: Partial<Record<FixtureType, { secs: number; cost: number }>> = { stairs: { secs: 2.4, cost: 12 }, escalator: { secs: 2.0, cost: 7 }, elevator: { secs: 3.2, cost: 9 } };

export const FIXTURES: Record<FixtureType, FixtureDef> = {
  // Checkout.
  register: { type: 'register', name: 'Checkout counter', price: 180, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'checkout' },
  kiosk: { type: 'kiosk', name: 'Self-checkout', price: 650, w: 1, d: 1, depth: 0.49, slots: 0, capacity: 0, chilled: false, upkeep: 3, category: 'checkout' },
  rack: { type: 'rack', name: 'Checkout rack', price: 45, w: 1, d: 1, slots: 2, capacity: 8, chilled: false, upkeep: 0, category: 'checkout' },
  // Shelves and fridges.
  shelf: { type: 'shelf', name: 'Shelf', price: 85, w: 1, d: 1, slots: 4, capacity: 8, chilled: false, upkeep: 0, category: 'shelves' },
  endcap: { type: 'endcap', name: 'End cap', price: 70, w: 1, d: 1, depth: 0.41, slots: 2, capacity: 6, chilled: false, upkeep: 0, category: 'shelves' },
  produce: { type: 'produce', name: 'Produce stand', price: 60, w: 1, d: 1, depth: 0.61, slots: 2, capacity: 10, chilled: false, upkeep: 0, accepts: ['produce'], category: 'shelves' },
  /** More room for deliveries, on the shop floor wherever you put it. */
  pallet: { type: 'pallet', name: 'Pallet', price: 60, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'shelves' },
  // More displays (any shelf takes most goods; these hold more of their kind, and look the part).
  iceChest: { type: 'iceChest', name: 'Ice-cream chest', price: 260, w: 1, d: 1, depth: 0.61, slots: 4, capacity: 10, chilled: true, upkeep: 7, accepts: ['frozen', 'dairy'], category: 'shelves' },
  coolProduce: { type: 'coolProduce', name: 'Chilled produce', price: 220, w: 1, d: 1, depth: 0.61, slots: 3, capacity: 12, chilled: true, mixed: true, upkeep: 5, accepts: ['produce'], category: 'shelves' },
  wallShelf: { type: 'wallShelf', name: 'Wall shelf', price: 50, w: 1, d: 1, slots: 2, capacity: 6, chilled: false, upkeep: 0, category: 'shelves', walkable: true, onWall: true },
  glassCase: { type: 'glassCase', name: 'Glass counter', price: 240, w: 1, d: 1, depth: 0.61, slots: 2, capacity: 8, chilled: false, upkeep: 1, accepts: ['beauty', 'electronics', 'clothing', 'toys'], category: 'shelves' },
  displayTable: { type: 'displayTable', name: 'Display table', price: 180, w: 2, d: 1, slots: 4, capacity: 10, chilled: false, upkeep: 0, accepts: ['toys', 'electronics', 'home', 'books', 'sports', 'clothing', 'beauty', 'seasonal'], category: 'shelves' },
  bakeryCase: { type: 'bakeryCase', name: 'Bakery case', price: 190, w: 1, d: 1, depth: 0.61, slots: 3, capacity: 10, chilled: false, upkeep: 2, accepts: ['bakery'], category: 'shelves' },
  clothesRail: { type: 'clothesRail', name: 'Clothes rail', price: 90, w: 1, d: 1, slots: 2, capacity: 12, chilled: false, upkeep: 0, accepts: ['clothing'], category: 'shelves' },
  /** Shoppers pay at the machine: no till. */
  vending: { type: 'vending', name: 'Vending machine', price: 700, w: 1, d: 1, depth: 0.61, slots: 4, capacity: 8, chilled: true, mixed: true, upkeep: 4, accepts: ['drinks', 'dry'], category: 'checkout' },
  /** Tall metal racking two tiles long: a lot more room for deliveries. */
  storeRack: { type: 'storeRack', name: 'Storage rack', price: 400, w: 2, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'shelves' },
  fridge: { type: 'fridge', name: 'Chiller', price: 200, w: 1, d: 1, depth: 0.61, slots: 4, capacity: 6, chilled: true, upkeep: 6, category: 'shelves' },
  freezer: { type: 'freezer', name: 'Tall fridge', price: 300, w: 1, d: 1, depth: 0.51, slots: 2, capacity: 12, chilled: true, upkeep: 8, accepts: ['dairy', 'meat'], category: 'shelves' },
  // Furniture.
  bench: { type: 'bench', name: 'Bench', price: 45, w: 1, d: 1, depth: 0.39, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'furniture', looks: 0.08, looksCap: 2 },
  sofa: { type: 'sofa', name: 'Cushioned bench', price: 70, w: 1, d: 1, depth: 0.39, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'furniture', looks: 0.09, looksCap: 2 },
  cafe: { type: 'cafe', name: 'Café table', price: 120, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'furniture', looks: 0.12, looksCap: 2 },
  desk: { type: 'desk', name: 'Help desk', price: 150, w: 1, d: 1, depth: 0.43, slots: 0, capacity: 0, chilled: false, upkeep: 1, category: 'furniture', looks: 0.05, looksCap: 1 },
  basketStack: { type: 'basketStack', name: 'Baskets', price: 30, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'furniture', looks: 0.1, looksCap: 1 },
  trolleys: { type: 'trolleys', name: 'Trolley bay', price: 90, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'furniture', looks: 0.05, looksCap: 1 },
  bin: { type: 'bin', name: 'Litter bin', price: 20, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'furniture', looks: 0.04, looksCap: 2 },
  speaker: { type: 'speaker', name: 'Music speaker', price: 60, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 1, category: 'furniture', looks: 0.05, looksCap: 1 },
  screen: { type: 'screen', name: 'Promo screen', price: 140, w: 1, d: 1, depth: 0.23, slots: 0, capacity: 0, chilled: false, upkeep: 2, category: 'furniture', looks: 0.07, looksCap: 2 },
  bookcase: { type: 'bookcase', name: 'Magazine shelf', price: 55, w: 1, d: 1, depth: 0.29, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'furniture', looks: 0.06, looksCap: 2 },
  // Decor.
  plant: { type: 'plant', name: 'Plant', price: 25, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'decor', looks: 0.13, looksCap: 4 },
  flowers: { type: 'flowers', name: 'Flower table', price: 35, w: 1, d: 1, depth: 0.21, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'decor', looks: 0.1, looksCap: 3 },
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
  /** Twice as tall as a wall: for a double-height space, where the ceiling panel above has been sold. */
  tallWall: { type: 'tallWall', name: 'Tall wall', price: 75, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'walls' },
  // Lights.
  floorLamp: { type: 'floorLamp', name: 'Floor lamp', price: 45, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 1, category: 'lights', looks: 0.07, looksCap: 4 },
  wallLight: { type: 'wallLight', name: 'Wall light', price: 30, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 1, category: 'lights', walkable: true, onWall: true, looks: 0.06, looksCap: 4 },
  pendant: { type: 'pendant', name: 'Hanging light', price: 40, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 1, category: 'lights', walkable: true, looks: 0.06, looksCap: 6 },
  neon: { type: 'neon', name: 'Neon sign', price: 80, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 1, category: 'lights', walkable: true, onWall: true, looks: 0.1, looksCap: 2 },
  // Security: cameras watch part of the floor (a thief seen bolts into more trouble, and fewer try), tag gates beep at the door.
  camera: { type: 'camera', name: 'Security camera', price: 250, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 1, category: 'security', walkable: true, onWall: true },
  dome: { type: 'dome', name: 'Dome camera', price: 600, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 2, category: 'security', walkable: true, overhead: true },
  smartCam: { type: 'smartCam', name: 'Smart camera', price: 1800, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 4, category: 'security', walkable: true, overhead: true },
  tagGate: { type: 'tagGate', name: 'Tag gates', price: 450, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 2, category: 'security', walkable: true },
  // Out on the lot (looksCap counts toward the frontage's looks, as `looks` does inside).
  flowerBed: { type: 'flowerBed', name: 'Flower bed', price: 20, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'outside', outdoor: true, curb: 0.06, looksCap: 6 },
  planter: { type: 'planter', name: 'Planter', price: 30, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'outside', outdoor: true, curb: 0.05, looksCap: 6 },
  tree: { type: 'tree', name: 'Tree', price: 45, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'outside', outdoor: true, curb: 0.08, looksCap: 5 },
  parkBench: { type: 'parkBench', name: 'Bench', price: 40, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'outside', outdoor: true, curb: 0.05, looksCap: 3 },
  /** Shoppers ride over and leave their bikes here (three to a rack). */
  bikeRack: { type: 'bikeRack', name: 'Bike rack', price: 50, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'outside', outdoor: true, curb: 0.02, looksCap: 2 },
  /** Your own board on your own lot: no rent, and drivers on Main Road see it every day. */
  billboard: { type: 'billboard', name: 'Billboard', price: 300, w: 2, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'outside', outdoor: true },
  // Up to the next floor: each runs back from its front tile and comes up through the floor above.
  stairs: { type: 'stairs', name: 'Stairs', price: 450, w: 1, d: 2, slots: 0, capacity: 0, chilled: false, upkeep: 0, category: 'storeys' },
  escalator: { type: 'escalator', name: 'Escalator', price: 1600, w: 1, d: 2, slots: 0, capacity: 0, chilled: false, upkeep: 5, category: 'storeys' },
  elevator: { type: 'elevator', name: 'Lift', price: 2200, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 4, category: 'storeys' },
};

/**
 * The part of a piece's tile people cannot walk through, in tile coordinates: the back half for a piece
 * that reaches no further than a little past the middle (a chiller, an end cap: the floor in front of
 * it is open), otherwise the whole of its footprint.
 */
export function blockedRect(f: { type: FixtureType; x: number; z: number; rot: number }): Rect {
  const d = FIXTURES[f.type].depth;
  if (d === undefined || d > 0.65) return footprintOf(f.type, f.x, f.z, f.rot);
  switch (f.rot & 3) {
    case 0: return { x0: f.x, z0: f.z, x1: f.x + 1, z1: f.z + 0.5 };
    case 1: return { x0: f.x, z0: f.z, x1: f.x + 0.5, z1: f.z + 1 };
    case 2: return { x0: f.x, z0: f.z + 0.5, x1: f.x + 1, z1: f.z + 1 };
    default: return { x0: f.x + 0.5, z0: f.z, x1: f.x + 1, z1: f.z + 1 };
  }
}
/**
 * What each piece's model actually covers (measured from the models, as drawn): its width across the
 * tile and depth from the back edge, or for a piece standing in the middle of its tile its size there.
 * Missing: the whole tile.
 */
const BODY: Partial<Record<FixtureType, { w: number; d: number; centred?: boolean }>> = {
  register: { w: 0.85, d: 0.86 }, shelf: { w: 0.8, d: 0.71 }, rack: { w: 0.8, d: 0.71 }, fridge: { w: 0.8, d: 0.61 }, freezer: { w: 1, d: 0.51 },
  produce: { w: 0.7, d: 0.61 }, endcap: { w: 0.8, d: 0.41 }, kiosk: { w: 0.46, d: 0.49 }, trolleys: { w: 0.5, d: 0.75 }, desk: { w: 0.76, d: 0.43 },
  screen: { w: 0.7, d: 0.23 }, bookcase: { w: 0.44, d: 0.29 }, flowers: { w: 0.48, d: 0.21 }, bench: { w: 0.83, d: 0.39 }, sofa: { w: 0.83, d: 0.39 },
  sign: { w: 0.72, d: 0.72, centred: true }, plant: { w: 0.3, d: 0.3, centred: true }, basketStack: { w: 0.36, d: 0.36, centred: true },
  cafe: { w: 0.9, d: 0.5, centred: true }, bin: { w: 0.24, d: 0.24, centred: true }, speaker: { w: 0.2, d: 0.2, centred: true }, floorLamp: { w: 0.2, d: 0.2, centred: true },
  wall: { w: 1, d: 0.22, centred: true }, wallWindow: { w: 1, d: 0.22, centred: true }, railing: { w: 1, d: 0.16, centred: true },
};
/** The floor a piece's body covers, in tile coordinates (null: nothing to bump into, or no measure: the grid has it). */
export function solidRect(f: { type: FixtureType; x: number; z: number; rot: number }): Rect | null {
  if (FIXTURES[f.type].walkable) return null;
  const b = BODY[f.type];
  if (!b) return null;
  const along = (f.rot & 1) === 0; // its width runs along x
  const hw = b.w / 2;
  if (b.centred) { const cx = f.x + 0.5, cz = f.z + 0.5, hx = along ? hw : b.d / 2, hz = along ? b.d / 2 : hw; return { x0: cx - hx, z0: cz - hz, x1: cx + hx, z1: cz + hz }; }
  switch (f.rot & 3) {
    case 0: return { x0: f.x + 0.5 - hw, z0: f.z, x1: f.x + 0.5 + hw, z1: f.z + b.d };
    case 1: return { x0: f.x, z0: f.z + 0.5 - hw, x1: f.x + b.d, z1: f.z + 0.5 + hw };
    case 2: return { x0: f.x + 0.5 - hw, z0: f.z + 1 - b.d, x1: f.x + 0.5 + hw, z1: f.z + 1 };
    default: return { x0: f.x + 1 - b.d, z0: f.z + 0.5 - hw, x1: f.x + 1, z1: f.z + 0.5 + hw };
  }
}

/** Most of each that the lot takes. */
export const LOT_MAX: Partial<Record<FixtureType, number>> = { billboard: 2, bikeRack: 4 };
/** Bikes a rack holds. */
export const RACK_STANDS = 3;

/** Floor finishes: the price per tile, and what each adds to how the shop looks. */
/** Inside finishes for the outer walls, a stretch (one tile's edge) at a time. Plain plaster comes with the shop. */
export const WALLS: { id: WallStyle; name: string; perSeg: number; looks: number }[] = [
  { id: 'plain', name: 'Plain plaster', perSeg: 0, looks: 0 },
  { id: 'bands', name: 'Painted in your colours', perSeg: 6, looks: 0.12 },
  { id: 'tiles', name: 'White tiles', perSeg: 8, looks: 0.14 },
  { id: 'wood', name: 'Wood panelling', perSeg: 10, looks: 0.16 },
  { id: 'brick', name: 'Bare brick', perSeg: 12, looks: 0.18 },
];
/** What a finish gives back when it is replaced or taken off. */
export const RESALE = 0.6;
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
