import { Group, Mesh, InstancedMesh, Object3D, Matrix4, Color, CircleGeometry, MeshBasicMaterial, MeshStandardMaterial, Vector3, Box3, PointLight, type BufferGeometry, type Raycaster } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BufferGeometry as BoxGeometryEmpty, Float32BufferAttribute } from 'three';
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import type { AssetLibrary } from './assets';
import type { GameState, Shop, Fixture, FixtureType, Rot } from '@/sim/types';
import { PRODUCTS } from '@/sim/products';
import { FIXTURES, lotLayout, WALL_T, PLOT_RECT, ROAD_Z } from '@/sim/layout';
import { MAIN_N, PAVEMENT } from './town';
import { box, merge, paint, place } from './geometry';
import { recolor, cutDown, dropTriangles } from './recolor';
import { FIXTURE_MODEL, MODEL_OFFSET, SLOT_BOXES, productGeometry, productModelIds, WALL_COLOURS, type SlotBox } from './storeArt';

const CONCRETE_HEX = '#C4C0B8', JOINT_HEX = '#A39E95', PATCH_HEX = '#BBB6AD';

const WHITE = '#FFFFFF', GREEN = '#3FA87A', SLATE = '#38383D', CREAM = '#FFF3DC', YELLOW = '#FFC044';
const LEDGE = 0.3;

export const STORE_MODELS = [...new Set(Object.values(FIXTURE_MODEL))].concat(['market/wall', 'market/wall-window', 'market/wall-door', 'furniture/cardboard-box-closed', ...productModelIds()]);

export type StoreHit = { kind: 'fixture'; id: number; type: FixtureType; dist: number } | { kind: 'delivery'; dist: number } | { kind: 'floor'; x: number; z: number; dist: number };

interface Side { full: Mesh; ledge: Mesh; nx: number; nz: number; extraFull: Mesh[] }

/** The player's store: shell (Kenney walls, concrete floor, doors, sign), fixtures, stock, delivered boxes. */
export class StoreView {
  readonly group = new Group();
  private shell = new Group();
  private sides: Side[] = [];
  private fixtureMeshes = new Map<string, { mesh: InstancedMesh; ids: number[] }>();
  private productMeshes = new Map<string, { mesh: InstancedMesh; w: number; h: number; d: number; minY: number }>();
  private boxes!: InstancedMesh;
  private spills!: InstancedMesh;
  private wells!: InstancedMesh;
  private stickers!: InstancedMesh;
  private layoutVersion = -1;
  private stockKey = '';
  private shellKey = '';
  private readonly dummy = new Object3D();
  private readonly tmpM = new Matrix4();
  private readonly color = new Color();
  private ghost: Mesh | null = null;
  private ghostMat: MeshStandardMaterial;
  private wellMat: MeshBasicMaterial;
  private spillMat: MeshBasicMaterial;
  private nightLight: PointLight;
  private font: Font | null = null;
  private deliveryBox = new Box3();
  private chillerGeo: BufferGeometry | null = null;

  constructor(private readonly assets: AssetLibrary) {
    this.group.add(this.shell);
    this.ghostMat = new MeshStandardMaterial({ color: new Color('#3FA87A'), transparent: true, opacity: 0.55, depthWrite: false, roughness: 1 });
    this.wellMat = new MeshBasicMaterial({ color: new Color('#BFEFFF') });
    this.spillMat = new MeshBasicMaterial({ color: new Color('#9FD3F0'), transparent: true, opacity: 0.7, depthWrite: false });
    this.nightLight = new PointLight(0xffd9a0, 0, 9, 1.6);
    this.group.add(this.nightLight);
  }

  async init(): Promise<void> {
    const pal = this.assets.palette;
    for (const p of PRODUCTS) {
      const geo = productGeometry(this.assets, p.id);
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      const mesh = new InstancedMesh(geo, this.assets.material, 64);
      mesh.count = 0; mesh.castShadow = true; mesh.frustumCulled = false; mesh.visible = false;
      this.group.add(mesh);
      this.productMeshes.set(p.id, { mesh, w: b.max.x - b.min.x, h: b.max.y - b.min.y, d: b.max.z - b.min.z, minY: b.min.y });
    }
    const boxGeo = this.assets.geometry('furniture/cardboard-box-closed').clone().scale(1.5, 1.5, 1.5);
    this.boxes = new InstancedMesh(boxGeo, this.assets.material, 72);
    this.boxes.castShadow = true; this.boxes.count = 0; this.boxes.frustumCulled = false;
    const spill = new CircleGeometry(0.22, 12); spill.rotateX(-Math.PI / 2);
    this.spills = new InstancedMesh(spill, this.spillMat, 8); this.spills.count = 0; this.spills.frustumCulled = false;
    // The chiller: Kenney's chest freezer without its painted lid, and a lit well inside.
    // Drops the painted lid and the body's flat top under it (at exactly 0.30), leaving the rim.
    this.chillerGeo = dropTriangles(this.assets.geometry('market/freezer'), (x, y, z) => y > 0.297 && Math.abs(x) < 0.31 && Math.abs(z) < 0.21);
    const well = merge([box(pal, '#D6F5FF', 0.6, 0.02, 0.4, 0, 0.1, 0), box(pal, '#BFEFFF', 0.6, 0.2, 0.02, 0, 0.11, -0.2), box(pal, '#BFEFFF', 0.6, 0.2, 0.02, 0, 0.11, 0.2), box(pal, '#BFEFFF', 0.02, 0.2, 0.4, -0.3, 0.11, 0), box(pal, '#BFEFFF', 0.02, 0.2, 0.4, 0.3, 0.11, 0)]);
    this.wells = new InstancedMesh(well, this.wellMat, 24); this.wells.count = 0; this.wells.frustumCulled = false;
    const sticker = box(pal, '#FFFFFF', 0.12, 0.12, 0.01, 0, 0, 0);
    this.stickers = new InstancedMesh(sticker, new MeshBasicMaterial({ color: 0xffffff }), 48); this.stickers.count = 0; this.stickers.frustumCulled = false;
    this.group.add(this.boxes, this.spills, this.wells, this.stickers);
    try { this.font = await new FontLoader().loadAsync('/fonts/fredoka-bold.typeface.json'); } catch { this.font = null; }
  }

  setNight(on: boolean): void { this.nightLight.intensity = on ? 2.2 : 0; }

  /** Chunky rounded letters from Fredoka Bold: cream faces, sunny-yellow sides. */
  private letters(text: string, size: number, depth: number): BufferGeometry {
    const pal = this.assets.palette;
    if (!this.font) return new Mesh().geometry;
    const g = new TextGeometry(text, { font: this.font, size, depth, curveSegments: 5, bevelEnabled: true, bevelThickness: depth * 0.25, bevelSize: size * 0.03, bevelSegments: 2 });
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, 0);
    // Paint by group: 0 = front/back faces, 1 = sides.
    const n = g.getAttribute('position').count;
    const uv = new Float32Array(n * 2);
    const [fu, fv] = pal.uv(CREAM), [su, sv] = pal.uv(YELLOW);
    for (let i = 0; i < n; i++) { uv[i * 2] = su; uv[i * 2 + 1] = sv; }
    for (const grp of g.groups) if (grp.materialIndex === 0) {
      const idx = g.getIndex();
      for (let k = grp.start; k < grp.start + grp.count; k++) { const v = idx ? idx.getX(k) : k; uv[v * 2] = fu; uv[v * 2 + 1] = fv; }
    }
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.clearGroups();
    const out = g.index ? g.toNonIndexed() : g;
    out.computeVertexNormals();
    return out;
  }

  textWidth(text: string, size: number): number {
    if (!this.font) return text.length * size * 0.6;
    const g = new TextGeometry(text, { font: this.font, size, depth: 0.01, curveSegments: 2 });
    g.computeBoundingBox();
    return g.boundingBox!.max.x - g.boundingBox!.min.x;
  }

  /** Rebuild the shell (walls, floor, doors, signs, lot) for a shop. */
  buildShell(shop: Shop): void {
    const pal = this.assets.palette;
    this.shell.clear();
    this.sides = [];
    const f = shop.floor;
    const ox = shop.originX, oz = shop.originZ;
    const backZ = Math.min(f.z0, shop.storeroom.z0);
    this.shellKey = `${shop.name}|${shop.originX}|${shop.sizeId}|${shop.lotRows}`;

    // ---- Floor: a poured concrete slab with saw-cut joints every two tiles, plus the lot paving outside.
    const floorParts: BufferGeometry[] = [];
    const W = f.x1 - f.x0, D = f.z1 - backZ, cx0 = ox + (f.x0 + f.x1) / 2, cz0 = oz + (backZ + f.z1) / 2;
    floorParts.push(box(pal, CONCRETE_HEX, W, 0.052, D, cx0, -0.04, cz0));
    for (let x = f.x0 + 2; x < f.x1 - 0.5; x += 2) floorParts.push(box(pal, JOINT_HEX, 0.025, 0.002, D, ox + x, 0.011, cz0));
    for (let z = backZ + 2; z < f.z1 - 0.5; z += 2) floorParts.push(box(pal, JOINT_HEX, W, 0.002, 0.025, cx0, 0.011, oz + z));
    // A few darker trowel patches so the slab does not read as flat plastic.
    for (let i = 0; i < Math.round(W * D / 6); i++) {
      const hx = f.x0 + 0.6 + ((i * 2.37) % Math.max(0.1, W - 1.2)), hz = backZ + 0.6 + ((i * 3.11) % Math.max(0.1, D - 1.2));
      floorParts.push(box(pal, PATCH_HEX, 0.7 + (i % 3) * 0.25, 0.001, 0.5 + (i % 2) * 0.3, ox + hx, 0.0115, oz + hz, (i % 4) * 0.4));
    }
    // Door thresholds: steel strips across each opening.
    floorParts.push(box(pal, '#9AA0A8', 1.2, 0.02, WALL_T, ox + shop.door.x, -0.008, oz + f.z1 + WALL_T / 2));
    floorParts.push(box(pal, '#9AA0A8', 1.2, 0.02, WALL_T, ox + shop.backDoor.x, -0.008, oz + backZ - WALL_T / 2));
    // Delivery zone: yellow-and-charcoal hazard border and a pallet.
    const d = shop.delivery;
    const dw = d.x1 - d.x0, dd = d.z1 - d.z0;
    const dcx = ox + (d.x0 + d.x1) / 2, dcz = oz + (d.z0 + d.z1) / 2;
    for (let i = 0; i < 20; i++) {
      const along = (i + 0.5) / 20;
      floorParts.push(box(pal, i % 2 ? SLATE : YELLOW, dw / 20, 0.006, 0.06, ox + d.x0 + along * dw, 0.025, oz + d.z1 - 0.04));
    }
    for (let i = 0; i < 10; i++) floorParts.push(box(pal, i % 2 ? SLATE : YELLOW, 0.06, 0.006, dd / 10, ox + d.x1 - 0.04, 0.025, oz + d.z0 + ((i + 0.5) / 10) * dd));
    floorParts.push(box(pal, '#B8824C', dw - 0.24, 0.05, dd - 0.2, dcx, 0.025, dcz));
    this.deliveryBox.set(new Vector3(ox + d.x0, 0, oz + d.z0), new Vector3(ox + d.x1, 1.0, oz + d.z1));
    // Lot: apron, walkway, aisle, bays, driveway, service lane, back yard; then the frontage sidewalk.
    const L = lotLayout(shop);
    const slab = (r: { x0: number; z0: number; x1: number; z1: number }, hex: string, h = 0.03, y = -0.012) =>
      floorParts.push(box(pal, hex, r.x1 - r.x0, h, r.z1 - r.z0, ox + (r.x0 + r.x1) / 2, y, oz + (r.z0 + r.z1) / 2));
    const swIn = MAIN_N[0] - oz, swOut = MAIN_N[1] - oz, kerb = ROAD_Z - 1.0 - oz;
    // The apron stops at the driveway so the tarmac runs unbroken from the road to the bays.
    slab({ ...L.apron, z0: WALL_T - 0.02, x1: Math.min(L.apron.x1, L.driveway.x0) }, '#CFCBC2', 0.04);
    slab({ x0: L.walkwayX - 0.5, z0: L.apron.z1 - 0.02, x1: L.walkwayX + 0.5, z1: swIn + 0.02 }, '#CFCBC2', 0.04);
    slab({ ...L.aisle, z1: L.driveway.z0 + 0.02 }, '#6E717C'); slab({ ...L.driveway, z1: kerb }, '#6E717C'); slab({ ...L.serviceLane, z1: kerb }, '#6E717C'); slab(L.backYard, '#6E717C');
    for (const b of L.bays) {
      slab({ x0: b.x - 0.85, z0: b.z - 0.55, x1: b.x + 0.85, z1: b.z + 0.55 }, '#6E717C');
      floorParts.push(box(pal, '#F2F2F2', 1.6, 0.004, 0.05, ox + b.x, 0.02, oz + b.z - 0.55));
      floorParts.push(box(pal, '#F2F2F2', 1.6, 0.004, 0.05, ox + b.x, 0.02, oz + b.z + 0.55));
    }
    // Sidewalk across the whole plot frontage, with dropped kerbs where the driveway and service lane cross it.
    const cuts = [[L.serviceLane.x0, L.serviceLane.x1], [L.driveway.x0, L.driveway.x1]].sort((a, b) => a[0]! - b[0]!);
    let sx = PLOT_RECT.x0;
    for (const [c0, c1] of cuts) { if (c0! > sx) slab({ x0: sx, z0: swIn, x1: c0!, z1: swOut }, PAVEMENT, 0.06, -0.012); sx = c1!; }
    slab({ x0: sx, z0: swIn, x1: PLOT_RECT.x1, z1: swOut }, PAVEMENT, 0.06, -0.012);
    for (const [c0, c1] of cuts) slab({ x0: c0!, z0: swIn, x1: c1!, z1: swOut }, '#B9BCC4', 0.034, -0.01);
    // A zebra across the driveway mouth: walkers have priority.
    for (let i = 0; i < 4; i++) floorParts.push(box(pal, '#F2F2F2', 0.22, 0.004, swOut - swIn - 0.08, ox + L.driveway.x0 + 0.3 + i * 0.44, 0.026, oz + (swIn + swOut) / 2));
    this.dressLot(shop, floorParts);
    const floorMesh = new Mesh(merge(floorParts), this.assets.material);
    floorMesh.receiveShadow = true;
    this.shell.add(floorMesh);

    // ---- Walls: Kenney wall pieces recoloured, standing just outside the floor edge.
    const wallG = recolor(this.assets.geometry('market/wall'), WALL_COLOURS);
    const windowG = recolor(this.assets.geometry('market/wall-window'), WALL_COLOURS);
    const doorG = recolor(this.assets.geometry('market/wall-door'), WALL_COLOURS);
    const windowGlass = this.assets.glassGeometry('market/wall-window');
    const glassParts: BufferGeometry[] = [];
    const side = (tiles: number[], line: number, axis: 'x' | 'z', outward: number, yaw: number, doorAt: number | null, windows: boolean) => {
      const full: BufferGeometry[] = [], ledge: BufferGeometry[] = [];
      for (const t of tiles) {
        const isDoor = doorAt !== null && Math.abs(t - doorAt) < 0.01;
        const isWindow = windows && !isDoor && Math.abs(t - (doorAt ?? 99)) > 0.6;
        const src = isDoor ? doorG : isWindow ? windowG : wallG;
        const px = axis === 'x' ? ox + t : ox + line + outward * WALL_T / 2;
        const pz = axis === 'x' ? oz + line + outward * WALL_T / 2 : oz + t;
        full.push(place(src.clone(), px, 0, pz, yaw));
        ledge.push(place(isDoor ? src.clone() : cutDown(src, LEDGE), px, 0, pz, yaw));
        if (isWindow && windowGlass) glassParts.push(place(windowGlass.clone(), px, 0, pz, yaw));
      }
      const fullMesh = new Mesh(merge(full), this.assets.material);
      const ledgeMesh = new Mesh(merge(ledge), this.assets.material);
      for (const m of [fullMesh, ledgeMesh]) { m.castShadow = true; m.receiveShadow = true; this.shell.add(m); }
      const nx = axis === 'z' ? outward : 0, nz = axis === 'x' ? outward : 0;
      const s: Side = { full: fullMesh, ledge: ledgeMesh, nx, nz, extraFull: [] };
      this.sides.push(s);
      return s;
    };
    const xs: number[] = []; for (let x = f.x0 + 0.5; x < f.x1; x++) xs.push(x);
    const zs: number[] = []; for (let z = backZ + 0.5; z < f.z1; z++) zs.push(z);
    const front = side(xs, f.z1, 'x', 1, 0, shop.door.x, true);
    side(xs, backZ, 'x', -1, Math.PI, shop.backDoor.x, false);
    side(zs, f.x0, 'z', -1, -Math.PI / 2, null, false);
    side(zs, f.x1, 'z', 1, Math.PI / 2, null, false);
    // Corner posts: a half-width wall piece turned to close each corner.
    const corner = place(wallG.clone(), 0, 0, 0, 0, 0.5, 1, 1);
    const posts: BufferGeometry[] = [];
    for (const [cx, cz] of [[f.x0 - 0.25, f.z1 + 0.25], [f.x1 + 0.25, f.z1 + 0.25], [f.x0 - 0.25, backZ - 0.25], [f.x1 + 0.25, backZ - 0.25]] as const) posts.push(place(corner.clone(), ox + cx, 0, oz + cz));
    const postMesh = new Mesh(merge(posts), this.assets.material);
    postMesh.castShadow = true;
    this.shell.add(postMesh);
    if (glassParts.length) { const gm = new Mesh(merge(glassParts), this.assets.glass); this.shell.add(gm); front.extraFull.push(gm); }

    // ---- Front: striped awning over the windows, the name on a fascia, and a pylon by the road.
    const width = f.x1 - f.x0;
    const fz = oz + f.z1 + WALL_T + 0.02;
    const awning: BufferGeometry[] = [];
    let k = 0;
    for (let x = ox + f.x0; x < ox + f.x1 - 0.01; x += 0.25, k++) {
      if (Math.abs(x + 0.125 - (ox + shop.door.x)) < 0.55) continue;
      const g = box(pal, k % 2 ? WHITE : GREEN, 0.25, 0.035, 0.42, 0, 0, 0);
      g.rotateX(0.42);
      g.translate(x + 0.125, 0.86, fz + 0.18);
      awning.push(g);
    }
    awning.push(box(pal, GREEN, width, 0.05, 0.06, ox + (f.x0 + f.x1) / 2, 0.98, fz + 0.01));
    const awningMesh = new Mesh(merge(awning), this.assets.material);
    awningMesh.castShadow = true;
    this.shell.add(awningMesh);
    front.extraFull.push(awningMesh);
    const name = shop.name;
    const fascia: BufferGeometry[] = [];
    const size = Math.min(0.3, (width - 0.6) / Math.max(1, this.textWidth(name, 1)));
    fascia.push(box(pal, SLATE, width + 0.5, 0.5, 0.1, ox + (f.x0 + f.x1) / 2, 1.0, fz - 0.02));
    fascia.push(box(pal, GREEN, width + 0.54, 0.05, 0.14, ox + (f.x0 + f.x1) / 2, 1.48, fz - 0.02));
    const fl = this.letters(name, size, 0.05);
    fascia.push(place(fl, ox + (f.x0 + f.x1) / 2, 1.25 - size * 0.4, fz + 0.04));
    fascia.push(...this.bracket(ox + (f.x0 + f.x1) / 2, 1.06, fz + 0.04, Math.min(width - 0.3, this.textWidth(name, size) + 0.2)));
    const fasciaMesh = new Mesh(merge(fascia), this.assets.material);
    fasciaMesh.castShadow = true;
    this.shell.add(fasciaMesh);
    front.extraFull.push(fasciaMesh);
    // Pylon sign on the lawn by the sidewalk, readable from the street in both directions.
    const px = ox - L.halfW - 0.6, pz = oz + 1.85;
    const boardW = 2.6;
    const psize = Math.min(0.26, (boardW - 0.35) / Math.max(1, this.textWidth(name, 1)));
    const pylon: BufferGeometry[] = [
      box(pal, SLATE, 0.12, 1.5, 0.12, px - boardW / 2 + 0.2, 0, pz), box(pal, SLATE, 0.12, 1.5, 0.12, px + boardW / 2 - 0.2, 0, pz),
      box(pal, SLATE, boardW, 0.55, 0.12, px, 1.0, pz), box(pal, GREEN, boardW + 0.06, 0.05, 0.16, px, 1.55, pz),
    ];
    for (const yaw of [0, Math.PI]) {
      const zOff = yaw === 0 ? 0.07 : -0.07;
      pylon.push(place(this.letters(name, psize, 0.04), px, 1.24 - psize * 0.4, pz + zOff, yaw));
      pylon.push(...this.bracket(px, 1.07, pz + zOff, Math.min(boardW - 0.3, this.textWidth(name, psize) + 0.16), yaw));
    }
    const pylonMesh = new Mesh(merge(pylon), this.assets.material);
    pylonMesh.castShadow = true;
    this.shell.add(pylonMesh);
    this.nightLight.position.set(ox + (f.x0 + f.x1) / 2, 0.95, oz + (backZ + f.z1) / 2);
    this.layoutVersion = -1;
    this.stockKey = '';
  }

  /**
   * Garden on the parts of the plot the shop and its lot do not use: trees, bushes and flowers on a
   * loose grid, never on paving. A bench and a bin by the door, a dumpster in the yard.
   */
  private dressLot(shop: Shop, parts: BufferGeometry[]): void {
    const L = lotLayout(shop);
    const f = shop.floor, ox = shop.originX, oz = shop.originZ;
    const backZ = Math.min(f.z0, shop.storeroom.z0);
    const used = [
      { x0: f.x0 - WALL_T, z0: backZ - WALL_T, x1: f.x1 + WALL_T, z1: f.z1 + WALL_T }, L.apron, L.aisle, L.driveway, L.serviceLane, L.backYard,
      { x0: L.walkwayX - 0.5, z0: L.apron.z1, x1: L.walkwayX + 0.5, z1: 3 },
      { x0: -L.halfW - 2.0, z0: 0, x1: -L.halfW + 0.8, z1: 1.2 }, // pylon sign
      ...L.bays.map((b) => ({ x0: b.x - 0.9, z0: b.z - 0.6, x1: b.x + 0.9, z1: b.z + 0.6 })),
    ];
    const free = (x: number, z: number, m: number) => !used.some((r) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m);
    const swIn = MAIN_N[0] - oz;
    const trees = ['nature/tree-oak', 'nature/tree-default', 'nature/tree-detailed', 'suburban/tree-small'];
    const bushes = ['nature/plant-bush', 'nature/plant-bushdetailed', 'nature/plant-bushsmall'];
    const flowers = ['nature/flower-reda', 'nature/flower-yellowa', 'nature/flower-purplea'];
    for (let z = PLOT_RECT.z0 + 1.1; z < swIn - 0.5; z += 1.0) for (let x = PLOT_RECT.x0 + 1.1; x < PLOT_RECT.x1 - 0.9; x += 1.0) {
      const k = (Math.round(x * 2) * 7 + Math.round(z * 2) * 13) & 15;
      if (k === 0 && free(x, z, 1.1)) parts.push(this.placed(trees[(Math.round(x) + Math.round(z)) & 3]!, ox + x, oz + z, x * 1.7, 0.95));
      else if ((k === 5 || k === 11) && free(x, z, 0.5)) parts.push(this.placed(bushes[Math.abs(Math.round(x * 3)) % 3]!, ox + x, oz + z, z * 2.1, 1));
      else if (k === 8 && free(x, z, 0.4)) for (let i = 0; i < 3; i++) parts.push(this.placed(flowers[i]!, ox + x + (i - 1) * 0.28, oz + z + (i % 2) * 0.2, i, 1));
    }
    parts.push(this.placed('furniture/bench', ox + shop.door.x - 1.7, oz + f.z1 + WALL_T + 0.42, 0, 1));
    parts.push(this.placed('furniture/trashcan', ox + shop.door.x + 1.25, oz + f.z1 + WALL_T + 0.3, 0, 1));
    parts.push(this.placed('roads/dumpster', ox + L.backYard.x1 - 0.8, oz + L.backYard.z0 + 0.6, Math.PI / 2, 1));
  }

  private placed(id: string, x: number, z: number, yaw: number, s: number): BufferGeometry {
    if (!this.assets.has(id)) return new BoxGeometryEmpty();
    const g = this.assets.geometry(id).clone();
    g.scale(s, s, s); g.rotateY(yaw); g.translate(x, 0, z);
    return g;
  }

  /** The wordmark's shelf-bracket underline: a green bar with two little brackets. */
  private bracket(x: number, y: number, z: number, w: number, yaw = 0): BufferGeometry[] {
    const pal = this.assets.palette;
    const g = [box(pal, GREEN, w, 0.035, 0.04, 0, 0, 0), box(pal, GREEN, 0.035, 0.07, 0.04, -w / 2 + 0.06, -0.07, 0), box(pal, GREEN, 0.035, 0.07, 0.04, w / 2 - 0.06, -0.07, 0)];
    return g.map((p) => place(p, x, y, z, yaw));
  }

  /** Per frame: wall cut-down (cinematic camera only), fixtures, stock, boxes, spills. */
  update(state: GameState, cameraYaw: number | null): void {
    const shop = state.shop;
    if (this.shellKey !== `${shop.name}|${shop.originX}|${shop.sizeId}|${shop.lotRows}`) this.buildShell(shop);
    for (const s of this.sides) {
      const facing = cameraYaw !== null && s.nx * Math.sin(cameraYaw) + s.nz * Math.cos(cameraYaw) > 0.25;
      s.full.visible = !facing; s.ledge.visible = facing;
      for (const m of s.extraFull) m.visible = !facing;
    }
    if (shop.layoutVersion !== this.layoutVersion) { this.rebuildFixtures(shop); this.layoutVersion = shop.layoutVersion; this.stockKey = ''; }
    const key = stockKey(shop);
    if (key !== this.stockKey) { this.rebuildProducts(shop); this.rebuildBoxes(shop); this.stockKey = key; }
    const n = Math.min(8, shop.litter.length);
    for (let i = 0; i < n; i++) { const l = shop.litter[i]!; this.dummy.position.set(l.x, 0.032, l.z); this.dummy.rotation.set(0, 0, 0); this.dummy.scale.set(1 + (l.id % 3) * 0.2, 1, 1); this.dummy.updateMatrix(); this.spills.setMatrixAt(i, this.dummy.matrix); }
    this.spills.count = n; this.spills.instanceMatrix.needsUpdate = true;
  }

  private fixtureMatrix(shop: Shop, f: Fixture, out: Matrix4, yOffset = 0, modelOffset = false): Matrix4 {
    const yaw = f.rot * Math.PI / 2;
    const dz = modelOffset ? (MODEL_OFFSET[f.type] ?? 0) : 0;
    this.dummy.position.set(shop.originX + f.x + 0.5 + Math.sin(yaw) * dz, yOffset, shop.originZ + f.z + 0.5 + Math.cos(yaw) * dz);
    this.dummy.rotation.set(0, yaw, 0);
    this.dummy.scale.set(1, 1, 1);
    this.dummy.updateMatrix();
    out.copy(this.dummy.matrix);
    return out;
  }

  private rebuildFixtures(shop: Shop): void {
    for (const { mesh } of this.fixtureMeshes.values()) { this.group.remove(mesh); mesh.dispose(); }
    this.fixtureMeshes.clear();
    const byModel = new Map<string, Fixture[]>();
    for (const f of shop.fixtures) { const id = f.type === 'fridge' ? 'chiller' : FIXTURE_MODEL[f.type]; const arr = byModel.get(id) ?? []; arr.push(f); byModel.set(id, arr); }
    const m = new Matrix4();
    for (const [model, list] of byModel) {
      const stack = model === 'market/shopping-basket' ? 3 : 1;
      const geo = model === 'chiller' ? this.chillerGeo! : this.assets.geometry(model);
      const mesh = new InstancedMesh(geo, this.assets.material, list.length * stack);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const ids: number[] = [];
      list.forEach((f, i) => { for (let s = 0; s < stack; s++) { mesh.setMatrixAt(i * stack + s, this.fixtureMatrix(shop, f, m, s * 0.09, true)); ids.push(f.id); } });
      mesh.userData.fixtureIds = ids;
      this.group.add(mesh);
      this.fixtureMeshes.set(model, { mesh, ids });
      const glass = model === 'chiller' ? null : this.assets.glassGeometry(model);
      if (glass) {
        const gm = new InstancedMesh(glass, this.assets.glass, list.length);
        list.forEach((f, i) => gm.setMatrixAt(i, this.fixtureMatrix(shop, f, m, 0, true)));
        this.group.add(gm);
        this.fixtureMeshes.set(model + ':glass', { mesh: gm, ids: [] });
      }
    }
    let wi = 0;
    for (const f of shop.fixtures) if (f.type === 'fridge') { this.wells.setMatrixAt(wi++, this.fixtureMatrix(shop, f, m, 0, true)); }
    this.wells.count = wi; this.wells.instanceMatrix.needsUpdate = true;
  }

  /** Stock: each slot's units laid out in a grid that fits the slot box, scaled down if needed, so nothing clips. */
  private rebuildProducts(shop: Shop): void {
    const counts = new Map<string, number>();
    const m = new Matrix4();
    let stickerI = 0;
    for (const f of shop.fixtures) {
      const cap = FIXTURES[f.type].capacity;
      this.fixtureMatrix(shop, f, m, 0, true);
      if (f.type === 'freezer') {
        // Tall fridge: opaque doors, so a coloured label per stocked product on the door.
        f.slots.forEach((sl, i) => {
          if (!sl.productId || sl.qty <= 0 || stickerI >= 48) return;
          const def = PRODUCTS.find((p) => p.id === sl.productId)!;
          this.dummy.position.set(-0.22 + i * 0.44, 0.6, 0.01).applyMatrix4(m);
          this.dummy.rotation.set(0, f.rot * Math.PI / 2, 0); this.dummy.scale.set(1, 1, 1); this.dummy.updateMatrix();
          this.stickers.setMatrixAt(stickerI, this.dummy.matrix); this.stickers.setColorAt(stickerI, this.color.set(def.color)); stickerI++;
        });
        continue;
      }
      const boxes = SLOT_BOXES[f.type];
      if (!boxes) continue;
      f.slots.forEach((sl, si) => {
        const b = boxes[si];
        if (!b || !sl.productId || sl.qty <= 0) return;
        const pm = this.productMeshes.get(sl.productId);
        if (!pm) return;
        this.layoutSlot(b, Math.min(sl.qty, cap), cap, pm, m, (mat) => {
          const i = counts.get(sl.productId!) ?? 0;
          if (i >= 64) return;
          pm.mesh.setMatrixAt(i, mat);
          counts.set(sl.productId!, i + 1);
        }, f.id * 7 + si);
      });
    }
    for (const [id, pm] of this.productMeshes) {
      const c = counts.get(id) ?? 0;
      pm.mesh.count = c; pm.mesh.visible = c > 0; pm.mesh.instanceMatrix.needsUpdate = true;
    }
    this.stickers.count = stickerI; this.stickers.instanceMatrix.needsUpdate = true;
    if (this.stickers.instanceColor) this.stickers.instanceColor.needsUpdate = true;
  }

  private layoutSlot(b: SlotBox, n: number, cap: number, pm: { w: number; h: number; d: number; minY: number }, fixtureM: Matrix4, emit: (m: Matrix4) => void, seed: number): void {
    const W = b.x1 - b.x0, D = b.z1 - b.z0;
    const across = Math.max(1, Math.min(cap, Math.round(Math.sqrt((cap * W) / D))));
    const deep = Math.ceil(cap / across);
    const cw = W / across, cd = D / deep;
    const s = Math.min(1.2, (0.9 * cw) / pm.w, (0.9 * cd) / pm.d, (0.95 * b.h) / pm.h);
    for (let i = 0; i < n; i++) {
      // Fill front rows first, so a half-full shelf still faces the aisle.
      const row = Math.floor(i / across), col = i % across;
      const lx = b.x0 + (col + 0.5) * cw;
      const lz = b.back ? b.z0 + (row + 0.5) * cd : b.z1 - (row + 0.5) * cd;
      this.dummy.position.set(lx, b.y - pm.minY * s, lz).applyMatrix4(fixtureM);
      const wobble = (((seed + i * 13) % 7) - 3) * 0.03;
      const yaw = Math.atan2(fixtureM.elements[8]!, fixtureM.elements[10]!);
      this.dummy.rotation.set(0, yaw + (b.back ? Math.PI : 0) + wobble, 0);
      this.dummy.scale.set(s, s, s);
      this.dummy.updateMatrix();
      emit(this.tmpM.copy(this.dummy.matrix));
    }
  }

  private rebuildBoxes(shop: Shop): void {
    const units = shop.storage.reduce((a, e) => a + e.qty, 0);
    const n = Math.min(72, Math.ceil(units / 4));
    const d = shop.delivery;
    const ox = shop.originX, oz = shop.originZ;
    const cols = Math.max(1, Math.floor((d.x1 - d.x0 - 0.2) / 0.3)), rows = Math.max(1, Math.floor((d.z1 - d.z0 - 0.2) / 0.3));
    for (let i = 0; i < n; i++) {
      const layer = Math.floor(i / (cols * rows));
      const j = i % (cols * rows);
      const col = j % cols, row = Math.floor(j / cols);
      this.dummy.position.set(ox + d.x0 + 0.25 + col * 0.3, 0.075 + layer * 0.34, oz + d.z0 + 0.25 + row * 0.3);
      this.dummy.rotation.set(0, ((i * 13) % 7 - 3) * 0.04, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.boxes.setMatrixAt(i, this.dummy.matrix);
    }
    this.boxes.count = n; this.boxes.instanceMatrix.needsUpdate = true;
  }

  /** Build-mode ghost: green when it can go there, red when it cannot. */
  setGhost(type: FixtureType | null, shop: Shop, x: number, z: number, rot: Rot, valid: boolean): void {
    if (!type) { if (this.ghost) this.ghost.visible = false; return; }
    const geo = type === 'fridge' && this.chillerGeo ? this.chillerGeo : this.assets.geometry(FIXTURE_MODEL[type]);
    if (!this.ghost) { this.ghost = new Mesh(geo, this.ghostMat); this.group.add(this.ghost); }
    this.ghost.geometry = geo;
    this.ghost.visible = true;
    this.ghostMat.color.set(valid ? '#3FA87A' : '#E8573F');
    const yaw = rot * Math.PI / 2; const dz = MODEL_OFFSET[type] ?? 0;
    this.ghost.position.set(shop.originX + x + 0.5 + Math.sin(yaw) * dz, 0.02, shop.originZ + z + 0.5 + Math.cos(yaw) * dz);
    this.ghost.rotation.set(0, yaw, 0);
  }

  debugFixtures(): unknown { return [...this.fixtureMeshes.entries()].map(([k, v]) => ({ model: k, count: v.mesh.count, ids: v.ids })); }

  /** Raycast fixtures, then the delivery boxes, then the floor. */
  pick(ray: Raycaster, shop: Shop): StoreHit | null {
    const meshes = [...this.fixtureMeshes.values()].filter((e) => e.ids.length).map((e) => e.mesh);
    const hits = ray.intersectObjects(meshes, false);
    const boxHit = ray.ray.intersectBox(this.deliveryBox, new Vector3());
    const boxDist = boxHit ? boxHit.distanceTo(ray.ray.origin) : Infinity;
    if (hits.length && hits[0]!.distance < boxDist) {
      const h = hits[0]!;
      const ids = (h.object as InstancedMesh).userData.fixtureIds as number[];
      const f = shop.fixtures.find((x) => x.id === ids[h.instanceId ?? 0]);
      if (f) return { kind: 'fixture', id: f.id, type: f.type, dist: h.distance };
    }
    if (boxHit && shop.storage.length) return { kind: 'delivery', dist: boxDist };
    const t = -ray.ray.origin.y / ray.ray.direction.y;
    if (t > 0) { const p = new Vector3().copy(ray.ray.origin).addScaledVector(ray.ray.direction, t); return { kind: 'floor', x: p.x, z: p.z, dist: t }; }
    return null;
  }
}

function stockKey(shop: Shop): string {
  let k = `${shop.layoutVersion}|`;
  for (const f of shop.fixtures) for (const s of f.slots) k += `${s.productId ?? '-'}:${s.qty},`;
  k += '|' + shop.storage.reduce((a, e) => a + e.qty, 0);
  return k;
}

export { mergeGeometries, paint };
