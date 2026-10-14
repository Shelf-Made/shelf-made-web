/**
 * Which Kenney models Shelf Made ships, and how each pack is rescaled so that
 * 1 world unit = 1 Mini Market floor tile. Measured in docs/STYLE_GUIDE.md.
 */
export interface PackSpec {
  /** Short id used in output paths and the atlas. */
  id: string;
  /** Zip file name inside third_party/kenney. */
  zip: string;
  /** Folder inside the zip holding the models we read. */
  modelDir: string;
  /** Uniform scale applied so the pack matches Mini Market's scale. */
  scale: number;
  /** Colormap inside the zip (undefined = flat material colours, baked into the palette slot). */
  colormap?: string;
  /** Models to extract: output name -> source file name (without .glb). */
  models: Record<string, string>;
  /** Re-centre each model on its bottom-centre (packs whose pivot is a corner). */
  recentre?: boolean;
  /** Human name for credits. */
  title: string;
  version: string;
}

export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 2;
export const ATLAS_SLOT = 512;

export const PACKS: PackSpec[] = [
  {
    id: 'market', title: 'Mini Market', version: '1.0', zip: 'kenney_mini-market.zip', modelDir: 'Models/GLB format', scale: 1,
    colormap: 'Models/GLB format/Textures/colormap.png',
    models: {
      'cash-register': 'cash-register', 'shelf-boxes': 'shelf-boxes', 'shelf-bags': 'shelf-bags', 'shelf-end': 'shelf-end',
      'freezer': 'freezer', 'freezers-standing': 'freezers-standing', 'display-fruit': 'display-fruit', 'display-bread': 'display-bread',
      'wall': 'wall', 'wall-door': 'wall-door-rotate', 'wall-window': 'wall-window', 'wall-corner': 'wall-corner', 'floor': 'floor',
      'character-employee': 'character-employee', 'shopping-basket': 'shopping-basket', 'shopping-cart': 'shopping-cart',
      'column': 'column', 'bottle-return': 'bottle-return', 'fence': 'fence', 'fence-door': 'fence-door-rotate',
    },
  },
  {
    id: 'people', title: 'Mini Characters', version: '1.0', zip: 'kenney_mini-characters.zip', modelDir: 'Models/GLB format', scale: 1,
    colormap: 'Models/GLB format/Textures/colormap.png',
    models: Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].flatMap((l) => [[`female-${l}`, `character-female-${l}`], [`male-${l}`, `character-male-${l}`]])),
  },
  {
    id: 'suburban', title: 'City Kit Suburban', version: '2.0', zip: 'kenney_city-kit-suburban_20.zip', modelDir: 'Models/GLB format', scale: 3,
    colormap: 'Models/GLB format/Textures/colormap.png',
    models: {
      ...Object.fromEntries('abcdefghijklmnopqrstu'.split('').map((l) => [`house-${l}`, `building-type-${l}`])),
      'tree-large': 'tree-large', 'tree-small': 'tree-small', 'fence': 'fence', 'fence-low': 'fence-low', 'fence-1x2': 'fence-1x2', 'fence-1x3': 'fence-1x3', 'fence-1x4': 'fence-1x4',
      'planter': 'planter', 'path-long': 'path-long', 'path-short': 'path-short', 'driveway-long': 'driveway-long', 'driveway-short': 'driveway-short',
    },
  },
  {
    id: 'commercial', title: 'City Kit Commercial', version: '2.1', zip: 'kenney_city-kit-commercial_2.1.zip', modelDir: 'Models/GLB format', scale: 3,
    colormap: 'Models/GLB format/Textures/colormap.png',
    models: {
      ...Object.fromEntries('abcdefghijklmn'.split('').map((l) => [`shop-${l}`, `building-${l}`])),
      'awning': 'detail-awning', 'awning-wide': 'detail-awning-wide', 'overhang': 'detail-overhang', 'overhang-wide': 'detail-overhang-wide',
      'parasol-a': 'detail-parasol-a', 'parasol-b': 'detail-parasol-b',
      ...Object.fromEntries('abcdefgh'.split('').map((l) => [`far-${l}`, `low-detail-building-${l}`])),
    },
  },
  {
    id: 'roads', title: 'City Kit Roads', version: '2.2', zip: 'kenney_city-kit-roads.zip', modelDir: 'Models/GLB format', scale: 2,
    colormap: 'Models/GLB format/Textures/colormap.png',
    models: {
      'road-straight': 'road-straight', 'road-straight-half': 'road-straight-half', 'road-crossroad': 'road-crossroad', 'road-intersection': 'road-intersection', 'road-bend': 'road-bend', 'road-curve': 'road-curve',
      'road-driveway-single': 'road-driveway-single', 'road-driveway-double': 'road-driveway-double', 'road-side': 'road-side', 'road-end': 'road-end', 'road-end-round': 'road-end-round',
      'road-crossing': 'road-crossing', 'road-square': 'road-square', 'tile-low': 'tile-low',
      'lamp': 'light-curved', 'lamp-double': 'light-curved-double', 'lamp-square': 'light-square', 'sign-street': 'road-sign-street', 'sign-stop': 'road-sign-stop', 'sign-empty': 'road-sign-empty',
      'traffic-light': 'traffic-light', 'dumpster': 'dumpster', 'cone': 'construction-cone', 'barrier': 'construction-barrier',
      'electricity-pole': 'electricity-pole', 'sign-highway': 'sign-highway',
    },
  },
  {
    id: 'cars', title: 'Car Kit', version: '3.1', zip: 'kenney_car-kit.zip', modelDir: 'Models/GLB format', scale: 0.55,
    colormap: 'Models/GLB format/Textures/colormap.png',
    models: {
      'sedan': 'sedan', 'sedan-sports': 'sedan-sports', 'hatchback': 'hatchback-sports', 'suv': 'suv', 'suv-luxury': 'suv-luxury', 'van': 'van',
      'delivery': 'delivery', 'delivery-flat': 'delivery-flat', 'truck': 'truck', 'truck-flat': 'truck-flat', 'taxi': 'taxi', 'garbage-truck': 'garbage-truck',
    },
  },
  {
    id: 'food', title: 'Food Kit', version: '2.0', zip: 'kenney_food-kit.zip', modelDir: 'Models/GLB format', scale: 0.5,
    colormap: 'Models/GLB format/Textures/colormap.png',
    models: Object.fromEntries([
      'apple', 'banana', 'orange', 'pear', 'lemon', 'watermelon', 'pumpkin', 'carrot', 'broccoli', 'cabbage', 'tomato', 'avocado', 'pineapple', 'strawberry', 'grapes', 'corn', 'onion', 'paprika', 'eggplant', 'mushroom', 'leek', 'cauliflower', 'coconut', 'cherries',
      'soda-can', 'soda-bottle', 'carton', 'carton-small', 'can', 'can-small', 'bottle-ketchup', 'bottle-oil', 'bottle-musterd', 'bag', 'bag-flat', 'bread', 'loaf', 'loaf-baguette', 'loaf-round', 'cheese', 'egg', 'pizza-box', 'chocolate', 'candy-bar', 'cookie', 'honey', 'peanut-butter', 'cupcake', 'donut', 'croissant', 'muffin', 'fish', 'meat-raw', 'bacon', 'whole-ham', 'sausage', 'meat-sausage', 'cake', 'pie', 'waffle', 'wine-red', 'wine-white', 'cup-coffee', 'mug', 'barrel', 'bowl-cereal', 'styrofoam',
    ].map((n) => [n, n])),
  },
  {
    id: 'nature', title: 'Nature Kit', version: '2.1', zip: 'kenney_nature-kit.zip', modelDir: 'Models/GLTF format', scale: 1.4, recentre: true,
    models: Object.fromEntries([
      'tree_default', 'tree_oak', 'tree_detailed', 'tree_fat', 'tree_small', 'tree_tall', 'tree_simple', 'tree_thin', 'tree_blocks', 'tree_cone', 'tree_pineRoundA', 'tree_pineRoundB', 'tree_plateau',
      'tree_default_fall', 'tree_oak_fall', 'tree_small_fall',
      'plant_bush', 'plant_bushSmall', 'plant_bushLarge', 'plant_bushDetailed', 'flower_redA', 'flower_yellowA', 'flower_purpleA', 'flower_redB', 'flower_yellowB', 'grass', 'grass_large', 'grass_leafs',
      'rock_smallA', 'rock_smallB', 'rock_largeA', 'stone_smallA', 'fence_simple', 'fence_planks', 'fence_gate', 'log', 'stump_round', 'pot_small', 'pot_large', 'sign', 'bed', 'crop_pumpkin', 'crop_carrot',
    ].map((n) => [n.replace(/_/g, '-').toLowerCase(), n])),
  },
  {
    id: 'furniture', title: 'Furniture Kit', version: '2.0', zip: 'kenney_furniture-kit.zip', modelDir: 'Models/GLTF format', scale: 0.8, recentre: true,
    models: Object.fromEntries([
      'cardboardBoxClosed', 'cardboardBoxOpen', 'trashcan', 'bench', 'benchCushion', 'pottedPlant', 'plantSmall1', 'plantSmall2', 'plantSmall3', 'rugDoormat', 'rugRectangle',
      'computerScreen', 'computerKeyboard', 'lampWall', 'lampSquareCeiling', 'desk', 'chairDesk', 'stoolBar', 'speaker', 'speakerSmall', 'books', 'radio', 'coatRackStanding', 'kitchenFridge', 'kitchenFridgeLarge', 'washer', 'tableCoffee', 'chair', 'sideTable', 'bookcaseOpen', 'cabinetTelevision', 'televisionModern', 'ceilingFan', 'paneling', 'floorFull',
    ].map((n) => [n.replace(/([A-Z0-9])/g, '-$1').toLowerCase(), n])),
  },
];

/** Atlas slot index for each pack id (packs without a colormap share the palette slot). */
export const ATLAS_SLOTS: Record<string, number> = { market: 0, people: 0, suburban: 1, commercial: 2, roads: 3, cars: 4, food: 5, palette: 6 };

export const PALETTE_SLOT = 6;
/** Flat-colour palette cells: 16 x 16 cells of 32 px in the palette slot. */
export const PALETTE_CELLS = 16;
