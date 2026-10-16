import { CanvasTexture, RepeatWrapping, LinearMipmapLinearFilter, LinearFilter, Vector4, type MeshStandardMaterial } from 'three';
import { skyUniforms } from './Lighting';

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
          // Lifted a little: a sunny toy town's roads are a friendly mid grey, not a black slab.
          c *= (1.0 + asphalt * 0.45) * (1.0 + asphalt * (smoothstep(0.8, 0.92, speck) * 0.4 - smoothstep(0.22, 0.08, speck) * 0.2));
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

/** How wet the town is, shared by every wet-able material: wetness 0..1, rain 0..1, a clock, and the shop's dry floor (x0, z0, x1, z1). */
export const wetUniforms = {
  uWet: { value: 0 },
  uRain: { value: 0 },
  uRainTime: { value: 0 },
  uShelter: { value: new Vector4(0, 0, 0, 0) },
};

/**
 * Rain on the ground, the way most games do it cheaply: everything facing up darkens and turns glossy
 * as it gets wet; puddles grow out of the low patches (a broad noise, so the road is never one mirror);
 * in them the water is near black and smooth, reflects the sky strongly at the angles you look at it
 * from, and is broken by rings spreading from the drops (procedural ripples: four cells a pixel, no
 * textures, no extra draws). Under the shop's floor nothing gets wet. Layered on the surface detail.
 */
export function addWetness(mat: MeshStandardMaterial): MeshStandardMaterial {
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    base.call(mat, sh, r);
    Object.assign(sh.uniforms, wetUniforms, skyUniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uWet; uniform float uRain; uniform float uRainTime; uniform vec4 uShelter;
        uniform vec3 uSkyTop; uniform vec3 uSkyHorizon; uniform vec3 uSunDir; uniform vec3 uSunCol;
        float wetHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        // Rings spreading from raindrops on standing water: the slope of the surface at p (world units).
        vec2 rainRipples(vec2 p, float t) {
          vec2 q = p / 0.32;
          vec2 base = floor(q - 0.5);
          vec2 slope = vec2(0.0);
          for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
            vec2 cell = base + vec2(float(i), float(j));
            float h = wetHash(cell);
            vec2 c = cell + 0.2 + 0.6 * vec2(h, wetHash(cell + 3.7));
            float tt = fract(t * (0.9 + 0.7 * h) + wetHash(cell + 9.1));
            vec2 dv = q - c;
            float d = length(dv) + 1e-4;
            float x = d - tt * 0.85;
            float wave = cos(x * 34.0) * exp(-x * x * 90.0) * (1.0 - tt) * (1.0 - tt);
            slope += dv / d * wave;
          }
          return slope;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        // Wet: facing up, outdoors (not on the shop floor), as wet as the weather has made it.
        float wetUp = smoothstep(0.75, 0.95, normalize(vDetailNormal).y);
        float sheltered = step(uShelter.x, vDetailPos.x) * step(vDetailPos.x, uShelter.z) * step(uShelter.y, vDetailPos.z) * step(vDetailPos.z, uShelter.w);
        float wetK = uWet * wetUp * (1.0 - sheltered);
        float puddle = 0.0;
        // Dry days skip all of it (the same branch for every pixel, so it costs next to nothing).
        if (uWet > 0.005) {
          // Puddles: broad smooth blobs (two octaves of the mottle, never the fine grain), soft at the
          // edges, spreading as the ground soaks.
          float pn = texture2D(uDetail, vDetailPos.xz * 0.035 + 0.37).r * 0.65 + texture2D(uDetail, mat2(0.8, -0.6, 0.6, 0.8) * vDetailPos.xz * 0.09 + 0.11).r * 0.35;
          float pt = 0.67 - 0.09 * uWet;
          puddle = wetK * smoothstep(pt - 0.025, pt + 0.025, pn);
          diffuseColor.rgb *= mix(1.0, 0.62, wetK) * mix(1.0, 0.55, puddle);
          roughnessFactor = mix(roughnessFactor, 0.34, wetK);
          roughnessFactor = mix(roughnessFactor, 0.04, puddle);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (puddle > 0.01 && uRain > 0.01) {
          vec2 sl = rainRipples(vDetailPos.xz, uRainTime) * 0.22 * uRain * puddle;
          normal = normalize(normal + (viewMatrix * vec4(-sl.x, 0.0, -sl.y, 0.0)).xyz);
        }`)
      .replace('#include <opaque_fragment>', `
        // The sky in the water: worked out from the sky's colours in the reflected direction (no
        // environment map), with the sun's glint, weighted by Fresnel so it shines most at a low angle.
        // Standing water mirrors it; a merely wet surface only takes a faint sheen.
        if (wetK > 0.01) {
          vec3 rv = inverseTransformDirection(reflect(-geometryViewDir, normal), viewMatrix);
          vec3 sky = mix(uSkyHorizon, uSkyTop, pow(max(rv.y, 0.0), 0.6));
          float sd = max(dot(rv, uSunDir), 0.0);
          sky += uSunCol * (pow(sd, 600.0) * 8.0 + pow(sd, 60.0) * 0.5);
          float fres = 0.04 + 0.96 * pow(1.0 - saturate(dot(normal, geometryViewDir)), 5.0);
          float k = puddle * clamp(0.5 + fres * 1.5, 0.0, 0.9) + (wetK - puddle) * (0.1 + fres * 0.6);
          outgoingLight = mix(outgoingLight, sky, k);
        }
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'surface-detail-4-wet-2';
  return mat;
}

/**
 * A wet sheen for anything out in the rain that is not the ground: car roofs and bonnets, awnings,
 * benches, bins. Facing up and outdoors it darkens a touch, turns glossy and catches the sky (Fresnel),
 * all in the shader from the shared uniforms. `outdoorsOnly` keeps it off the shop floor's fixtures
 * (needs the surface detail's world position; cars are always outdoors).
 */
export function addWetSheen(mat: MeshStandardMaterial, outdoorsOnly: boolean): MeshStandardMaterial {
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    base.call(mat, sh, r);
    Object.assign(sh.uniforms, wetUniforms, skyUniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uWet; uniform vec4 uShelter;
        uniform vec3 uSkyTop; uniform vec3 uSkyHorizon; uniform vec3 uSunDir; uniform vec3 uSunCol;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float sheen = 0.0;
        if (uWet > 0.01) {
          // (Flat shaded, as three draws a model with no normals, there is no vNormal: the face's own.)
          #ifdef FLAT_SHADED
            vec3 nW = inverseTransformDirection(normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition))), viewMatrix);
          #else
            vec3 nW = inverseTransformDirection(normalize(vNormal), viewMatrix);
          #endif
          sheen = uWet * smoothstep(0.55, 0.9, nW.y);
          ${outdoorsOnly ? 'sheen *= 1.0 - step(uShelter.x, vDetailPos.x) * step(vDetailPos.x, uShelter.z) * step(uShelter.y, vDetailPos.z) * step(vDetailPos.z, uShelter.w);' : ''}
          diffuseColor.rgb *= 1.0 - 0.18 * sheen;
          roughnessFactor = mix(roughnessFactor, 0.25, sheen);
        }`)
      .replace('#include <opaque_fragment>', `
        if (sheen > 0.01) {
          vec3 rv = inverseTransformDirection(reflect(-geometryViewDir, normal), viewMatrix);
          vec3 sky = mix(uSkyHorizon, uSkyTop, pow(max(rv.y, 0.0), 0.6));
          float sd = max(dot(rv, uSunDir), 0.0);
          sky += uSunCol * pow(sd, 300.0) * 4.0;
          float fres = 0.04 + 0.96 * pow(1.0 - saturate(dot(normal, geometryViewDir)), 5.0);
          outgoingLight = mix(outgoingLight, sky, sheen * (0.06 + fres * 0.7));
        }
        #include <opaque_fragment>`);
  };
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${key()}|wet-sheen-${outdoorsOnly ? 1 : 0}`;
  return mat;
}
