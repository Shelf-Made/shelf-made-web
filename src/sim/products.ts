/** The product catalogue. Prices in dollars; cost is the base wholesale cost per unit. */
export type Category = 'produce' | 'dairy' | 'meat' | 'dry' | 'drinks' | 'household';
export type Shape = 'box' | 'bottle' | 'can' | 'bag' | 'carton' | 'fruit' | 'bread' | 'tray' | 'jar' | 'jug';

export interface ProductDef {
  id: string;
  name: string;
  category: Category;
  /** Wholesale cost per unit at the base supplier. */
  cost: number;
  /** Town-average retail price; the player's price starts here. */
  basePrice: number;
  shape: Shape;
  /** Body colour and accent band (hex), used by the renderer. */
  color: string;
  accent: string;
  chilled: boolean;
  /** Days until it spoils on the shelf (0 = never). */
  shelfLife: number;
  /** How popular it is: relative weight on shopping lists. */
  demand: number;
  /** Impulse buyers grab these from end caps and checkout racks. */
  impulse?: boolean;
  /** Brand loyalists come for these specifically. */
  brand?: boolean;
}

export const PRODUCTS: ProductDef[] = [
  // produce
  { id: 'apples', name: 'Apples', category: 'produce', cost: 0.55, basePrice: 1.0, shape: 'fruit', color: '#E8573F', accent: '#7CC26B', chilled: false, shelfLife: 5, demand: 1.4 },
  { id: 'bananas', name: 'Bananas', category: 'produce', cost: 0.4, basePrice: 0.8, shape: 'fruit', color: '#FFC044', accent: '#A87B45', chilled: false, shelfLife: 4, demand: 1.5 },
  { id: 'oranges', name: 'Oranges', category: 'produce', cost: 0.6, basePrice: 1.1, shape: 'fruit', color: '#FF8C42', accent: '#7CC26B', chilled: false, shelfLife: 6, demand: 1.0 },
  { id: 'tomatoes', name: 'Tomatoes', category: 'produce', cost: 0.7, basePrice: 1.3, shape: 'fruit', color: '#E03E2F', accent: '#63A854', chilled: false, shelfLife: 4, demand: 1.0 },
  { id: 'lettuce', name: 'Lettuce', category: 'produce', cost: 0.8, basePrice: 1.5, shape: 'fruit', color: '#8FD36E', accent: '#63A854', chilled: false, shelfLife: 3, demand: 0.8 },
  { id: 'potatoes', name: 'Potatoes', category: 'produce', cost: 1.2, basePrice: 2.2, shape: 'bag', color: '#C99A62', accent: '#8B5A3C', chilled: false, shelfLife: 12, demand: 1.1 },
  { id: 'carrots', name: 'Carrots', category: 'produce', cost: 0.6, basePrice: 1.2, shape: 'bag', color: '#FF8C42', accent: '#7CC26B', chilled: false, shelfLife: 8, demand: 0.9 },
  { id: 'strawberries', name: 'Strawberries', category: 'produce', cost: 1.8, basePrice: 3.2, shape: 'tray', color: '#E8305A', accent: '#7CC26B', chilled: true, shelfLife: 2, demand: 0.7, impulse: true },
  // dairy
  { id: 'milk', name: 'Milk', category: 'dairy', cost: 1.1, basePrice: 1.9, shape: 'jug', color: '#FFFFFF', accent: '#4F8FE0', chilled: true, shelfLife: 6, demand: 2.0 },
  { id: 'cheese', name: 'Cheese', category: 'dairy', cost: 2.2, basePrice: 3.8, shape: 'box', color: '#FFD36A', accent: '#E8573F', chilled: true, shelfLife: 14, demand: 1.0 },
  { id: 'yogurt', name: 'Yogurt', category: 'dairy', cost: 0.7, basePrice: 1.3, shape: 'can', color: '#F27CC1', accent: '#FFFFFF', chilled: true, shelfLife: 10, demand: 1.1 },
  { id: 'butter', name: 'Butter', category: 'dairy', cost: 1.6, basePrice: 2.8, shape: 'box', color: '#FFE89A', accent: '#D9A066', chilled: true, shelfLife: 20, demand: 0.9 },
  { id: 'eggs', name: 'Eggs', category: 'dairy', cost: 1.8, basePrice: 3.0, shape: 'tray', color: '#D9C7A8', accent: '#FFFFFF', chilled: true, shelfLife: 14, demand: 1.5 },
  { id: 'icecream', name: 'Ice cream', category: 'dairy', cost: 2.4, basePrice: 4.5, shape: 'can', color: '#A9D8F5', accent: '#F27CC1', chilled: true, shelfLife: 30, demand: 0.7, impulse: true, brand: true },
  // meat
  { id: 'chicken', name: 'Chicken', category: 'meat', cost: 3.2, basePrice: 5.5, shape: 'tray', color: '#F5D8C0', accent: '#FFFFFF', chilled: true, shelfLife: 3, demand: 1.1 },
  { id: 'beef', name: 'Beef', category: 'meat', cost: 4.5, basePrice: 7.5, shape: 'tray', color: '#C8423A', accent: '#FFFFFF', chilled: true, shelfLife: 3, demand: 0.9 },
  { id: 'sausages', name: 'Sausages', category: 'meat', cost: 2.0, basePrice: 3.6, shape: 'tray', color: '#D98B6B', accent: '#FFFFFF', chilled: true, shelfLife: 5, demand: 0.9 },
  { id: 'bacon', name: 'Bacon', category: 'meat', cost: 2.6, basePrice: 4.4, shape: 'tray', color: '#E57A6A', accent: '#FFF3DC', chilled: true, shelfLife: 7, demand: 0.9 },
  { id: 'fish', name: 'Fish', category: 'meat', cost: 3.8, basePrice: 6.5, shape: 'tray', color: '#9AC6E8', accent: '#FFFFFF', chilled: true, shelfLife: 2, demand: 0.6 },
  // dry goods
  { id: 'bread', name: 'Bread', category: 'dry', cost: 0.9, basePrice: 1.8, shape: 'bread', color: '#D9A066', accent: '#B8824C', chilled: false, shelfLife: 2, demand: 2.0 },
  { id: 'rice', name: 'Rice', category: 'dry', cost: 1.3, basePrice: 2.4, shape: 'bag', color: '#FFFFFF', accent: '#E8573F', chilled: false, shelfLife: 0, demand: 1.0 },
  { id: 'pasta', name: 'Pasta', category: 'dry', cost: 0.8, basePrice: 1.5, shape: 'box', color: '#4F8FE0', accent: '#FFC044', chilled: false, shelfLife: 0, demand: 1.2 },
  { id: 'cereal', name: 'Cereal', category: 'dry', cost: 1.9, basePrice: 3.4, shape: 'box', color: '#FFC044', accent: '#E8573F', chilled: false, shelfLife: 0, demand: 1.2, brand: true },
  { id: 'flour', name: 'Flour', category: 'dry', cost: 0.9, basePrice: 1.6, shape: 'bag', color: '#FFF3DC', accent: '#4F8FE0', chilled: false, shelfLife: 0, demand: 0.6 },
  { id: 'sugar', name: 'Sugar', category: 'dry', cost: 0.9, basePrice: 1.7, shape: 'bag', color: '#FFFFFF', accent: '#F27CC1', chilled: false, shelfLife: 0, demand: 0.6 },
  { id: 'coffee', name: 'Coffee', category: 'dry', cost: 3.5, basePrice: 6.0, shape: 'jar', color: '#8B5A3C', accent: '#FFC044', chilled: false, shelfLife: 0, demand: 1.0, brand: true },
  { id: 'tea', name: 'Tea', category: 'dry', cost: 1.6, basePrice: 2.9, shape: 'box', color: '#3FA87A', accent: '#FFF3DC', chilled: false, shelfLife: 0, demand: 0.7 },
  { id: 'beans', name: 'Baked beans', category: 'dry', cost: 0.5, basePrice: 1.0, shape: 'can', color: '#4F8FE0', accent: '#FFFFFF', chilled: false, shelfLife: 0, demand: 1.0 },
  { id: 'soup', name: 'Soup', category: 'dry', cost: 0.8, basePrice: 1.5, shape: 'can', color: '#E8573F', accent: '#FFFFFF', chilled: false, shelfLife: 0, demand: 0.9 },
  { id: 'chips', name: 'Chips', category: 'dry', cost: 0.9, basePrice: 1.9, shape: 'bag', color: '#FFC044', accent: '#E8573F', chilled: false, shelfLife: 0, demand: 1.3, impulse: true },
  { id: 'chocolate', name: 'Chocolate', category: 'dry', cost: 0.8, basePrice: 1.6, shape: 'box', color: '#5A3A28', accent: '#FFC044', chilled: false, shelfLife: 0, demand: 1.2, impulse: true, brand: true },
  { id: 'cookies', name: 'Cookies', category: 'dry', cost: 1.1, basePrice: 2.2, shape: 'box', color: '#F27CC1', accent: '#FFFFFF', chilled: false, shelfLife: 0, demand: 0.9, impulse: true },
  { id: 'jam', name: 'Jam', category: 'dry', cost: 1.4, basePrice: 2.6, shape: 'jar', color: '#B5235A', accent: '#FFFFFF', chilled: false, shelfLife: 0, demand: 0.5 },
  { id: 'ketchup', name: 'Ketchup', category: 'dry', cost: 1.0, basePrice: 1.9, shape: 'bottle', color: '#E03E2F', accent: '#FFFFFF', chilled: false, shelfLife: 0, demand: 0.7 },
  { id: 'oil', name: 'Olive oil', category: 'dry', cost: 2.8, basePrice: 5.0, shape: 'bottle', color: '#B9C23A', accent: '#3FA87A', chilled: false, shelfLife: 0, demand: 0.5 },
  // drinks
  { id: 'water', name: 'Water', category: 'drinks', cost: 0.3, basePrice: 0.7, shape: 'bottle', color: '#A9D8F5', accent: '#4F8FE0', chilled: false, shelfLife: 0, demand: 1.6 },
  { id: 'cola', name: 'Cola', category: 'drinks', cost: 0.6, basePrice: 1.3, shape: 'can', color: '#E03E2F', accent: '#FFFFFF', chilled: true, shelfLife: 0, demand: 1.4, impulse: true, brand: true },
  { id: 'juice', name: 'Orange juice', category: 'drinks', cost: 1.3, basePrice: 2.4, shape: 'carton', color: '#FF8C42', accent: '#FFFFFF', chilled: true, shelfLife: 8, demand: 1.1 },
  { id: 'lemonade', name: 'Lemonade', category: 'drinks', cost: 0.7, basePrice: 1.4, shape: 'bottle', color: '#FFE89A', accent: '#7CC26B', chilled: true, shelfLife: 0, demand: 0.8, impulse: true },
  { id: 'beer', name: 'Beer', category: 'drinks', cost: 1.2, basePrice: 2.3, shape: 'bottle', color: '#D9A066', accent: '#38383D', chilled: true, shelfLife: 0, demand: 0.9, brand: true },
  { id: 'wine', name: 'Wine', category: 'drinks', cost: 4.0, basePrice: 7.5, shape: 'bottle', color: '#5A1E3C', accent: '#FFC044', chilled: false, shelfLife: 0, demand: 0.5, brand: true },
  { id: 'energy', name: 'Energy drink', category: 'drinks', cost: 1.0, basePrice: 2.2, shape: 'can', color: '#38383D', accent: '#8FD36E', chilled: true, shelfLife: 0, demand: 0.7, impulse: true },
  // household
  { id: 'soap', name: 'Soap', category: 'household', cost: 0.9, basePrice: 1.8, shape: 'box', color: '#A9D8F5', accent: '#FFFFFF', chilled: false, shelfLife: 0, demand: 0.6 },
  { id: 'detergent', name: 'Detergent', category: 'household', cost: 3.0, basePrice: 5.2, shape: 'jug', color: '#4F8FE0', accent: '#FFC044', chilled: false, shelfLife: 0, demand: 0.6 },
  { id: 'paper', name: 'Toilet paper', category: 'household', cost: 2.2, basePrice: 3.9, shape: 'bag', color: '#FFFFFF', accent: '#9B6FE0', chilled: false, shelfLife: 0, demand: 1.0 },
  { id: 'toothpaste', name: 'Toothpaste', category: 'household', cost: 1.1, basePrice: 2.1, shape: 'box', color: '#FFFFFF', accent: '#3FA87A', chilled: false, shelfLife: 0, demand: 0.6 },
  { id: 'batteries', name: 'Batteries', category: 'household', cost: 2.0, basePrice: 3.8, shape: 'box', color: '#38383D', accent: '#FFC044', chilled: false, shelfLife: 0, demand: 0.4, impulse: true },
  { id: 'candles', name: 'Candles', category: 'household', cost: 1.5, basePrice: 2.9, shape: 'box', color: '#FFF3DC', accent: '#F27CC1', chilled: false, shelfLife: 0, demand: 0.3 },
];

export const PRODUCT_BY_ID: ReadonlyMap<string, ProductDef> = new Map(PRODUCTS.map((p) => [p.id, p]));
export const CATEGORY_NAMES: Record<Category, string> = { produce: 'Produce', dairy: 'Dairy', meat: 'Meat & fish', dry: 'Dry goods', drinks: 'Drinks', household: 'Household' };

/** Products the starter shop opens with (must fit one shelf + one fridge). */
export const STARTER_SHELF: string[] = ['bread', 'pasta', 'beans', 'chips', 'cereal', 'water', 'cookies', 'soup'];
export const STARTER_FRIDGE: string[] = ['milk', 'cola', 'juice', 'cheese'];

export function productDef(id: string): ProductDef {
  const p = PRODUCT_BY_ID.get(id);
  if (!p) throw new Error(`unknown product ${id}`);
  return p;
}
