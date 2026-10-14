/**
 * Converts Fredoka Bold (OFL) into three.js's typeface JSON so the shop sign can be real
 * extruded, rounded letters that match the wordmark. Latin letters, digits and a few symbols.
 *   npm run gen:font
 */
import opentype from 'opentype.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const buf = readFileSync(join(ROOT, 'third_party', 'fredoka', 'Fredoka-Bold.ttf'));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 &'-.!?,$";
const scale = 1000 / font.unitsPerEm;
const glyphs: Record<string, { ha: number; x_min: number; x_max: number; o: string }> = {};
for (const ch of chars) {
  const g = font.charToGlyph(ch);
  const path = g.getPath(0, 0, font.unitsPerEm);
  const parts: string[] = [];
  // three's typeface format: y up, commands m/l/q/b, quadratic control point AFTER the end point.
  for (const c of path.commands) {
    const P = (x: number, y: number) => `${Math.round(x * scale)} ${Math.round(-y * scale)}`;
    if (c.type === 'M') parts.push(`m ${P(c.x, c.y)}`);
    else if (c.type === 'L') parts.push(`l ${P(c.x, c.y)}`);
    else if (c.type === 'Q') parts.push(`q ${P(c.x, c.y)} ${P(c.x1, c.y1)}`);
    else if (c.type === 'C') parts.push(`b ${P(c.x, c.y)} ${P(c.x1, c.y1)} ${P(c.x2, c.y2)}`);
  }
  const bb = g.getBoundingBox();
  glyphs[ch] = { ha: Math.round((g.advanceWidth ?? 0) * scale), x_min: Math.round(bb.x1 * scale), x_max: Math.round(bb.x2 * scale), o: parts.join(' ') };
}
const out = {
  glyphs, familyName: 'Fredoka', ascender: Math.round(font.ascender * scale), descender: Math.round(font.descender * scale),
  underlinePosition: -100, underlineThickness: 50, boundingBox: { yMin: -250, xMin: -50, yMax: 1000, xMax: 1200 }, resolution: 1000,
  original_font_information: { format: 0, copyright: 'Copyright 2016 The Fredoka Project Authors. SIL Open Font License 1.1.' }, cssFontWeight: 'bold', cssFontStyle: 'normal',
};
mkdirSync(join(ROOT, 'public', 'fonts'), { recursive: true });
writeFileSync(join(ROOT, 'public', 'fonts', 'fredoka-bold.typeface.json'), JSON.stringify(out));
console.log(`${Object.keys(glyphs).length} glyphs written`);
