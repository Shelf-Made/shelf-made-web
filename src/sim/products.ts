/** The product catalogue. Prices in dollars; cost is the base wholesale cost per unit. */
export type Category = 'produce' | 'dairy' | 'meat' | 'dry' | 'drinks' | 'household'
  /** More groceries: the bakery, the freezer, the pet aisle. */
  | 'bakery' | 'frozen' | 'pets'
  /** Departments beyond groceries (no weapons, no cars), and the holidays' goods. */
  | 'toys' | 'clothing' | 'electronics' | 'home' | 'books' | 'sports' | 'beauty' | 'seasonal';
export type Shape = 'box' | 'bottle' | 'can' | 'bag' | 'carton' | 'fruit' | 'bread' | 'tray' | 'jar' | 'jug';
/** The holidays the year comes round to (see holidayOn). */
export type Holiday = 'valentine' | 'easter' | 'halloween' | 'christmas';

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
  /**
   * Beyond the shop's first range: shoppers only want it once you sell it (so a shop that never stocks it plays as
   * before), and come with the money for it.
   */
  extra?: boolean;
  /** Sold only around its holiday (and wanted then). */
  season?: Holiday;
  /** Room it takes on the pallet, in units (bulky goods take more). */
  size?: number;
  /** The model it is drawn with, when not one of the shapes: a kit model ("furniture/radio") or one made here ("gen:teddy"). */
  model?: string;
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
  // ---- More groceries (extra: wanted once you sell them).
  { id: 'corn', name: 'Sweetcorn', category: 'produce', cost: 0.5, basePrice: 1.0, shape: 'fruit', color: '#FFD84A', accent: '#7CC26B', chilled: false, shelfLife: 5, demand: 0.7, extra: true, model: 'food/corn' },
  { id: 'onions', name: 'Onions', category: 'produce', cost: 0.4, basePrice: 0.9, shape: 'fruit', color: '#C99A62', accent: '#F3DEC0', chilled: false, shelfLife: 14, demand: 0.9, extra: true, model: 'food/onion' },
  { id: 'grapes', name: 'Grapes', category: 'produce', cost: 1.6, basePrice: 2.9, shape: 'fruit', color: '#7B3F9E', accent: '#7CC26B', chilled: false, shelfLife: 4, demand: 0.8, extra: true, model: 'food/grapes' },
  { id: 'watermelon', name: 'Watermelon', category: 'produce', cost: 2.2, basePrice: 4.5, shape: 'fruit', color: '#3D8C40', accent: '#E8573F', chilled: false, shelfLife: 7, demand: 0.5, extra: true, size: 3, model: 'food/watermelon' },
  { id: 'pears', name: 'Pears', category: 'produce', cost: 0.6, basePrice: 1.1, shape: 'fruit', color: '#B9C23A', accent: '#8B5A3C', chilled: false, shelfLife: 6, demand: 0.7, extra: true, model: 'food/pear' },
  { id: 'broccoli', name: 'Broccoli', category: 'produce', cost: 0.7, basePrice: 1.4, shape: 'fruit', color: '#3FA87A', accent: '#63A854', chilled: false, shelfLife: 4, demand: 0.6, extra: true, model: 'food/broccoli' },
  { id: 'mushrooms', name: 'Mushrooms', category: 'produce', cost: 0.9, basePrice: 1.8, shape: 'tray', color: '#E9DCC4', accent: '#8B5A3C', chilled: true, shelfLife: 4, demand: 0.6, extra: true, model: 'food/mushroom' },
  { id: 'ham', name: 'Ham', category: 'meat', cost: 3.0, basePrice: 5.2, shape: 'tray', color: '#F2A3A0', accent: '#FFFFFF', chilled: true, shelfLife: 6, demand: 0.7, extra: true, model: 'food/whole-ham' },
  { id: 'turkey', name: 'Turkey slices', category: 'meat', cost: 2.8, basePrice: 4.8, shape: 'tray', color: '#F5D8C0', accent: '#C99A62', chilled: true, shelfLife: 6, demand: 0.6, extra: true },
  { id: 'steak', name: 'Steak', category: 'meat', cost: 5.5, basePrice: 9.5, shape: 'tray', color: '#B8323A', accent: '#FFFFFF', chilled: true, shelfLife: 3, demand: 0.5, extra: true, model: 'food/meat-raw' },
  { id: 'peanutbutter', name: 'Peanut butter', category: 'dry', cost: 1.5, basePrice: 2.8, shape: 'jar', color: '#B8824C', accent: '#E8573F', chilled: false, shelfLife: 0, demand: 0.7, extra: true, brand: true, model: 'food/peanut-butter' },
  { id: 'honey', name: 'Honey', category: 'dry', cost: 2.0, basePrice: 3.6, shape: 'jar', color: '#F2B33D', accent: '#8B5A3C', chilled: false, shelfLife: 0, demand: 0.5, extra: true },
  { id: 'peaches', name: 'Tinned peaches', category: 'dry', cost: 0.7, basePrice: 1.4, shape: 'can', color: '#FF9F5A', accent: '#FFFFFF', chilled: false, shelfLife: 0, demand: 0.6, extra: true },
  { id: 'tuna', name: 'Tinned tuna', category: 'dry', cost: 0.9, basePrice: 1.7, shape: 'can', color: '#4F8FE0', accent: '#E9DCC4', chilled: false, shelfLife: 0, demand: 0.7, extra: true },
  { id: 'mustard', name: 'Mustard', category: 'dry', cost: 0.8, basePrice: 1.6, shape: 'bottle', color: '#F2C230', accent: '#E8573F', chilled: false, shelfLife: 0, demand: 0.4, extra: true, model: 'food/bottle-musterd' },
  { id: 'tissues', name: 'Tissues', category: 'household', cost: 0.9, basePrice: 1.8, shape: 'box', color: '#A9D8F5', accent: '#FFFFFF', chilled: false, shelfLife: 0, demand: 0.6, extra: true },
  { id: 'towels', name: 'Paper towels', category: 'household', cost: 1.6, basePrice: 2.9, shape: 'bag', color: '#FFFFFF', accent: '#3FA87A', chilled: false, shelfLife: 0, demand: 0.6, extra: true, size: 2 },
  { id: 'binbags', name: 'Bin bags', category: 'household', cost: 1.2, basePrice: 2.4, shape: 'box', color: '#38383D', accent: '#FFC044', chilled: false, shelfLife: 0, demand: 0.4, extra: true },
  // The bakery.
  { id: 'donuts', name: 'Donuts', category: 'bakery', cost: 0.5, basePrice: 1.2, shape: 'bread', color: '#F27CC1', accent: '#D9A066', chilled: false, shelfLife: 2, demand: 1.0, impulse: true, extra: true, model: 'food/donut' },
  { id: 'croissants', name: 'Croissants', category: 'bakery', cost: 0.6, basePrice: 1.4, shape: 'bread', color: '#E2A65A', accent: '#B8824C', chilled: false, shelfLife: 2, demand: 0.9, extra: true, model: 'food/croissant' },
  { id: 'muffins', name: 'Muffins', category: 'bakery', cost: 0.7, basePrice: 1.6, shape: 'bread', color: '#8B5A3C', accent: '#F3DEC0', chilled: false, shelfLife: 3, demand: 0.8, impulse: true, extra: true, model: 'food/muffin' },
  { id: 'applepie', name: 'Apple pie', category: 'bakery', cost: 2.4, basePrice: 4.8, shape: 'bread', color: '#D9A066', accent: '#B8824C', chilled: false, shelfLife: 3, demand: 0.5, extra: true, model: 'food/pie' },
  { id: 'baguette', name: 'Baguette', category: 'bakery', cost: 0.6, basePrice: 1.5, shape: 'bread', color: '#D9A066', accent: '#B8824C', chilled: false, shelfLife: 1, demand: 0.9, extra: true, model: 'food/loaf-baguette' },
  { id: 'cake', name: 'Birthday cake', category: 'bakery', cost: 5.0, basePrice: 9.5, shape: 'bread', color: '#FFF3DC', accent: '#F27CC1', chilled: true, shelfLife: 3, demand: 0.3, extra: true, model: 'food/cake' },
  // The freezer.
  { id: 'pizza', name: 'Frozen pizza', category: 'frozen', cost: 1.8, basePrice: 3.6, shape: 'box', color: '#E8573F', accent: '#FFC044', chilled: true, shelfLife: 60, demand: 1.0, extra: true, model: 'food/pizza-box' },
  { id: 'waffles', name: 'Frozen waffles', category: 'frozen', cost: 1.2, basePrice: 2.4, shape: 'box', color: '#F2B33D', accent: '#4F8FE0', chilled: true, shelfLife: 60, demand: 0.6, extra: true, model: 'food/waffle' },
  { id: 'peas', name: 'Frozen peas', category: 'frozen', cost: 0.8, basePrice: 1.6, shape: 'bag', color: '#7CC26B', accent: '#A9D8F5', chilled: true, shelfLife: 90, demand: 0.7, extra: true },
  { id: 'lollies', name: 'Ice lollies', category: 'frozen', cost: 0.9, basePrice: 2.0, shape: 'box', color: '#F27CC1', accent: '#A9D8F5', chilled: true, shelfLife: 90, demand: 0.6, impulse: true, extra: true },
  // The pet aisle.
  { id: 'dogfood', name: 'Dog food', category: 'pets', cost: 3.5, basePrice: 6.5, shape: 'bag', color: '#C8423A', accent: '#FFC044', chilled: false, shelfLife: 0, demand: 0.7, extra: true, size: 2 },
  { id: 'catfood', name: 'Cat food', category: 'pets', cost: 0.6, basePrice: 1.2, shape: 'can', color: '#9B6FE0', accent: '#FFFFFF', chilled: false, shelfLife: 0, demand: 0.8, extra: true },
  { id: 'treats', name: 'Pet treats', category: 'pets', cost: 1.1, basePrice: 2.3, shape: 'bag', color: '#4F8FE0', accent: '#FFC044', chilled: false, shelfLife: 0, demand: 0.5, impulse: true, extra: true },
  { id: 'litter', name: 'Cat litter', category: 'pets', cost: 2.4, basePrice: 4.5, shape: 'bag', color: '#E9DCC4', accent: '#3FA87A', chilled: false, shelfLife: 0, demand: 0.4, extra: true, size: 3 },
  // Toys.
  { id: 'teddy', name: 'Teddy bear', category: 'toys', cost: 4.0, basePrice: 8.5, shape: 'box', color: '#B8824C', accent: '#F3DEC0', chilled: false, shelfLife: 0, demand: 0.5, impulse: true, extra: true, size: 2, model: 'gen:teddy' },
  { id: 'blocks', name: 'Building blocks', category: 'toys', cost: 5.0, basePrice: 11, shape: 'box', color: '#E8573F', accent: '#FFC044', chilled: false, shelfLife: 0, demand: 0.4, extra: true, size: 2, model: 'gen:blocks' },
  { id: 'ball', name: 'Bouncy ball', category: 'toys', cost: 0.8, basePrice: 2.0, shape: 'box', color: '#4F8FE0', accent: '#FFC044', chilled: false, shelfLife: 0, demand: 0.6, impulse: true, extra: true, model: 'gen:ball' },
  { id: 'puzzle', name: 'Jigsaw puzzle', category: 'toys', cost: 3.5, basePrice: 7.5, shape: 'box', color: '#3FA87A', accent: '#FFFFFF', chilled: false, shelfLife: 0, demand: 0.3, extra: true },
  { id: 'cards', name: 'Playing cards', category: 'toys', cost: 0.9, basePrice: 2.2, shape: 'box', color: '#E8573F', accent: '#FFFFFF', chilled: false, shelfLife: 0, demand: 0.4, impulse: true, extra: true },
  // Clothing.
  { id: 'tshirt', name: 'T-shirt', category: 'clothing', cost: 4.0, basePrice: 9.0, shape: 'box', color: '#FFFFFF', accent: '#3FA87A', chilled: false, shelfLife: 0, demand: 0.5, extra: true, model: 'gen:shirt' },
  { id: 'cap', name: 'Baseball cap', category: 'clothing', cost: 3.0, basePrice: 7.0, shape: 'box', color: '#4F8FE0', accent: '#FFFFFF', chilled: false, shelfLife: 0, demand: 0.4, extra: true, model: 'gen:cap' },
  { id: 'socks', name: 'Socks', category: 'clothing', cost: 1.5, basePrice: 3.5, shape: 'bag', color: '#9B6FE0', accent: '#FFFFFF', chilled: false, shelfLife: 0, demand: 0.6, extra: true },
  { id: 'sunglasses', name: 'Sunglasses', category: 'clothing', cost: 3.0, basePrice: 8.0, shape: 'box', color: '#222226', accent: '#FFC044', chilled: false, shelfLife: 0, demand: 0.4, impulse: true, extra: true, model: 'gen:shades' },
  { id: 'scarf', name: 'Scarf', category: 'clothing', cost: 3.5, basePrice: 8.0, shape: 'bag', color: '#E8573F', accent: '#FFF3DC', chilled: false, shelfLife: 0, demand: 0.3, extra: true },
  // Electronics.
  { id: 'headphones', name: 'Headphones', category: 'electronics', cost: 9.0, basePrice: 19, shape: 'box', color: '#38383D', accent: '#E8573F', chilled: false, shelfLife: 0, demand: 0.4, extra: true, brand: true, model: 'gen:headphones' },
  { id: 'charger', name: 'Phone charger', category: 'electronics', cost: 3.5, basePrice: 8.5, shape: 'box', color: '#FFFFFF', accent: '#38383D', chilled: false, shelfLife: 0, demand: 0.6, extra: true },
  { id: 'radio', name: 'Radio', category: 'electronics', cost: 8.0, basePrice: 17, shape: 'box', color: '#C8423A', accent: '#38383D', chilled: false, shelfLife: 0, demand: 0.2, extra: true, size: 2, model: 'furniture/radio' },
  { id: 'bulbs', name: 'Light bulbs', category: 'electronics', cost: 1.2, basePrice: 2.8, shape: 'box', color: '#FFE89A', accent: '#38383D', chilled: false, shelfLife: 0, demand: 0.5, extra: true },
  { id: 'speakerbox', name: 'Bluetooth speaker', category: 'electronics', cost: 11, basePrice: 24, shape: 'box', color: '#3570BC', accent: '#38383D', chilled: false, shelfLife: 0, demand: 0.25, extra: true, size: 2, model: 'furniture/speaker-small' },
  // Home and garden.
  { id: 'mug', name: 'Mug', category: 'home', cost: 1.8, basePrice: 4.0, shape: 'box', color: '#FFFFFF', accent: '#E8573F', chilled: false, shelfLife: 0, demand: 0.4, extra: true, model: 'food/mug' },
  { id: 'houseplant', name: 'House plant', category: 'home', cost: 3.0, basePrice: 6.5, shape: 'box', color: '#3FA87A', accent: '#C8925A', chilled: false, shelfLife: 0, demand: 0.4, extra: true, size: 2, model: 'furniture/plant-small-2' },
  { id: 'seeds', name: 'Seed packets', category: 'home', cost: 0.6, basePrice: 1.5, shape: 'box', color: '#7CC26B', accent: '#FFC044', chilled: false, shelfLife: 0, demand: 0.4, extra: true },
  { id: 'flowerpot', name: 'Flower pot', category: 'home', cost: 1.5, basePrice: 3.5, shape: 'box', color: '#C8693A', accent: '#8B5A3C', chilled: false, shelfLife: 0, demand: 0.3, extra: true, size: 2, model: 'nature/pot-small' },
  // Books and paper.
  { id: 'novel', name: 'Paperback', category: 'books', cost: 3.0, basePrice: 7.0, shape: 'box', color: '#4F8FE0', accent: '#FFFFFF', chilled: false, shelfLife: 0, demand: 0.4, extra: true, model: 'furniture/books' },
  { id: 'notebook', name: 'Notebook', category: 'books', cost: 1.0, basePrice: 2.5, shape: 'box', color: '#FFC044', accent: '#38383D', chilled: false, shelfLife: 0, demand: 0.5, extra: true },
  { id: 'pens', name: 'Pens', category: 'books', cost: 0.8, basePrice: 2.0, shape: 'box', color: '#38383D', accent: '#4F8FE0', chilled: false, shelfLife: 0, demand: 0.5, impulse: true, extra: true },
  { id: 'cardgreet', name: 'Greeting card', category: 'books', cost: 0.8, basePrice: 2.5, shape: 'box', color: '#F27CC1', accent: '#FFFFFF', chilled: false, shelfLife: 0, demand: 0.4, extra: true },
  // Sport.
  { id: 'football', name: 'Football', category: 'sports', cost: 5.0, basePrice: 11, shape: 'box', color: '#FFFFFF', accent: '#38383D', chilled: false, shelfLife: 0, demand: 0.3, extra: true, size: 2, model: 'gen:football' },
  { id: 'bottle', name: 'Water bottle', category: 'sports', cost: 2.0, basePrice: 5.0, shape: 'bottle', color: '#3FA87A', accent: '#FFFFFF', chilled: false, shelfLife: 0, demand: 0.4, extra: true },
  { id: 'yogamat', name: 'Yoga mat', category: 'sports', cost: 5.0, basePrice: 12, shape: 'bag', color: '#9B6FE0', accent: '#F27CC1', chilled: false, shelfLife: 0, demand: 0.2, extra: true, size: 3, model: 'gen:mat' },
  // Beauty.
  { id: 'shampoo', name: 'Shampoo', category: 'beauty', cost: 1.6, basePrice: 3.4, shape: 'bottle', color: '#F27CC1', accent: '#FFFFFF', chilled: false, shelfLife: 0, demand: 0.7, extra: true, brand: true },
  { id: 'sunscreen', name: 'Sun cream', category: 'beauty', cost: 2.5, basePrice: 5.5, shape: 'bottle', color: '#FFC044', accent: '#4F8FE0', chilled: false, shelfLife: 0, demand: 0.4, extra: true },
  { id: 'lipbalm', name: 'Lip balm', category: 'beauty', cost: 0.8, basePrice: 2.2, shape: 'can', color: '#E8305A', accent: '#FFFFFF', chilled: false, shelfLife: 0, demand: 0.5, impulse: true, extra: true },
  { id: 'perfume', name: 'Perfume', category: 'beauty', cost: 9.0, basePrice: 22, shape: 'bottle', color: '#C9A6F5', accent: '#FFC044', chilled: false, shelfLife: 0, demand: 0.2, extra: true, brand: true },
  // The holidays: sold, and wanted, only around them.
  { id: 'chocheart', name: 'Heart chocolates', category: 'seasonal', cost: 2.5, basePrice: 6.0, shape: 'box', color: '#E8305A', accent: '#FFC044', chilled: false, shelfLife: 0, demand: 1.4, impulse: true, extra: true, season: 'valentine', model: 'gen:heart' },
  { id: 'roses', name: 'Roses', category: 'seasonal', cost: 3.0, basePrice: 7.5, shape: 'box', color: '#C8203A', accent: '#3FA87A', chilled: false, shelfLife: 3, demand: 1.0, extra: true, season: 'valentine', model: 'nature/flower-reda' },
  { id: 'eastereggs', name: 'Easter eggs', category: 'seasonal', cost: 1.5, basePrice: 3.8, shape: 'box', color: '#A9D8F5', accent: '#F27CC1', chilled: false, shelfLife: 0, demand: 1.5, impulse: true, extra: true, season: 'easter', model: 'gen:easteregg' },
  { id: 'hotcross', name: 'Hot cross buns', category: 'seasonal', cost: 0.8, basePrice: 2.0, shape: 'bread', color: '#C8925A', accent: '#FFF3DC', chilled: false, shelfLife: 2, demand: 1.1, extra: true, season: 'easter', model: 'food/bread' },
  { id: 'candybucket', name: 'Candy bucket', category: 'seasonal', cost: 2.0, basePrice: 5.0, shape: 'box', color: '#FF8C42', accent: '#38383D', chilled: false, shelfLife: 0, demand: 1.5, impulse: true, extra: true, season: 'halloween', model: 'gen:bucket' },
  { id: 'pumpkin', name: 'Pumpkin', category: 'seasonal', cost: 1.5, basePrice: 3.8, shape: 'fruit', color: '#FF8C42', accent: '#3FA87A', chilled: false, shelfLife: 8, demand: 1.1, extra: true, season: 'halloween', size: 3, model: 'food/pumpkin' },
  { id: 'xmastree', name: 'Christmas tree', category: 'seasonal', cost: 12, basePrice: 25, shape: 'box', color: '#2E7D4F', accent: '#FFC044', chilled: false, shelfLife: 0, demand: 0.7, extra: true, season: 'christmas', size: 5, model: 'gen:xmastree' },
  { id: 'crackers', name: 'Christmas crackers', category: 'seasonal', cost: 2.0, basePrice: 5.0, shape: 'box', color: '#C8203A', accent: '#FFC044', chilled: false, shelfLife: 0, demand: 1.2, impulse: true, extra: true, season: 'christmas' },
  { id: 'roastturkey', name: 'Roast turkey', category: 'seasonal', cost: 9.0, basePrice: 17, shape: 'tray', color: '#C99A62', accent: '#FFFFFF', chilled: true, shelfLife: 4, demand: 0.8, extra: true, season: 'christmas', size: 2, model: 'food/turkey' },
];

export const PRODUCT_BY_ID: ReadonlyMap<string, ProductDef> = new Map(PRODUCTS.map((p) => [p.id, p]));
/** The shop's first range (what a new shop knows, and what shortages strike). */
export const CORE_PRODUCTS: ProductDef[] = PRODUCTS.filter((p) => !p.extra);
export const CATEGORY_NAMES: Record<Category, string> = {
  produce: 'Produce', dairy: 'Dairy', meat: 'Meat & fish', dry: 'Dry goods', drinks: 'Drinks', household: 'Household',
  bakery: 'Bakery', frozen: 'Frozen', pets: 'Pets', toys: 'Toys', clothing: 'Clothing', electronics: 'Electronics', home: 'Home & garden',
  books: 'Books & cards', sports: 'Sport', beauty: 'Beauty', seasonal: 'Holidays',
};
/** The grocery aisles, and the departments beyond them (the Stock card's two rows). */
export const GROCERY_CATEGORIES: Category[] = ['produce', 'dairy', 'meat', 'dry', 'drinks', 'household', 'bakery', 'frozen', 'pets'];
export const DEPARTMENTS: Category[] = ['toys', 'clothing', 'electronics', 'home', 'books', 'sports', 'beauty', 'seasonal'];

/**
 * The holidays, round a four-week year: Valentine's, Easter, Halloween and Christmas, each five days long with
 * two quiet days between (the first from day 6, after the opening days). Their goods can be ordered from two days before.
 */
export const HOLIDAYS: { id: Holiday; name: string; start: number }[] = [
  { id: 'valentine', name: "Valentine's", start: 6 }, { id: 'easter', name: 'Easter', start: 13 }, { id: 'halloween', name: 'Halloween', start: 20 }, { id: 'christmas', name: 'Christmas', start: 27 },
];
export const HOLIDAY_DAYS = 5, YEAR_DAYS = 28;
/** The holiday on a day, if any (`lead`: counting that many days before it as its time too). Christmas runs on into the new year. */
export function holidayOn(day: number, lead = 0): Holiday | null {
  for (const h of HOLIDAYS) {
    const from = h.start - lead;
    if (day < from) continue;
    if ((day - from) % YEAR_DAYS < HOLIDAY_DAYS + lead) return h.id;
  }
  return null;
}
export function holidayName(id: Holiday): string { return HOLIDAYS.find((h) => h.id === id)!.name; }
/** Can it be ordered today (a holiday's goods only in its time, from two days before)? */
export function inSeason(p: ProductDef, day: number): boolean { return !p.season || holidayOn(day, 2) === p.season; }
/** Room a product takes on the pallet. */
export function sizeOf(productId: string): number { return PRODUCT_BY_ID.get(productId)?.size ?? 1; }

/** Products the starter shop opens with (must fit one shelf + one fridge). */
export const STARTER_SHELF: string[] = ['bread', 'pasta', 'beans', 'chips', 'cereal', 'water', 'cookies', 'soup'];
export const STARTER_FRIDGE: string[] = ['milk', 'cola', 'juice', 'cheese'];

export function productDef(id: string): ProductDef {
  const p = PRODUCT_BY_ID.get(id);
  if (!p) throw new Error(`unknown product ${id}`);
  return p;
}
