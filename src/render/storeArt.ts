/**
 * What every fixture and product looks like: which Kenney model, where its stock sits (measured
 * from Kenney's own shelves, see docs/STYLE_GUIDE.md), and the product meshes.
 */
import type { BufferGeometry } from 'three';
import type { FixtureType } from '@/sim/types';
import { productDef } from '@/sim/products';
import type { AssetLibrary } from './assets';
import { recolor, nearestStrip, stripCounts } from './recolor';
import { FITTING_MODEL } from './fittings';

export const FIXTURE_MODEL = {
  register: 'market/cash-register', shelf: 'market/shelf-boxes', fridge: 'market/freezer', freezer: 'market/freezers-standing', produce: 'market/display-bread',
  endcap: 'market/shelf-end', kiosk: 'market/bottle-return', rack: 'market/shelf-bags', sign: 'market/column', plant: 'furniture/potted-plant', bench: 'furniture/bench', basketStack: 'market/shopping-basket',
  ...FITTING_MODEL,
} as Record<FixtureType, string>;

/** Local z offset so models whose pivot sits on their front or back face are centred in the tile. */
export const MODEL_OFFSET: Partial<Record<FixtureType, number>> = { freezer: 0.25, endcap: 0.2 };

/** A box on a fixture, in fixture-local space (fixture faces +z), where one slot's stock stands. */
export interface SlotBox { x0: number; x1: number; z0: number; z1: number; y: number; h: number; /** stock faces −z (back of a double-sided shelf) */ back?: boolean }

const half = (y: number, h: number, back = false): SlotBox[] => [{ x0: -0.33, x1: 0.33, z0: back ? -0.24 : 0.02, z1: back ? -0.02 : 0.24, y, h, back }];

/**
 * Measured from the models' boards (model space, before MODEL_OFFSET): shelf-boxes has boards at
 * y 0.18 and 0.55 spanning x ±0.35, z ±0.25, stocked from both sides; shelf-bags' boards top out at
 * y 0.21 and 0.58; shelf-end's are only 0.2 deep (z −0.30..−0.10, its pivot on the front face);
 * display-bread's crate floor is at y 0.27 within x ±0.25, z ±0.20.
 */
export const SLOT_BOXES: Partial<Record<FixtureType, SlotBox[]>> = {
  shelf: [...half(0.18, 0.33), ...half(0.555, 0.3), ...half(0.18, 0.33, true), ...half(0.555, 0.3, true)],
  rack: [...half(0.21, 0.3), ...half(0.58, 0.25)],
  endcap: [{ x0: -0.33, x1: 0.33, z0: -0.29, z1: -0.11, y: 0.17, h: 0.33 }, { x0: -0.33, x1: 0.33, z0: -0.29, z1: -0.11, y: 0.55, h: 0.24 }],
  produce: [{ x0: -0.24, x1: -0.01, z0: -0.19, z1: 0.19, y: 0.27, h: 0.2 }, { x0: 0.01, x1: 0.24, z0: -0.19, z1: 0.19, y: 0.27, h: 0.2 }],
  // The chiller is Kenney's chest freezer with its painted lid removed; stock stands in the lit well.
  fridge: [
    { x0: -0.29, x1: -0.01, z0: 0.0, z1: 0.19, y: 0.13, h: 0.17 }, { x0: 0.01, x1: 0.29, z0: 0.0, z1: 0.19, y: 0.13, h: 0.17 },
    { x0: -0.29, x1: -0.01, z0: -0.19, z1: 0.0, y: 0.13, h: 0.17 }, { x0: 0.01, x1: 0.29, z0: -0.19, z1: 0.0, y: 0.13, h: 0.17 },
  ],
};

/** Food Kit models for products that have a natural match; everything else is a recoloured Mini Market product. */
const FOOD: Record<string, string> = {
  apples: 'apple', bananas: 'banana', oranges: 'orange', tomatoes: 'tomato', lettuce: 'cabbage', carrots: 'carrot', strawberries: 'strawberry',
  milk: 'carton', cheese: 'cheese-cut', eggs: 'egg', icecream: 'ice-cream-cup', chicken: 'turkey', beef: 'meat-ribs', sausages: 'sausage', bacon: 'bacon', fish: 'fish',
  bread: 'loaf', beans: 'can', soup: 'can-small', chocolate: 'chocolate', cookies: 'cookie', jam: 'honey', ketchup: 'bottle-ketchup', oil: 'bottle-oil',
  water: 'soda-bottle', cola: 'soda-can', juice: 'carton-small', wine: 'wine-red', rice: 'bag', flour: 'bag-flat', lemonade: 'soda', coffee: 'cup-coffee',
};
const MM_SHAPE: Record<string, string> = { box: 'product-box', carton: 'product-carton', bag: 'product-bag', bottle: 'product-bottle', bread: 'product-bread', can: 'product-carton', jar: 'product-bottle', jug: 'product-carton', tray: 'product-box', fruit: 'product-bag' };

export function productModelIds(): string[] {
  return [...new Set([...Object.values(FOOD).map((n) => `food/${n}`), ...Object.values(MM_SHAPE).map((n) => `market/${n}`)])];
}

/** Product geometry, recoloured to the product's colours when it is a generic Mini Market shape. */
export function productGeometry(assets: AssetLibrary, productId: string): BufferGeometry {
  const def = productDef(productId);
  const food = FOOD[productId];
  if (food && assets.has(`food/${food}`)) return assets.geometry(`food/${food}`);
  const base = assets.geometry(`market/${MM_SHAPE[def.shape] ?? 'product-box'}`);
  // The two most-used colour strips become the product's body and accent colours.
  const counts = [...stripCounts(base).entries()].filter(([k]) => !k.startsWith('3:4')).sort((a, b) => b[1] - a[1]);
  const main = counts[0]?.[0], second = counts[1]?.[0];
  const body = nearestStrip(def.color), accent = nearestStrip(def.accent);
  return recolor(base, (from) => {
    const k = `${from.row}:${from.strip}`;
    if (k === main) return body;
    if (k === second) return accent;
    return null;
  });
}

/**
 * Fixtures painted for a warm shop instead of Kenney's slate and lavender grey: honey-wood shelving,
 * a cream-painted counter with a wood top, white-enamel chillers with sky-blue trim, wooden produce
 * crates. Keys are colormap strips ("row:strip"): 3:1 slate, 3:2 dark slate, 3:3 lavender grey.
 */
export const FIXTURE_PAINT: Record<string, Record<string, string>> = {
  'market/shelf-boxes': { '3:3': '#D9A066', '3:1': '#B8824C' },
  'market/shelf-bags': { '3:3': '#D9A066', '3:1': '#B8824C' },
  'market/shelf-end': { '3:3': '#D9A066', '3:1': '#B8824C' },
  'market/cash-register': { '3:3': '#E9DCC4', '3:1': '#D9A066' },
  chiller: { '3:3': '#F7EFE2', '3:1': '#A9D8F5' },
  'market/freezers-standing': { '3:3': '#F7EFE2', '3:1': '#A9D8F5' },
  'market/display-bread': { '3:1': '#C8925A', '3:3': '#B8824C' },
  'market/bottle-return': { '3:3': '#E9DCC4', '3:1': '#B8824C' },
  'market/column': { '3:1': '#E9DCC4' },
};

/** The checker lino and the inside walls' bands (heights in tile units; the wall top is at 1). */
export const LINO = { a: '#FFF3DC', b: '#F3DEC0', joint: '#EBD2B0' };
export const WALL_BANDS = { skirting: [0, 0.07], lower: [0.07, 0.45], rail: [0.45, 0.5], upper: [0.5, 0.97] } as const;
export const SKIRTING = '#C48A52', RAIL = '#FFF3DC';

/** Wall recolour: Kenney's slate walls become white with the brand-green stripe, charcoal trim kept. */
export const WALL_COLOURS = (from: { row: number; strip: number }) => {
  if (from.row !== 3) return null;
  // The charcoal (wall tops, frames) a soft slate: from above the shop reads light and clean, not outlined in black.
  if (from.strip === 0) return { row: 3, strip: 1 };
  if (from.strip === 1 || from.strip === 3) return { row: 3, strip: 4 };
  if (from.strip === 2) return { row: 3, strip: 3 };
  return null;
};

/** Concrete: Kenney's white/lavender floor tile in two cool greys. */
export const CONCRETE = (from: { row: number; strip: number }) => {
  if (from.row !== 3) return null;
  if (from.strip === 4) return { row: 3, strip: 3 };
  if (from.strip === 3) return { row: 3, strip: 1 };
  return null;
};
