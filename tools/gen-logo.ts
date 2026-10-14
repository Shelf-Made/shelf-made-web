/**
 * The Shelf Made logo: a little shop front. Striped awning, the name on the fascia over the shelf
 * bracket, a window with a stocked shelf, a green door with an OPEN sign. Brand colours, chunky
 * slate outlines, transparent background. A simplified version is drawn for icon sizes.
 *   npm run gen:logo   writes public/brand/logo.svg, logo-small.svg and PNGs (512, 192, 180, 64, 32)
 */
import opentype from 'opentype.js';
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const OUT = join(ROOT, 'public', 'brand');
const buf = readFileSync(join(ROOT, 'third_party', 'fredoka', 'Fredoka-Bold.ttf'));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const C = { green: '#3FA87A', greenDark: '#2E8560', white: '#FFFFFF', cream: '#FFF3DC', slate: '#38383D', slate2: '#4A4A52', yellow: '#FFC044', yellowDark: '#D9A033', red: '#E8573F', blue: '#4F8FE0', honey: '#D9A066', glass: '#CFE9F7', glassDeep: '#A9D8F5', orange: '#FF8C42' };

/** Text as outlines (no font needed wherever the SVG goes), centred on x with its baseline at y. */
function text(str: string, x: number, y: number, size: number, fill: string, spacing = 0): string {
  const glyphs = font.stringToGlyphs(str);
  const scale = size / font.unitsPerEm;
  const width = glyphs.reduce((a, g) => a + (g.advanceWidth ?? 0) * scale + spacing, -spacing);
  let cx = x - width / 2;
  let d = '';
  for (const g of glyphs) { d += g.getPath(cx, y, size).toPathData(2); cx += (g.advanceWidth ?? 0) * scale + spacing; }
  return `<path d="${d}" fill="${fill}"/>`;
}

const rect = (x: number, y: number, w: number, h: number, fill: string, rx = 0, stroke?: string, sw = 0) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"` : ''}/>`;

function awningOutline(x0: number, x1: number, top: number, drop: number, n: number, scallop: number): string {
  const w = (x1 - x0) / n, r = w / 2;
  let d = `M${x0} ${top}H${x1}V${top + drop}`;
  for (let i = 0; i < n; i++) d += `a${r} ${scallop} 0 0 1 ${-w} 0`;
  return d + 'Z';
}

/** A white sticker edge around the whole silhouette, so the logo reads on dark bars and light pages alike. */
function halo(shapes: string[], width: number): string {
  return `<g fill="#FFFFFF" stroke="#FFFFFF" stroke-width="${width}" stroke-linejoin="round">${shapes.join('')}</g>`;
}

/** The awning: n stripes from x0 to x1, a straight drop, then a scallop under each stripe. */
function awning(x0: number, x1: number, top: number, drop: number, n: number, scallop: number, sw: number): string {
  const w = (x1 - x0) / n, r = w / 2;
  let stripes = '';
  for (let i = 0; i < n; i++) {
    const x = x0 + i * w;
    stripes += `<path d="M${x} ${top}h${w}v${drop}a${r} ${scallop} 0 0 1 ${-w} 0z" fill="${i % 2 ? C.white : C.green}"/>`;
  }
  const outline = awningOutline(x0, x1, top, drop, n, scallop);
  // A shade line where the awning meets the wall gives it a little depth.
  const shade = `<rect x="${x0}" y="${top}" width="${x1 - x0}" height="${Math.max(6, drop * 0.18)}" fill="${C.slate}" opacity="0.18"/>`;
  return stripes + shade + `<path d="${outline}" fill="none" stroke="${C.slate}" stroke-width="${sw}" stroke-linejoin="round"/>`;
}

function full(): string {
  const S = C.slate;
  const parts: string[] = [];
  parts.push(`<ellipse cx="256" cy="476" rx="200" ry="14" fill="#000" opacity="0.16"/>`);
  parts.push(halo([rect(82, 150, 348, 300, '#FFF', 18), rect(50, 70, 412, 104, '#FFF', 24), rect(62, 438, 388, 28, '#FFF', 14), `<path d="${awningOutline(62, 450, 168, 58, 6, 26)}"/>`], 30));
  // Building, green band, kerb.
  parts.push(rect(82, 150, 348, 300, C.white, 18, S, 14));
  parts.push(rect(89, 412, 334, 31, C.green));
  parts.push(rect(62, 438, 388, 28, S, 14));
  // Fascia with the name over the shelf bracket.
  parts.push(rect(50, 70, 412, 104, S, 24));
  parts.push(text('SHELF MADE', 256, 122, 46, C.cream, 3));
  parts.push(rect(150, 136, 212, 15, C.yellow, 7.5));
  parts.push(rect(180, 147, 16, 18, C.yellowDark, 5), rect(316, 147, 16, 18, C.yellowDark, 5));
  // Awning.
  parts.push(awning(62, 450, 168, 58, 6, 26, 12));
  // Window with a stocked shelf.
  parts.push(rect(104, 270, 200, 140, C.glass, 12, S, 11));
  parts.push(rect(110, 276, 188, 128, C.glass, 8));
  // Top row (resting on the board at y 334).
  parts.push(rect(122, 300, 22, 34, C.red, 5), rect(127, 290, 12, 14, C.red, 3), rect(124, 312, 18, 8, C.white, 2));
  parts.push(rect(152, 302, 36, 32, C.yellow, 5), rect(152, 314, 36, 7, C.orange, 0));
  parts.push(`<path d="M196 334v-30l13-10 13 10v30z" fill="${C.blue}"/>`, rect(199, 314, 20, 9, C.white, 2));
  parts.push(`<circle cx="246" cy="322" r="12" fill="${C.green}"/><circle cx="272" cy="322" r="12" fill="${C.red}"/><circle cx="259" cy="306" r="11" fill="${C.green}"/>`);
  parts.push(rect(110, 334, 188, 10, C.slate2, 3));
  // Bottom row (on the board at y 392).
  parts.push(rect(120, 368, 50, 24, C.honey, 11), `<path d="M128 372q6 -6 12 0M146 372q6 -6 12 0" stroke="${C.cream}" stroke-width="4" fill="none" stroke-linecap="round"/>`);
  parts.push(rect(178, 362, 26, 30, C.red, 5), rect(178, 371, 26, 9, C.white, 0));
  parts.push(rect(212, 358, 38, 34, C.green, 5), rect(220, 368, 22, 12, C.cream, 3));
  parts.push(rect(258, 356, 20, 36, C.blue, 5), rect(262, 348, 12, 12, C.blue, 3));
  parts.push(rect(110, 392, 188, 10, C.slate2, 3));
  // Glare across the glass.
  parts.push(`<path d="M246 276h26l-58 128h-26z" fill="#fff" opacity="0.32"/>`);
  parts.push(rect(104, 270, 200, 140, 'none', 12, S, 11));
  // Door with a window, an OPEN sign on a string and a handle.
  parts.push(rect(324, 262, 92, 182, C.green, 10, S, 11));
  parts.push(rect(338, 278, 64, 92, C.glass, 7, S, 7));
  parts.push(`<path d="M348 310L370 292L392 310" fill="none" stroke="${S}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`);
  parts.push(rect(331, 306, 78, 34, C.red, 8, S, 6));
  parts.push(text('OPEN', 370, 331, 22, C.white, 1));
  parts.push(`<circle cx="341" cy="398" r="8" fill="${C.yellow}" stroke="${S}" stroke-width="4"/>`);
  return svg(parts);
}

/** Icon sizes: the same shop with fewer, bigger shapes and heavier outlines. */
function small(): string {
  const S = C.slate;
  const parts: string[] = [];
  parts.push(halo([rect(80, 166, 352, 300, '#FFF', 26), rect(48, 54, 416, 112, '#FFF', 30), `<path d="${awningOutline(52, 460, 150, 64, 4, 34)}"/>`], 64));
  parts.push(rect(80, 166, 352, 300, C.white, 26, S, 30));
  parts.push(rect(48, 54, 416, 112, S, 30));
  parts.push(rect(140, 96, 232, 26, C.yellow, 13));
  parts.push(awning(52, 460, 150, 64, 4, 34, 26));
  // Window: glass, one shelf, three chunky products.
  parts.push(rect(104, 290, 184, 140, C.glass, 16, S, 22));
  parts.push(rect(132, 316, 38, 58, C.red, 8), rect(182, 326, 50, 48, C.yellow, 8), rect(240, 330, 30, 44, C.blue, 8));
  parts.push(rect(115, 374, 162, 18, C.slate2, 4));
  // Door with the red sign.
  parts.push(rect(310, 280, 100, 180, C.green, 14, S, 22));
  parts.push(rect(326, 318, 68, 40, C.red, 10, S, 10));
  return svg(parts);
}

function svg(parts: string[]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${parts.join('')}</svg>\n`;
}

mkdirSync(OUT, { recursive: true });
const fullSvg = full(), smallSvg = small();
writeFileSync(join(OUT, 'logo.svg'), fullSvg);
writeFileSync(join(OUT, 'logo-small.svg'), smallSvg);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH === undefined ? '/opt/pw-browsers/chromium' : (process.env.CHROMIUM_PATH || undefined) });
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  const jobs: [string, string, number][] = [[fullSvg, 'logo-512.png', 512], [fullSvg, 'logo-192.png', 192], [fullSvg, 'logo-180.png', 180], [smallSvg, 'logo-64.png', 64], [smallSvg, 'logo-32.png', 32]];
  for (const [src, name, size] of jobs) {
    const url = await page.evaluate(async ({ src, size }) => {
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${btoa(src)}`;
      await img.decode();
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      const g = c.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, size, size);
      return c.toDataURL('image/png');
    }, { src, size });
    writeFileSync(join(OUT, name), Buffer.from(url.split(',')[1]!, 'base64'));
  }
  console.log(`wrote logo.svg, logo-small.svg and ${jobs.length} PNGs to public/brand/`);
} finally {
  await browser.close();
}
