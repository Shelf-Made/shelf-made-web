import type { Texture } from 'three';

export interface PaletteData { cells: number; slot: number; cols: number; rows: number; colors: string[] }

/** Maps a hex colour to its atlas UV. Colours not in the baked palette fall back to the nearest one. */
export class PaletteMap {
  private readonly index = new Map<string, number>();
  constructor(readonly data: PaletteData) {
    data.colors.forEach((c, i) => this.index.set(c.toUpperCase(), i));
  }
  cell(hex: string): number {
    const key = hex.toUpperCase();
    const i = this.index.get(key);
    if (i !== undefined) return i;
    // Nearest colour by RGB distance.
    const [r, g, b] = rgb(key);
    let best = 0, bestD = Infinity;
    this.data.colors.forEach((c, idx) => {
      const [cr, cg, cb] = rgb(c);
      const d = (cr - r) ** 2 + (cg - g) ** 2 + (cb - b) ** 2;
      if (d < bestD) { bestD = d; best = idx; }
    });
    this.index.set(key, best);
    return best;
  }
  /** UV in glTF convention (v down from the top, matching the converted models), for the centre of a palette cell. */
  uv(hex: string): [number, number] {
    const i = this.cell(hex);
    const n = this.data.cells;
    const col = i % n, row = Math.floor(i / n);
    const u = (col + 0.5) / n, vDown = (row + 0.5) / n;
    const sc = this.data.slot % this.data.cols, sr = Math.floor(this.data.slot / this.data.cols);
    const au = (sc + u) / this.data.cols;
    const avDown = (sr + vDown) / this.data.rows;
    return [au, avDown];
  }
}

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

export function configureAtlas(tex: Texture): void {
  // Kenney colormaps are gradient strips: linear filtering, no mipmaps, so strips never bleed.
  tex.generateMipmaps = false;
  tex.minFilter = 1006; // LinearFilter
  tex.magFilter = 1006;
  tex.flipY = false;
  tex.colorSpace = 'srgb';
  tex.needsUpdate = true;
}
