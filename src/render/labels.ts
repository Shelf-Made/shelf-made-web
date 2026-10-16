/**
 * Words drawn on a canvas for the shop's signs: an aisle sign's own text, the slogan under the pylon, and the
 * LED board's running line. (Canvas text takes any letter the player types; the extruded letters only the
 * font's.) Each texture is cached by what is on it.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

const FONT = 'Fredoka, "Trebuchet MS", system-ui, sans-serif';
const cache = new Map<string, CanvasTexture>();

/** The words centred on a canvas (shrunk until they fit), in `fg` over `bg` (transparent when null). */
export function wordsTexture(text: string, w: number, h: number, fg: string, bg: string | null): CanvasTexture | null {
  const key = `w|${text}|${w}|${h}|${fg}|${bg}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!g) return null;
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  let size = Math.floor(h * 0.66);
  const font = () => { g.font = `600 ${size}px ${FONT}`; };
  font();
  while (g.measureText(text).width > w * 0.9 && size > 8) { size -= 2; font(); }
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + size * 0.05);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace; t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

/**
 * The LED board's running line: amber dots on black, the words spaced round the canvas so it wraps without a
 * seam (scroll it by moving the texture's offset). Shows half the canvas at a time.
 */
export function tickerTexture(text: string): CanvasTexture | null {
  const key = `t|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const w = 1024, h = 64;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#0B0B10'; g.fillRect(0, 0, w, h);
  let size = 44;
  g.font = `700 ${size}px ${FONT}`;
  while (g.measureText(text).width > w * 0.46 && size > 14) { size -= 2; g.font = `700 ${size}px ${FONT}`; }
  g.fillStyle = '#FFB648'; g.textAlign = 'center'; g.textBaseline = 'middle';
  // Twice round the canvas, so half of it (what the board shows) always has the words on it.
  g.fillText(text, w * 0.25, h / 2 + 2); g.fillText(text, w * 0.75, h / 2 + 2);
  // The dot grid: dark lines between the LEDs.
  g.fillStyle = 'rgba(11,11,16,0.55)';
  for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace; t.wrapS = RepeatWrapping; t.repeat.set(0.5, 1); t.anisotropy = 4;
  cache.set(key, t);
  return t;
}
