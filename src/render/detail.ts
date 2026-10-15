import { CanvasTexture, RepeatWrapping, LinearMipmapLinearFilter, LinearFilter, type MeshStandardMaterial } from 'three';

/**
 * Surface detail for everything that makes up the town and the shops: no flat colour anywhere. A small
 * tileable noise texture (R: soft mottling, G: fine speckle) is sampled in world space along each
 * surface's main axis (so walls, floors and roofs all get it without UVs, in three texture reads a
 * pixel), and the shader decides by colour what a surface is: light greys are concrete (grain and slab
 * joints a tile apart), dark greys are asphalt (grain and specks of aggregate), flat roofs have sheet
 * seams, everything else a gentler grain, and broad weathering a few tiles across keeps long roads and
 * big walls from looking flat from afar. People, cars and the products on the shelves keep the clean
 * material.
 */
export function detailTexture(size = 256): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d'); if (!ctx) return null;
  // Tileable value noise: a few octaves on lattices that divide the tile, so the edges meet.
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const lattice = (n: number) => Array.from({ length: n * n }, () => rnd());
  const octaves = [[4, 0.4], [8, 0.3], [16, 0.2], [32, 0.1]].map(([n, w]) => ({ n: n!, w: w!, g: lattice(n!) }));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number) => {
    let v = 0;
    for (const o of octaves) {
      const fx = (x / size) * o.n, fy = (y / size) * o.n;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = smooth(fx - x0), ty = smooth(fy - y0);
      const at = (i: number, j: number) => o.g[((j % o.n) + o.n) % o.n * o.n + ((i % o.n) + o.n) % o.n]!;
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      v += o.w * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
    }
    return v;
  };
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    img.data[i] = Math.round(Math.max(0, Math.min(1, (noise(x, y) - 0.5) * 1.6 + 0.5)) * 255);
    img.data[i + 1] = Math.round(rnd() * 255);
    img.data[i + 2] = 128; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(cv);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter; tex.magFilter = LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/** Give a material the surface detail (world-space, three-sided), keyed by the colour underneath. */
export function addSurfaceDetail(mat: MeshStandardMaterial, tex: CanvasTexture | null): MeshStandardMaterial {
  if (!tex) return mat;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: tex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDetailPos;\nvarying vec3 vDetailNormal;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        #ifdef USE_INSTANCING
          vDetailPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vDetailNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vDetailPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vDetailNormal = normalize(mat3(modelMatrix) * objectNormal);
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nvarying vec3 vDetailPos;\nvarying vec3 vDetailNormal;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          // Project along the surface's main axis (the town is boxes, so three-way blending buys little):
          // three texture reads a pixel in all.
          vec3 an = abs(normalize(vDetailNormal));
          float flatUp = step(max(an.x, an.z), an.y);
          vec2 uv = flatUp > 0.5 ? vDetailPos.xz : (an.x > an.z ? vDetailPos.zy : vDetailPos.xy);
          float mott = texture2D(uDetail, uv * 1.1).r;
          // Grains a fortieth of a tile across: big enough to read at the usual camera distance.
          float speck = texture2D(uDetail, uv * 0.16).g;
          // Broad weathering, tiles across, on a skewed lattice so it never lines up with the roads.
          float broad = texture2D(uDetail, mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.07).r;
          vec3 c = diffuseColor.rgb;
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
          float grey = 1.0 - smoothstep(0.03, 0.12, sat);
          // Grain everywhere, stronger on greys (concrete, asphalt, stone), softer on very light paint.
          float amt = mix(0.07, 0.16, grey) * mix(1.0, 0.55, smoothstep(0.55, 0.9, lum));
          c *= 1.0 + (mott - 0.5) * 2.0 * amt + (broad - 0.5) * mix(0.1, 0.26, grey) + (speck - 0.5) * 0.05;
          float flatness = smoothstep(0.75, 0.95, an.y) * grey;
          // Asphalt (dark grey, flat): light and dark grains of aggregate.
          float asphalt = flatness * (1.0 - smoothstep(0.12, 0.22, lum));
          c *= 1.0 + asphalt * (smoothstep(0.8, 0.92, speck) * 0.4 - smoothstep(0.22, 0.08, speck) * 0.2);
          // Concrete (light grey, flat): slab joints a tile apart, antialiased.
          float concrete = flatness * smoothstep(0.3, 0.42, lum);
          vec2 g = abs(fract(vDetailPos.xz + 0.5) - 0.5);
          vec2 w = fwidth(vDetailPos.xz) * 1.2 + 0.006;
          float joint = max(1.0 - smoothstep(0.0, w.x, g.x), 1.0 - smoothstep(0.0, w.y, g.y));
          c *= 1.0 - concrete * joint * 0.22;
          // Flat roofs (mid grey, above the walls): rolled sheets with a seam every half tile.
          float roof = flatness * step(0.98, vDetailPos.y) * (1.0 - smoothstep(0.12, 0.2, abs(lum - 0.24)));
          float rs = abs(fract(vDetailPos.x * 2.0 + 0.5) - 0.5) * 0.5;
          float seam = 1.0 - smoothstep(0.0, fwidth(vDetailPos.x) * 1.2 + 0.004, rs);
          c *= 1.0 - roof * seam * 0.25;
          diffuseColor.rgb = c;
        }`);
  };
  mat.customProgramCacheKey = () => 'surface-detail-4';
  return mat;
}
