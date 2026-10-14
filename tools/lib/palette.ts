/**
 * Flat-colour palette baked into one atlas slot. Brand colours come first at fixed
 * cells so generated models and the runtime can rely on them; pack material colours
 * are appended during conversion.
 */
import { ATLAS_COLS, ATLAS_ROWS, PALETTE_CELLS, PALETTE_SLOT } from './manifest';

export const BRAND = {
  white: '#FFFFFF',
  green: '#3FA87A',
  greenDark: '#2E8560',
  honey: '#D9A066',
  honeyDark: '#B8824C',
  yellow: '#FFC044',
  slate: '#38383D',
  slateLight: '#5A5A62',
  cream: '#FFF3DC',
  tile: '#B9BCC4',
  tileDark: '#9A9DA6',
  red: '#E8573F',
  blue: '#4F8FE0',
  skyBlue: '#A9D8F5',
  asphalt: '#5B5E68',
  asphaltLight: '#6E717C',
  linePaint: '#F2F2F2',
  grass: '#7CC26B',
  grassDark: '#63A854',
  dirt: '#B58A5C',
  cardboard: '#C99A62',
  cardboardDark: '#A87B45',
  glassBlue: '#CFE9F7',
  screen: '#9BE3FF',
  orange: '#FF8C42',
  purple: '#9B6FE0',
  pink: '#F27CC1',
  brown: '#8B5A3C',
  black: '#222226',
  fridgeGlow: '#D6F5FF',
} as const;

export type BrandColor = keyof typeof BRAND;

export class Palette {
  readonly colors: string[] = [];
  private readonly index = new Map<string, number>();
  constructor() {
    for (const hex of Object.values(BRAND)) this.cell(hex);
  }
  /** Cell index for a colour, adding it if new. */
  cell(hex: string): number {
    const key = hex.toUpperCase();
    let i = this.index.get(key);
    if (i === undefined) {
      if (this.colors.length >= PALETTE_CELLS * PALETTE_CELLS) throw new Error('palette full');
      i = this.colors.length;
      this.colors.push(key);
      this.index.set(key, i);
    }
    return i;
  }
  /** Atlas UV (glTF convention, v down) of a cell centre. */
  static uv(cell: number): [number, number] {
    const col = cell % PALETTE_CELLS;
    const row = Math.floor(cell / PALETTE_CELLS);
    const u = (col + 0.5) / PALETTE_CELLS;
    const v = (row + 0.5) / PALETTE_CELLS;
    const slotCol = PALETTE_SLOT % ATLAS_COLS;
    const slotRow = Math.floor(PALETTE_SLOT / ATLAS_COLS);
    return [(slotCol + u) / ATLAS_COLS, (slotRow + v) / ATLAS_ROWS];
  }
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/** sRGB-encode a linear channel value (glTF base colours are linear). */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
