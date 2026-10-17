/**
 * What every fixture and product looks like: which Kenney model, where its stock sits (measured
 * from Kenney's own shelves, see docs/STYLE_GUIDE.md), and the product meshes.
 */
import type { BufferGeometry } from 'three';
import type { FixtureType } from '@/sim/types';
import { productDef, PRODUCTS } from '@/sim/products';
import type { AssetLibrary } from './assets';
import { recolor, nearestStrip, stripCounts } from './recolor';
import { box, cylinder, sphere, merge } from './geometry';
import { FITTING_MODEL } from './fittings';

export const FIXTURE_MODEL = {
  register: 'market/cash-register', shelf: 'market/shelf-boxes', fridge: 'market/freezer', freezer: 'market/freezers-standing', produce: 'market/display-bread',
  endcap: 'market/shelf-end', kiosk: 'market/bottle-return', rack: 'market/shelf-bags', sign: 'market/column', plant: 'furniture/potted-plant', bench: 'furniture/bench', basketStack: 'market/shopping-basket',
  ...FITTING_MODEL,
} as Record<FixtureType, string>;


/** A box on a fixture, in fixture-local space (fixture faces +z), where one slot's stock stands. */
export interface SlotBox { x0: number; x1: number; z0: number; z1: number; y: number; h: number; /** stock faces −z (back of a double-sided shelf) */ back?: boolean }

const half = (y: number, h: number, back = false): SlotBox[] => [{ x0: -0.33, x1: 0.33, z0: back ? -0.24 : 0.02, z1: back ? -0.02 : 0.24, y, h, back }];

/**
 * Measured from the models' boards (model space, before the piece is set back on its tile): shelf-boxes has boards at
 * y 0.18 and 0.55 spanning x ±0.35, z ±0.25, stocked from both sides; shelf-bags' boards top out at
 * y 0.21 and 0.58; shelf-end's are only 0.2 deep (z −0.30..−0.10, its pivot on the front face);
 * display-bread's crate floor is at y 0.27 within x ±0.25, z ±0.20.
 */
export const SLOT_BOXES: Partial<Record<FixtureType, SlotBox[]>> = {
  shelf: [...half(0.18, 0.33), ...half(0.555, 0.3), ...half(0.18, 0.33, true), ...half(0.555, 0.3, true)],
  rack: [...half(0.21, 0.3), ...half(0.58, 0.25)],
  endcap: [{ x0: -0.33, x1: 0.33, z0: -0.29, z1: -0.11, y: 0.17, h: 0.33 }, { x0: -0.33, x1: 0.33, z0: -0.29, z1: -0.11, y: 0.55, h: 0.24 }],
  produce: [{ x0: -0.24, x1: -0.01, z0: -0.19, z1: 0.19, y: 0.27, h: 0.2 }, { x0: 0.01, x1: 0.24, z0: -0.19, z1: 0.19, y: 0.27, h: 0.2 }],
  // The displays made here (tile space: they are centred, their back at z −0.45).
  iceChest: [
    { x0: -0.38, x1: -0.01, z0: -0.15, z1: 0.1, y: 0.206, h: 0.16 }, { x0: 0.01, x1: 0.38, z0: -0.15, z1: 0.1, y: 0.206, h: 0.16 },
    { x0: -0.38, x1: -0.01, z0: -0.4, z1: -0.15, y: 0.206, h: 0.16 }, { x0: 0.01, x1: 0.38, z0: -0.4, z1: -0.15, y: 0.206, h: 0.16 },
  ],
  coolProduce: [-0.29, 0, 0.29].map((x) => ({ x0: x - 0.12, x1: x + 0.12, z0: -0.38, z1: 0.04, y: 0.36, h: 0.18 })),
  wallShelf: [{ x0: -0.34, x1: 0.34, z0: -0.42, z1: -0.24, y: 0.36, h: 0.2 }, { x0: -0.34, x1: 0.34, z0: -0.42, z1: -0.24, y: 0.63, h: 0.2 }],
  glassCase: [{ x0: -0.38, x1: -0.01, z0: -0.4, z1: 0.06, y: 0.3, h: 0.17 }, { x0: 0.01, x1: 0.38, z0: -0.4, z1: 0.06, y: 0.3, h: 0.17 }],
  displayTable: [-0.66, -0.22, 0.22, 0.66].map((x) => ({ x0: x - 0.2, x1: x + 0.2, z0: -0.3, z1: 0.3, y: 0.36, h: 0.24 })),
  bakeryCase: [-0.28, 0, 0.28].map((x) => ({ x0: x - 0.12, x1: x + 0.12, z0: -0.4, z1: 0.08, y: 0.33, h: 0.18 })),
  clothesRail: [{ x0: -0.4, x1: -0.01, z0: -0.38, z1: -0.02, y: 0.11, h: 0.16 }, { x0: 0.01, x1: 0.4, z0: -0.38, z1: -0.02, y: 0.11, h: 0.16 }],
  vending: [0.2, 0.38, 0.56, 0.74].map((y) => ({ x0: -0.3, x1: 0.18, z0: -0.38, z1: 0.04, y: y + 0.012, h: 0.15 })),
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
  return [...new Set([...Object.values(FOOD).map((n) => `food/${n}`), ...Object.values(MM_SHAPE).map((n) => `market/${n}`), ...PRODUCTS.flatMap((p) => (p.model && !p.model.startsWith('gen:') ? [p.model] : []))])];
}

/**
 * Goods made here in the toy style, for the departments the kits have nothing for: a teddy, a stack of
 * blocks, a ball, a folded T-shirt, a cap, sunglasses, headphones, a football, a rolled mat, a heart box,
 * an Easter egg, a candy bucket and a little Christmas tree. Product-sized (a few centimetres to a hand).
 */
function madeProduct(pal: AssetLibrary['palette'], id: string, c: string, a: string): BufferGeometry {
  switch (id) {
    case 'gen:teddy': return merge([sphere(pal, c, 0.05, 0, 0.05, 0, 10, 8), sphere(pal, c, 0.037, 0, 0.115, 0.004, 10, 8), sphere(pal, c, 0.014, -0.027, 0.148, 0, 6, 5), sphere(pal, c, 0.014, 0.027, 0.148, 0, 6, 5), sphere(pal, a, 0.016, 0, 0.108, 0.033, 6, 5), sphere(pal, c, 0.018, -0.05, 0.065, 0.01, 6, 5), sphere(pal, c, 0.018, 0.05, 0.065, 0.01, 6, 5), box(pal, '#222226', 0.008, 0.008, 0.004, -0.013, 0.125, 0.034), box(pal, '#222226', 0.008, 0.008, 0.004, 0.013, 0.125, 0.034)]);
    case 'gen:blocks': return merge([box(pal, c, 0.05, 0.05, 0.05, -0.028, 0, 0), box(pal, '#4F8FE0', 0.05, 0.05, 0.05, 0.028, 0, 0.004), box(pal, a, 0.05, 0.05, 0.05, 0, 0.05, 0.002), box(pal, '#3FA87A', 0.022, 0.012, 0.022, 0, 0.1, 0)]);
    case 'gen:ball': return sphere(pal, c, 0.04, 0, 0.04, 0, 12, 9);
    case 'gen:football': return merge([sphere(pal, c, 0.05, 0, 0.05, 0, 12, 9), box(pal, a, 0.022, 0.022, 0.006, 0, 0.05, 0.047), box(pal, a, 0.006, 0.022, 0.022, 0.047, 0.05, 0)]);
    case 'gen:shirt': return merge([box(pal, c, 0.11, 0.022, 0.09, 0, 0, 0), box(pal, a, 0.05, 0.004, 0.03, 0, 0.022, 0.01), box(pal, c, 0.11, 0.022, 0.09, 0, 0.024, 0.002)]);
    case 'gen:cap': return merge([cylinder(pal, c, 0.045, 0.04, 0, 0, 0, 12, 0.03), box(pal, c, 0.06, 0.006, 0.05, 0, 0, 0.055), box(pal, a, 0.012, 0.006, 0.012, 0, 0.04, 0)]);
    case 'gen:shades': return merge([box(pal, c, 0.042, 0.03, 0.008, -0.025, 0.02, 0), box(pal, c, 0.042, 0.03, 0.008, 0.025, 0.02, 0), box(pal, a, 0.1, 0.008, 0.006, 0, 0.045, 0), box(pal, '#FFFFFF', 0.06, 0.09, 0.004, 0, 0, -0.008)]);
    case 'gen:headphones': return merge([box(pal, c, 0.024, 0.045, 0.04, -0.045, 0, 0), box(pal, c, 0.024, 0.045, 0.04, 0.045, 0, 0), box(pal, c, 0.1, 0.012, 0.02, 0, 0.085, 0), box(pal, c, 0.012, 0.045, 0.02, -0.05, 0.045, 0), box(pal, c, 0.012, 0.045, 0.02, 0.05, 0.045, 0), box(pal, a, 0.026, 0.02, 0.042, -0.045, 0.012, 0), box(pal, a, 0.026, 0.02, 0.042, 0.045, 0.012, 0)]);
    case 'gen:mat': { const g = cylinder(pal, c, 0.03, 0.14, 0, 0, 0, 10); g.rotateZ(Math.PI / 2); g.translate(0.07, 0.03, 0); return merge([g, box(pal, a, 0.012, 0.062, 0.062, -0.03, 0, 0)]); }
    case 'gen:heart': return merge([box(pal, c, 0.07, 0.022, 0.06, 0, 0, 0), cylinder(pal, c, 0.024, 0.022, -0.02, 0, 0.022, 10), cylinder(pal, c, 0.024, 0.022, 0.02, 0, 0.022, 10), box(pal, a, 0.075, 0.006, 0.01, 0, 0.022, 0)]);
    case 'gen:easteregg': { const g = sphere(pal, c, 0.03, 0, 0, 0, 10, 8); g.scale(1, 1.3, 1); g.translate(0, 0.039, 0); return merge([g, box(pal, a, 0.062, 0.008, 0.062, 0, 0.034, 0)]); }
    case 'gen:bucket': return merge([cylinder(pal, c, 0.04, 0.055, 0, 0, 0, 12, 0.05), box(pal, '#222226', 0.012, 0.012, 0.004, -0.015, 0.03, 0.045), box(pal, '#222226', 0.012, 0.012, 0.004, 0.015, 0.03, 0.045), box(pal, '#222226', 0.03, 0.006, 0.004, 0, 0.015, 0.046), box(pal, '#38383D', 0.09, 0.006, 0.006, 0, 0.075, 0), sphere(pal, '#F27CC1', 0.012, -0.01, 0.06, 0), sphere(pal, '#FFC044', 0.012, 0.012, 0.062, 0.006)]);
    case 'gen:xmastree': return merge([cylinder(pal, '#8B5A3C', 0.012, 0.03, 0, 0, 0, 6), cylinder(pal, c, 0.06, 0.06, 0, 0.02, 0, 8, 0.03), cylinder(pal, c, 0.048, 0.05, 0, 0.06, 0, 8, 0.02), cylinder(pal, c, 0.034, 0.045, 0, 0.095, 0, 8, 0.004), box(pal, a, 0.016, 0.016, 0.016, 0, 0.14, 0), sphere(pal, '#E8573F', 0.008, 0.035, 0.05, 0.02), sphere(pal, '#4F8FE0', 0.008, -0.03, 0.085, 0.015)]);
    default: return box(pal, c, 0.08, 0.08, 0.06, 0, 0, 0);
  }
}

/** Product geometry, recoloured to the product's colours when it is a generic Mini Market shape. */
export function productGeometry(assets: AssetLibrary, productId: string): BufferGeometry {
  const def = productDef(productId);
  if (def.model?.startsWith('gen:')) return madeProduct(assets.palette, def.model, def.color, def.accent);
  if (def.model && assets.has(def.model)) return assets.geometry(def.model);
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
