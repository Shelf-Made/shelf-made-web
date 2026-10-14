/**
 * The town plan: where every static thing stands, generated deterministically from the
 * seed and the chosen plot. Pure data so tests and the renderer agree.
 */
import { Rng } from '@/sim/rng';
import { PLOTS, ROAD_Z, MAP_X, MAP_Z, STARTER } from '@/sim/layout';

export interface Placement { model: string; x: number; y?: number; z: number; yaw: number; scale?: number }
export interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface RivalSite { id: string; name: string; x: number; z: number; kind: 'discount' | 'premium' | 'chain' }

export interface TownPlan {
  placements: Placement[];
  /** Flat painted areas: colour + rect + height. */
  slabs: { color: string; rect: Rect; y: number; h: number }[];
  rivals: RivalSite[];
  /** Lamp positions for night lights. */
  lamps: { x: number; z: number }[];
  /** Parked cars in driveways. */
  parked: { model: number; x: number; z: number; yaw: number }[];
}

const HOUSES = 'abcdefghijklmnopqrstu'.split('').map((l) => `suburban/house-${l}`);
const TREES = ['nature/tree-default', 'nature/tree-oak', 'nature/tree-fat', 'nature/tree-small', 'nature/tree-tall', 'nature/tree-detailed', 'nature/tree-simple'];
const STREET_TREES = ['suburban/tree-large', 'suburban/tree-small'];
const BUSHES = ['nature/plant-bush', 'nature/plant-bushsmall', 'nature/plant-bushlarge'];
const FLOWERS = ['nature/flower-reda', 'nature/flower-yellowa', 'nature/flower-purplea', 'nature/flower-redb', 'nature/flower-yellowb'];
const SHOPS = 'abcdefghikl'.split('').map((l) => `commercial/shop-${l}`);

export const RIVAL_DEFS: Omit<RivalSite, 'x' | 'z'>[] = [
  { id: 'discount', name: 'Cheapo', kind: 'discount' },
  { id: 'premium', name: 'Fresh & Fine', kind: 'premium' },
  { id: 'chain', name: 'MegaMart', kind: 'chain' },
];

export function buildTown(seed: number, plotId: string): TownPlan {
  const rng = new Rng(seed ^ 0x7a77);
  const plan: TownPlan = { placements: [], slabs: [], rivals: [], lamps: [], parked: [] };
  const P = plan.placements;
  const chosen = PLOTS.find((p) => p.id === plotId) ?? PLOTS[0]!;
  const houseIdx = () => rng.int(0, HOUSES.length - 1);

  // Roads: main road and two cross streets, Kenney tiles at scale 2.
  const crossXs = [-36, 36];
  for (let x = -MAP_X - 8; x <= MAP_X + 8; x += 2) {
    const cross = crossXs.find((cx) => Math.abs(cx - x) < 1);
    P.push({ model: cross !== undefined ? 'roads/road-crossroad' : 'roads/road-straight', x, y: 0.001, z: ROAD_Z, yaw: 0 });
  }
  for (const cx of crossXs) {
    for (let z = -MAP_Z - 8; z <= MAP_Z + 8; z += 2) {
      if (Math.abs(z - ROAD_Z) < 1) continue;
      P.push({ model: 'roads/road-straight', x: cx, y: 0.001, z, yaw: Math.PI / 2 });
    }
  }
  // Sidewalks along the main road.
  plan.slabs.push({ color: '#B9BCC4', rect: { x0: -MAP_X - 8, z0: ROAD_Z - 1.55, x1: MAP_X + 8, z1: ROAD_Z - 0.95 }, y: 0, h: 0.06 });
  plan.slabs.push({ color: '#B9BCC4', rect: { x0: -MAP_X - 8, z0: ROAD_Z + 0.95, x1: MAP_X + 8, z1: ROAD_Z + 1.55 }, y: 0, h: 0.06 });
  for (const cx of crossXs) {
    plan.slabs.push({ color: '#B9BCC4', rect: { x0: cx - 1.55, z0: -MAP_Z - 8, x1: cx - 0.95, z1: MAP_Z + 8 }, y: 0, h: 0.06 });
    plan.slabs.push({ color: '#B9BCC4', rect: { x0: cx + 0.95, z0: -MAP_Z - 8, x1: cx + 1.55, z1: MAP_Z + 8 }, y: 0, h: 0.06 });
  }

  const house = (x: number, z: number, facingSouth: boolean, lotW: number, withDrive = true) => {
    const yaw = facingSouth ? 0 : Math.PI;
    P.push({ model: HOUSES[houseIdx()]!, x, z, yaw });
    // Garden: path to the sidewalk, fence along the front, a tree or two, bushes, flowers.
    const frontZ = facingSouth ? z + 1.6 : z - 1.6;
    const sidewalkZ = facingSouth ? ROAD_Z - 1.55 : ROAD_Z + 1.55;
    plan.slabs.push({ color: '#D6D2C8', rect: { x0: x - 0.35, z0: Math.min(frontZ, sidewalkZ), x1: x + 0.35, z1: Math.max(frontZ, sidewalkZ) }, y: 0, h: 0.04 });
    if (withDrive) {
      const dx = x + lotW / 2 - 1.1;
      plan.slabs.push({ color: '#A9ACB5', rect: { x0: dx - 0.7, z0: Math.min(frontZ - 0.3, sidewalkZ), x1: dx + 0.7, z1: Math.max(frontZ - 0.3, sidewalkZ) }, y: 0, h: 0.04 });
      if (rng.chance(0.6)) plan.parked.push({ model: rng.int(0, 5), x: dx, z: facingSouth ? frontZ + 0.3 : frontZ - 0.3, yaw: facingSouth ? 0 : Math.PI });
    }
    const fenceZ = sidewalkZ + (facingSouth ? -0.35 : 0.35);
    for (let fx = x - lotW / 2 + 0.75; fx < x + lotW / 2 - 0.4; fx += 1.43) {
      if (Math.abs(fx - x) < 0.9) continue;
      if (withDrive && Math.abs(fx - (x + lotW / 2 - 1.1)) < 1.1) continue;
      P.push({ model: 'suburban/fence', x: fx, z: fenceZ, yaw: Math.PI / 2 });
    }
    const tx = x - lotW / 2 + 1.2;
    P.push({ model: TREES[rng.int(0, TREES.length - 1)]!, x: tx, z: facingSouth ? z + 1.2 : z - 1.2, yaw: rng.range(0, 6.28), scale: rng.range(0.8, 1.1) });
    for (let i = 0; i < 3; i++) P.push({ model: BUSHES[rng.int(0, BUSHES.length - 1)]!, x: x + rng.range(-1.6, 1.6), z: facingSouth ? frontZ + rng.range(0.2, 0.6) : frontZ - rng.range(0.2, 0.6), yaw: rng.range(0, 6.28) });
    for (let i = 0; i < 4; i++) P.push({ model: FLOWERS[rng.int(0, FLOWERS.length - 1)]!, x: x + rng.range(-2.2, 2.2), z: facingSouth ? frontZ + rng.range(0.8, 1.4) : frontZ - rng.range(0.8, 1.4), yaw: 0 });
  };

  // North side: the three plots (one is the shop), fillers between and beyond.
  const northZ = -4.2;
  for (const plot of PLOTS) {
    if (plot.id === chosen.id) continue;
    house(plot.x - 4, northZ, true, 8);
    house(plot.x + 4, northZ, true, 8);
  }
  for (const x of [-10.6, 10.6]) house(x, northZ, true, 5.2, false);
  for (const x of [-33, 33, -41, 41, -48, 48]) house(x, northZ, true, 7);
  // Second row behind, facing away (we only see their backs and roofs).
  for (let x = -46; x <= 46; x += 7.5) {
    if (Math.abs(x + 36) < 2.5 || Math.abs(x - 36) < 2.5) continue;
    P.push({ model: HOUSES[houseIdx()]!, x: x + rng.range(-0.3, 0.3), z: -12.5, yaw: Math.PI });
    P.push({ model: TREES[rng.int(0, TREES.length - 1)]!, x: x + 3.4, z: -10.5 + rng.range(-0.5, 0.5), yaw: rng.range(0, 6.28) });
  }

  // South side: rivals and houses.
  const southZ = ROAD_Z + 6.4;
  const rivalXs = { discount: -20, premium: 20, chain: 44 };
  for (const r of RIVAL_DEFS) {
    const x = rivalXs[r.kind];
    plan.rivals.push({ ...r, x, z: southZ });
    const shopA = SHOPS[rng.int(0, SHOPS.length - 1)]!, shopB = SHOPS[rng.int(0, SHOPS.length - 1)]!;
    P.push({ model: shopA, x: x - 1.35, z: southZ, yaw: Math.PI });
    P.push({ model: shopB, x: x + 1.35, z: southZ, yaw: Math.PI });
    // Forecourt paving and a couple of parking bays.
    plan.slabs.push({ color: '#A9ACB5', rect: { x0: x - 4.2, z0: ROAD_Z + 1.55, x1: x + 4.2, z1: southZ - 1.3 }, y: 0, h: 0.04 });
    plan.parked.push({ model: rng.int(0, 5), x: x - 3.0, z: southZ - 2.4, yaw: 0 });
    if (rng.chance(0.5)) plan.parked.push({ model: rng.int(0, 5), x: x + 3.0, z: southZ - 2.4, yaw: 0 });
  }
  for (const x of [-31, -8, 0, 8, 31, -42, 42]) house(x, southZ, false, 7);
  for (let x = -46; x <= 46; x += 7.5) {
    if (Math.abs(x + 36) < 2.5 || Math.abs(x - 36) < 2.5) continue;
    P.push({ model: HOUSES[houseIdx()]!, x: x + rng.range(-0.3, 0.3), z: southZ + 8.4, yaw: 0 });
  }

  // Street trees and lamps along the main road, skipping the shop's driveway and door.
  const shopX = chosen.x;
  const skip = (x: number) => Math.abs(x - (shopX + 6)) < 1.6 || Math.abs(x - shopX) < 1.2 || Math.abs(x - (shopX - 4.5)) < 1.4 || crossXs.some((cx) => Math.abs(cx - x) < 2.2);
  for (let x = -MAP_X - 6; x <= MAP_X + 6; x += 5.5) {
    const tx = x + rng.range(-0.6, 0.6);
    if (!skip(tx)) P.push({ model: STREET_TREES[rng.int(0, 1)]!, x: tx, z: ROAD_Z - 1.9, yaw: rng.range(0, 6.28) });
    const tx2 = x + 2.7 + rng.range(-0.6, 0.6);
    P.push({ model: STREET_TREES[rng.int(0, 1)]!, x: tx2, z: ROAD_Z + 1.9, yaw: rng.range(0, 6.28) });
  }
  for (let x = -MAP_X - 4 + 1.5; x <= MAP_X + 4; x += 9) {
    if (skip(x)) continue;
    P.push({ model: 'roads/lamp', x, z: ROAD_Z - 1.2, yaw: Math.PI });
    plan.lamps.push({ x, z: ROAD_Z - 1.2 });
    P.push({ model: 'roads/lamp', x: x + 4.5, z: ROAD_Z + 1.2, yaw: 0 });
    plan.lamps.push({ x: x + 4.5, z: ROAD_Z + 1.2 });
  }
  // The shop's own lawn: trees at the back corners, bushes along the front, flowers in the bed.
  const sx0 = shopX + STARTER.plot.x0;
  P.push({ model: 'nature/tree-oak', x: sx0 + 0.9, z: -1.6 + STARTER.plot.z0 + 1.0, yaw: 0.4, scale: 0.9 });
  P.push({ model: 'nature/tree-default', x: sx0 + 2.3, z: -1.6 - 5.4, yaw: 1.2, scale: 0.85 });
  P.push({ model: 'suburban/tree-small', x: shopX + STARTER.plot.x1 - 0.6, z: -1.6 + STARTER.plot.z0 + 1.2, yaw: 0 });
  for (let i = 0; i < 6; i++) P.push({ model: FLOWERS[i % FLOWERS.length]!, x: sx0 + 1.0 + (i % 2) * 0.6 + rng.range(-0.1, 0.1), z: -1.6 - 3.4 + Math.floor(i / 2) * 0.6, yaw: rng.range(0, 6.28) });
  for (let i = 0; i < 4; i++) P.push({ model: BUSHES[i % BUSHES.length]!, x: sx0 + 0.6 + i * 0.75, z: -1.6 + 0.7, yaw: rng.range(0, 6.28) });
  for (let i = 0; i < 3; i++) P.push({ model: BUSHES[(i + 1) % BUSHES.length]!, x: shopX - 3.1 - i * 0.05, z: -1.6 - 1.0 - i * 1.1, yaw: rng.range(0, 6.28) });
  // Street furniture near the shop: a bench and a bin by the sidewalk, a street sign at the corner.
  P.push({ model: 'furniture/bench', x: shopX - 2.4, z: ROAD_Z - 1.8, yaw: 0 });
  P.push({ model: 'furniture/trashcan', x: shopX - 3.1, z: ROAD_Z - 1.8, yaw: 0 });
  P.push({ model: 'roads/sign-street', x: crossXs[0]! + 1.9, z: ROAD_Z - 1.9, yaw: 0 });
  P.push({ model: 'roads/sign-street', x: crossXs[1]! - 1.9, z: ROAD_Z + 1.9, yaw: Math.PI });
  P.push({ model: 'roads/dumpster', x: shopX + STARTER.backYard.x1 - 1.0, z: -1.6 + STARTER.backYard.z0 + 0.8, yaw: Math.PI / 2 });
  return plan;
}
