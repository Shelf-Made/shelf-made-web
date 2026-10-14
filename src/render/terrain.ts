import { BufferGeometry, Float32BufferAttribute, Color, MeshStandardMaterial, DoubleSide, Shape, ExtrudeGeometry, IcosahedronGeometry, CylinderGeometry } from 'three';
import type { PaletteMap } from './palette';
import { box, merge, paint } from './geometry';
import { groundHeight, outsideBasin, BASIN, type TownPlan } from './town';
import { riverZ, RIVER_HALF_W, ROAD_Z, TUNNEL_X } from '@/sim/layout';

/**
 * The land: one low-poly mesh with shared vertices, so colour blends softly from vertex to vertex
 * (no blotchy triangles) while flat shading still gives the cliffs their facets. Rows run east–west
 * and are finest over the pocket; six of them follow the creek so its channel is cut cleanly
 * wherever it bends. Colour comes from height, slope and a little noise: mottled lawn on the floor,
 * banded rock with moss on the cliffs, forest floor on the plateau, rock and snow on the far range.
 */
type Row = { z: number } | { off: number; y: number };

export function terrainGeometry(): BufferGeometry {
  const rows: Row[] = [];
  const W = RIVER_HALF_W;
  for (let z = -130; z < -40; z += 3) rows.push({ z });
  for (let z = -40; z <= 14.51; z += 1.5) rows.push({ z });
  rows.push({ off: -(W + 0.8), y: 0 }, { off: -(W - 0.1), y: -0.26 }, { off: -W * 0.45, y: -0.45 }, { off: W * 0.45, y: -0.45 }, { off: W - 0.1, y: -0.26 }, { off: W + 0.8, y: 0 });
  for (let z = 21.5; z < 40; z += 1.5) rows.push({ z });
  for (let z = 40; z <= 110.01; z += 3) rows.push({ z });
  const cols: number[] = [];
  for (let x = -150; x < -60; x += 3) cols.push(x);
  for (let x = -60; x < 60; x += 1.5) cols.push(x);
  for (let x = 60; x <= 150.01; x += 3) cols.push(x);
  const nx = cols.length;
  const vp: [number, number, number][] = [], vc: Color[] = [];
  for (const r of rows) for (const x of cols) {
    let y: number, z: number;
    if ('z' in r) { z = r.z; y = groundHeight(x, z); }
    else {
      z = riverZ(x) + r.off;
      // Beyond the pocket the creek is gone: the cliff carries on unbroken.
      y = r.y === 0 || outsideBasin(x, z) > 0 ? groundHeight(x, z) : r.y;
    }
    vp.push([x, y, z]);
    const c = new Color(); colourAt(c, x, y, z); vc.push(c);
  }
  // Lawns and meadows blend from vertex to vertex; steep rock takes one colour per face, so the
  // cliffs keep crisp low-poly facets.
  const pos: number[] = [], col: number[] = [];
  const face = new Color();
  const tri = (i: number, j: number, k: number) => {
    const a = vp[i]!, b = vp[j]!, c = vp[k]!;
    const lo = Math.min(a[1], b[1], c[1]), hi = Math.max(a[1], b[1], c[1]);
    const steep = lo > -0.05 && (hi - lo) / 1.5 > 0.7;
    if (steep) rockFace(face, (a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3);
    for (const [v, p] of [[i, a], [j, b], [k, c]] as const) {
      pos.push(...p);
      const cc = steep ? face : vc[v]!;
      col.push(cc.r, cc.g, cc.b);
    }
  };
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
    if ((i + j) % 2) { tri(a, d, b); tri(b, d, e); } else { tri(a, d, e); tri(a, e, b); }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.translate(0, -0.02, 0);
  return g;
}

function h01(x: number, z: number): number { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); }
function vn(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = h01(xi, zi), b = h01(xi + 1, zi), c = h01(xi, zi + 1), d = h01(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
const K = (hex: string) => new Color(hex);
const LAWN = K('#7CC26B'), LAWN_LIGHT = K('#97D27A'), LAWN_DARK = K('#62AB57'), LAWN_WARM = K('#A9C96C');
const ROCK_A = K('#8C877F'), ROCK_B = K('#6F6A63'), ROCK_C = K('#A39B8D'), ROCK_WARM = K('#9A8572'), MOSS = K('#6E9A58');
const FOREST = K('#4C9A50'), FOREST_DARK = K('#3B7F45'), MEADOW = K('#6FB25C'), SNOW = K('#F4F7FA'), BANK = K('#8A6A4A'), BED = K('#6E5440');

function slopeAt(x: number, z: number): number {
  const e = 0.75;
  return Math.hypot(groundHeight(x + e, z) - groundHeight(x - e, z), groundHeight(x, z + e) - groundHeight(x, z - e)) / (2 * e);
}

/** One face of cliff: banded strata, a warm or pale block here and there, moss on the low ledges. */
function rockFace(out: Color, x: number, y: number, z: number): void {
  if (Math.abs(x) > TUNNEL_X + 0.5 && Math.abs(x) < TUNNEL_X + 4 && Math.abs(z - ROAD_Z) < 2.9) { out.set('#141418'); return; }
  if (y > 27) { out.copy(SNOW); return; }
  const r = h01(Math.round(x * 2), Math.round(z * 2 + y * 3));
  const band = Math.sin(y * 1.7 + vn(x / 7, z / 7) * 3) * 0.5 + 0.5;
  out.copy(ROCK_B).lerp(ROCK_A, band);
  if (r > 0.82) out.lerp(ROCK_C, 0.7); else if (r < 0.12) out.lerp(ROCK_WARM, 0.6);
  if (y < 2.2 && r > 0.4 && r < 0.6) out.lerp(MOSS, 0.6);
}

function colourAt(out: Color, x: number, y: number, z: number): void {
  // The rock just behind each tunnel mouth is the tunnel going on into the dark.
  if (Math.abs(x) > TUNNEL_X + 0.5 && Math.abs(x) < TUNNEL_X + 4 && Math.abs(z - ROAD_Z) < 2.9) { out.set('#141418'); return; }
  if (y < -0.05) { out.copy(BANK).lerp(BED, Math.min(1, (-y - 0.05) / 0.4)); return; }
  const n1 = vn(x / 3.2, z / 3.2), n2 = vn(x / 9 + 11, z / 9 - 4), n3 = vn(x / 1.3 - 7, z / 1.3 + 3);
  const slope = y > 0.02 ? slopeAt(x, z) : 0;
  if (y > 27) { out.copy(ROCK_A).lerp(SNOW, Math.min(1, (y - 27) / 3 + n1 * 0.6)); return; }
  if (slope > 0.55) {
    // Banded rock: strata wobble with the noise; moss creeps over the gentler faces.
    const band = Math.sin(y * 1.9 + n2 * 4) * 0.5 + 0.5;
    out.copy(ROCK_B).lerp(ROCK_A, band).lerp(ROCK_C, Math.max(0, n3 - 0.6) * 1.8);
    out.lerp(MOSS, Math.max(0, Math.min(0.75, (1.3 - slope) * 0.9)) * n1);
    return;
  }
  if (y > 20) { out.copy(ROCK_A).lerp(FOREST_DARK, n1 * 0.6); return; }
  if (y > 1.2) { out.copy(FOREST).lerp(FOREST_DARK, n1).lerp(MEADOW, Math.max(0, n2 - 0.55) * 2); return; }
  if (y > 0.05) { out.copy(MEADOW).lerp(MOSS, n1 * 0.5); return; }
  // The floor of the pocket: soft mottled lawn, a little warmer in sunny patches.
  out.copy(LAWN).lerp(LAWN_LIGHT, n1 * 0.7).lerp(LAWN_DARK, Math.max(0, n2 - 0.5) * 1.2).lerp(LAWN_WARM, Math.max(0, n3 - 0.72) * 2.2);
}

/** Shared by the creek and the pond: deep in the middle, pale at the edges, sparkling in the sun. */
export function waterMaterial(time: { value: number }): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.9, side: DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uT = time;
    sh.vertexShader = 'varying vec3 vW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform float uT; varying vec3 vW;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float r1 = sin(vW.x * 1.9 + vW.z * 0.7 + uT * 1.6) * sin(vW.z * 2.6 - uT * 1.2 + vW.x * 0.45);
      float r2 = sin(vW.x * 4.3 - uT * 2.1 + vW.z * 3.1) * sin(vW.z * 3.7 + uT * 1.7);
      diffuseColor.rgb += vec3(0.20, 0.24, 0.26) * smoothstep(0.55, 0.95, r1 * 0.7 + r2 * 0.3);
      diffuseColor.rgb -= vec3(0.03, 0.02, 0.0) * smoothstep(0.2, 0.9, -r1);`);
  };
  m.customProgramCacheKey = () => 'water';
  return m;
}

/** The creek's surface and the park pond: ribbons a little below the banks, pale at the edges. */
export function waterGeometry(plan: TownPlan): BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  const DEEP = K('#3C8FC4'), MID = K('#5AAFD8'), EDGE = K('#BFE6F5');
  const put = (x: number, y: number, z: number, c: Color) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); };
  // Five strips across the creek: edge, mid, deep, mid, edge; vertex colours blend between them.
  const W = RIVER_HALF_W + 0.42;
  const across: [number, Color][] = [[-W, EDGE], [-W * 0.55, MID], [0, DEEP], [W * 0.55, MID], [W, EDGE]];
  for (let x = -BASIN.x + 0.6; x < BASIN.x - 0.6; x += 1.0) {
    const x1 = Math.min(BASIN.x - 0.6, x + 1.0), z0 = riverZ(x), z1 = riverZ(x1);
    for (let k = 0; k < across.length - 1; k++) {
      const [o0, c0] = across[k]!, [o1, c1] = across[k + 1]!;
      put(x, -0.12, z0 + o0, c0); put(x, -0.12, z0 + o1, c1); put(x1, -0.12, z1 + o0, c0);
      put(x1, -0.12, z1 + o0, c0); put(x, -0.12, z0 + o1, c1); put(x1, -0.12, z1 + o1, c1);
    }
  }
  // The pond: a pale rim fading to a deep centre.
  const p = plan.pond, cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
  const ring = [[p.x0, p.z0], [p.x1, p.z0], [p.x1, p.z1], [p.x0, p.z1]] as const;
  for (let k = 0; k < 4; k++) {
    const [ax, az] = ring[k]!, [bx, bz] = ring[(k + 1) % 4]!;
    const ix = (v: number) => cx + (v - cx) * 0.55, iz = (v: number) => cz + (v - cz) * 0.45;
    put(ax, 0.03, az, EDGE); put(ix(ax), 0.03, iz(az), MID); put(bx, 0.03, bz, EDGE);
    put(bx, 0.03, bz, EDGE); put(ix(ax), 0.03, iz(az), MID); put(ix(bx), 0.03, iz(bz), MID);
    put(ix(ax), 0.03, iz(az), MID); put(cx, 0.03, cz, DEEP); put(ix(bx), 0.03, iz(bz), MID);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // Faces were wound clockwise from above in places: point every normal up.
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

/**
 * Tunnel portals in rock faces at both ends of Main Street, the culvert the creek runs into, the
 * footbridge, the waterfall rocks and the park fountain basin. The dark tunnel insides are
 * returned separately (they are drawn unlit).
 */
export function structuresGeometry(pal: PaletteMap, plan: TownPlan): { lit: BufferGeometry; dark: BufferGeometry; glow: BufferGeometry } {
  const lit: BufferGeometry[] = [], dark: BufferGeometry[] = [], glow: BufferGeometry[] = [];
  const ROCK = ['#8E8C88', '#7D8C7A', '#6F6D6A', '#ADAAA4'];
  const hw = 2.25, spring = 1.35, crown = spring + hw;
  // A wall in the z–y plane at x = face with an arch-shaped hole, `depth` deep away from the pocket.
  const archWall = (hex: string, face: number, s: number, depth: number, outerHalf: number, outerTop: number, holeHalf: number, bevel: number): BufferGeometry => {
    // A U-shaped outline: the opening is a notch up from the ground, round at the top.
    const sh = new Shape();
    sh.moveTo(-outerHalf, 0); sh.lineTo(-holeHalf, 0); sh.lineTo(-holeHalf, spring);
    sh.absarc(0, spring, holeHalf, Math.PI, 0, true);
    sh.lineTo(holeHalf, 0); sh.lineTo(outerHalf, 0); sh.lineTo(outerHalf, outerTop); sh.lineTo(-outerHalf, outerTop); sh.closePath();
    const g = new ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 14 });
    g.rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.translate(face, 0, ROAD_Z);
    return paint(g, pal, hex);
  };
  for (const tx of plan.tunnels) {
    const s = Math.sign(tx), face = tx;
    // The rock face the tunnel is cut into, running back into the cliff.
    lit.push(archWall('#7F7A72', face + s * 0.3, s, 2.4, hw + 2.2, crown + 1.8, hw + 0.5, 0.25));
    // A ring of dressed stone round the mouth, standing proud of the rock, with a keystone.
    lit.push(archWall('#C9C3B6', face - s * 0.15, s, 0.5, hw + 0.55, crown + 0.55, hw, 0.06));
    lit.push(box(pal, '#ADA597', 0.75, 0.75, 0.6, face - s * 0.05, crown - 0.1, ROAD_Z));
    // Rough boulders heaped over and round the face so it reads as a hillside, not a wall.
    for (let k = 0; k < 40; k++) {
      const r = h01(k * 3.1 + tx, 7.7), r2 = h01(k * 1.7, tx + 3);
      const z = ROAD_Z + (r - 0.5) * 13, y = r2 * 6.5;
      const dz = Math.abs(z - ROAD_Z);
      if (dz < hw + 1.2 && y < crown + 0.9) continue;
      const sz = 0.8 + h01(k, 2) * 1.1;
      const g = new IcosahedronGeometry(sz, 0);
      g.scale(1, 0.75, 1.1);
      g.rotateY(r * 6.28);
      g.translate(face + s * (0.2 + r2 * 1.2), y, z);
      lit.push(paint(g, pal, ROCK[k % 4]!));
    }
    // Inside: an arched bore, dark, with a row of warm lights along the crown.
    const len = 22, cx = tx + s * (len / 2 + 0.3);
    { const g = new CylinderGeometry(hw, hw, len, 14, 1, true, 0, Math.PI);
      g.rotateZ(Math.PI / 2); g.rotateX(-Math.PI / 2);
      g.translate(cx, spring, ROAD_Z);
      dark.push(paint(g, pal, '#2A2A30')); }
    dark.push(box(pal, '#2A2A30', len, spring, 0.2, cx, 0, ROAD_Z - hw - 0.1), box(pal, '#2A2A30', len, spring, 0.2, cx, 0, ROAD_Z + hw + 0.1));
    dark.push(box(pal, '#141418', 0.2, crown + 0.2, hw * 2 + 0.4, tx + s * (len + 0.4), 0, ROAD_Z));
    for (let k = 1; k < 7; k++) glow.push(box(pal, '#FFE2A8', 0.6, 0.05, 0.22, tx + s * (k * 3.0 + 0.3), crown - 0.1, ROAD_Z));
    // Sodium lamps either side of the mouth light the way in.
    for (const dz of [-hw - 0.2, hw + 0.2]) glow.push(box(pal, '#FFC86B', 0.12, 0.22, 0.12, face - s * 0.45, spring + 0.3, ROAD_Z + dz));
  }
  // The creek leaves the pocket through a culvert in the east cliff.
  { const x = BASIN.x - 0.1, z = riverZ(BASIN.x);
    lit.push(box(pal, '#ADAAA4', 1.0, 1.3, 0.5, x, -0.3, z - RIVER_HALF_W - 0.25), box(pal, '#ADAAA4', 1.0, 1.3, 0.5, x, -0.3, z + RIVER_HALF_W + 0.25), box(pal, '#ADAAA4', 1.0, 0.45, RIVER_HALF_W * 2 + 1.0, x, 0.85, z));
    dark.push(box(pal, '#1C1C20', 0.3, 1.0, RIVER_HALF_W * 2, x + 0.45, -0.2, z)); }
  // The waterfall pours from a notch in the west cliff into a splash pool.
  { const wf = plan.waterfall;
    for (let i = 0; i < 12; i++) {
      const r = h01(i * 2.3, 5), side = i % 2 ? 1 : -1;
      const g = new IcosahedronGeometry(0.45 + r * 0.45, 0);
      g.scale(1.2, 0.8, 1); g.rotateY(r * 6);
      g.translate(wf.x + 0.9 + r * 1.4, -0.1 + h01(i, 8) * 0.4, wf.z + side * (RIVER_HALF_W + 0.35 + h01(i, 3) * 0.6));
      lit.push(paint(g, pal, ROCK[i % 4]!));
    } }
  // Footbridge: planks on two beams with posts and rails.
  for (const b of plan.footbridges) {
    const len = b.z1 - b.z0, cz = (b.z0 + b.z1) / 2;
    lit.push(box(pal, '#7A4E2E', 1.5, 0.12, len, b.x, 0.02, cz));
    for (let z = b.z0 + 0.1; z < b.z1; z += 0.28) lit.push(box(pal, '#C8925A', 1.4, 0.05, 0.22, b.x, 0.14, z + 0.1));
    for (const side of [-0.66, 0.66]) {
      lit.push(box(pal, '#C8925A', 0.08, 0.08, len, b.x + side, 0.55, cz));
      for (let z = b.z0 + 0.05; z <= b.z1; z += len / 4) lit.push(box(pal, '#7A4E2E', 0.1, 0.62, 0.1, b.x + side, 0.0, z));
    }
  }
  // The park fountain: a stone basin, a pedestal and a bowl.
  { const f = plan.fountain;
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; lit.push(box(pal, '#D8D8DC', 0.5, 0.32, 0.9, f.x + Math.cos(a) * 1.35, 0, f.z + Math.sin(a) * 1.35, -a)); }
    lit.push(box(pal, '#5AAFD8', 2.4, 0.22, 2.4, f.x, 0, f.z), box(pal, '#ADAAA4', 0.32, 0.75, 0.32, f.x, 0.2, f.z), box(pal, '#D8D8DC', 0.9, 0.12, 0.9, f.x, 0.92, f.z), box(pal, '#5AAFD8', 0.7, 0.04, 0.7, f.x, 1.03, f.z)); }
  return { lit: merge(lit), dark: merge(dark), glow: merge(glow) };
}
