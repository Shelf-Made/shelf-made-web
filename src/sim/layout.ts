/**
 * World layout constants. 1 unit = 1 store tile. x runs east, z runs south (toward the
 * camera). The main road runs east–west along z = ROAD_Z; the player's plots sit on its
 * north side (negative z).
 */
import type { Plot, Vec2, FixtureDef, FixtureType } from './types';

export const TICK = 0.05;
/** 12 game hours of 60 real seconds each. */
export const DAY_SECONDS = 12 * 60;
export const OPEN_HOUR = 8;
export const CLOSE_TIME = DAY_SECONDS;

export const ROAD_Z = 2.5;
export const LANE_WEST_Z = 2.0;
export const LANE_EAST_Z = 3.0;
export const SIDEWALK_N_Z = 1.25;
export const SIDEWALK_S_Z = 3.75;
export const MAP_X = 44;
export const MAP_Z = 18;

/**
 * The valley. Main Street runs east–west through the middle; two cross streets meet it, the north
 * ends of both join Back Lane behind the shops, the south ends cross the river on bridges. Every road
 * runs on past the town edge into the fog, so traffic appears and leaves out of sight.
 */
export const CROSS_XS = [-35, 39] as const;
export const BACK_Z = -21.5;
export const BACK_LANE_WEST_Z = BACK_Z - 0.5;
export const BACK_LANE_EAST_Z = BACK_Z + 0.5;
/** Where traffic spawns and despawns along each road (hidden by distance fog). */
export const ROAD_FAR = 92;
/** The river: its centre line wanders a little around z = 24. Half width of the water. */
export const RIVER_HALF_W = 2.3;
export function riverZ(x: number): number { return 24 + 2.4 * Math.sin(x / 17) + 1.1 * Math.sin(x / 7.3 + 1.3); }
/** Every shop plot owns this rectangle (plot-relative), big enough for the largest shop with the doubled lot. */
export const PLOT_RECT = { x0: -8, z0: -11.6, x1: 12.6, z1: 2.55 };

export const WALK_SPEED = 1.6;
export const CAR_ROAD_SPEED = 6;
export const CAR_LOT_SPEED = 2.2;

export const PLOTS: Plot[] = [
  { id: 'main', name: 'Main Street', blurb: 'Busiest corner in town. More passing trade, higher rent, shoppers in a hurry.', x: 0, rent: 40, traffic: 1.2, mix: { bargain: 0.9, convenience: 1.4, loyalist: 0.9, impulse: 1.1 } },
  { id: 'hill', name: 'Hillside', blurb: 'Quiet street of families. Loyal regulars who notice prices; less passing traffic.', x: -22, rent: 30, traffic: 0.8, mix: { bargain: 1.3, convenience: 0.7, loyalist: 1.3, impulse: 0.8 } },
  { id: 'east', name: 'East End', blurb: 'By the school and the park. Snacks and drinks fly off the shelf after three.', x: 22, rent: 35, traffic: 1.0, mix: { bargain: 0.9, convenience: 1.0, loyalist: 0.8, impulse: 1.5 } },
];

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

/** The delivery zone for any floor: two tiles in the back-left corner beside the back door. */
export function deliveryZone(floor: Rect): Rect { return { x0: floor.x0, z0: floor.z0, x1: floor.x0 + 2, z1: floor.z0 + 1 }; }

export interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface LotLayout {
  apron: Rect; walkwayX: number; bays: { x: number; z: number; yaw: number }[]; aisle: Rect; driveway: Rect; serviceLane: Rect; backYard: Rect;
  truckStop: { x: number; z: number; yaw: number }; plot: Rect; halfW: number; depth: number;
}

/** The lot around a shop of any size: parking along the east wall, service lane down the west, yard behind. */
export function lotLayout(shop: { floor: Rect; storeroom: Rect; lotRows?: number }): LotLayout {
  const halfW = (shop.floor.x1 - shop.floor.x0) / 2;
  const depth = shop.floor.z1 - shop.storeroom.z0;
  const rows = shop.lotRows ?? 1;
  const bays: { x: number; z: number; yaw: number }[] = [];
  const n = Math.min(8, Math.floor((depth - 1.2) / 1.1));
  for (let k = 0; k < n; k++) bays.push({ x: halfW + 1.6, z: -(depth - 1.1) + k * 1.1, yaw: Math.PI / 2 });
  if (rows > 1) for (let k = 0; k < n; k++) bays.push({ x: halfW + 6.0, z: -(depth - 1.1) + k * 1.1, yaw: -Math.PI / 2 });
  const eastEdge = rows > 1 ? halfW + 7.2 : halfW + 4.5;
  return {
    halfW, depth,
    apron: { x0: -halfW - 1, z0: WALL_T, x1: eastEdge, z1: 1.2 },
    walkwayX: 0,
    bays,
    aisle: { x0: halfW + 2.45, z0: -(depth - 0.4), x1: halfW + 4.45, z1: -0.5 },
    driveway: { x0: halfW + 2.5, z0: -0.5, x1: halfW + 4.4, z1: 1.5 },
    serviceLane: { x0: -halfW - 2.9, z0: -(depth + 2.4), x1: -halfW - 1.1, z1: 1.5 },
    backYard: { x0: -halfW - 1.1, z0: -(depth + 2.4), x1: eastEdge, z1: -depth - WALL_T },
    truckStop: { x: -halfW + 1.3, z: -(depth + 1.4), yaw: Math.PI / 2 },
    plot: { x0: -8, z0: -(depth + 3), x1: Math.max(8, eastEdge + 0.8), z1: 1.5 },
  };
}

/** Shop sizes you can grow into. Costs include the land. */
export const SHOP_SIZES: { id: string; name: string; floor: Rect; storeroom: Rect; cost: number }[] = [
  { id: 'starter', name: 'Corner shop (5×6)', floor: { x0: -2.5, z0: -6, x1: 2.5, z1: 0 }, storeroom: { x0: -2.5, z0: -6, x1: 2.5, z1: -6 }, cost: 0 },
  { id: 'medium', name: 'Neighbourhood grocer (7×7)', floor: { x0: -3.5, z0: -7, x1: 3.5, z1: 0 }, storeroom: { x0: -3.5, z0: -7, x1: 3.5, z1: -7 }, cost: 900 },
  { id: 'large', name: 'Market hall (9×8)', floor: { x0: -4.5, z0: -8, x1: 4.5, z1: 0 }, storeroom: { x0: -4.5, z0: -8, x1: 4.5, z1: -8 }, cost: 2400 },
];
export const LOT_EXPANSION_COST = 500;

/** Where the store's origin sits in world space for a plot: the front door tile centre, just north of the apron. */
export function storeOrigin(plotX: number): Vec2 {
  return { x: plotX, z: -1.6 };
}

export const FIXTURES: Record<FixtureType, FixtureDef> = {
  register: { type: 'register', name: 'Checkout counter', price: 180, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0 },
  shelf: { type: 'shelf', name: 'Shelf', price: 85, w: 1, d: 1, slots: 4, capacity: 8, chilled: false, upkeep: 0 },
  fridge: { type: 'fridge', name: 'Chiller', price: 200, w: 1, d: 1, slots: 4, capacity: 6, chilled: true, upkeep: 6 },
  freezer: { type: 'freezer', name: 'Tall fridge', price: 300, w: 1, d: 1, slots: 2, capacity: 12, chilled: true, upkeep: 8, accepts: ['dairy', 'meat'] },
  produce: { type: 'produce', name: 'Produce stand', price: 60, w: 1, d: 1, slots: 2, capacity: 10, chilled: false, upkeep: 0, accepts: ['produce'] },
  endcap: { type: 'endcap', name: 'End cap', price: 70, w: 1, d: 1, slots: 2, capacity: 6, chilled: false, upkeep: 0 },
  kiosk: { type: 'kiosk', name: 'Self-checkout', price: 650, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 3 },
  rack: { type: 'rack', name: 'Checkout rack', price: 45, w: 1, d: 1, slots: 2, capacity: 8, chilled: false, upkeep: 0 },
  sign: { type: 'sign', name: 'Aisle sign', price: 40, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0 },
  plant: { type: 'plant', name: 'Plant', price: 25, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0 },
  bench: { type: 'bench', name: 'Bench', price: 45, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0 },
  basketStack: { type: 'basketStack', name: 'Baskets', price: 30, w: 1, d: 1, slots: 0, capacity: 0, chilled: false, upkeep: 0 },
};

export const DIFFICULTY = {
  relaxed: { cash: 1200, rentMul: 0.8, demandMul: 1.2, patienceMul: 1.3 },
  standard: { cash: 800, rentMul: 1.0, demandMul: 1.0, patienceMul: 1.0 },
  hard: { cash: 600, rentMul: 1.2, demandMul: 0.85, patienceMul: 0.85 },
} as const;
