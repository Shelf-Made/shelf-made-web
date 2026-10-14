import { Group, Mesh, InstancedMesh, Object3D, Matrix4, Color, CircleGeometry, MeshBasicMaterial, MeshStandardMaterial, Vector3, Box3, PointLight, type BufferGeometry, type Raycaster } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BufferGeometry as BoxGeometryEmpty, Float32BufferAttribute } from 'three';
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import type { AssetLibrary } from './assets';
import type { GameState, Shop, Fixture, FixtureType, Rot } from '@/sim/types';
import { PRODUCTS } from '@/sim/products';
import { FIXTURES, lotLayout, WALL_T, PLOT_RECT, ROAD_Z, toLocal, rectToWorld } from '@/sim/layout';

/** The z of a north corner's shop origin: frontage maths is done as if every shop faced south. */
const NORTH_Z = -1.6;
import { MAIN_N, PAVEMENT } from './town';
import { box, merge, paint, place } from './geometry';
import { recolor, cutDown, dropTriangles, paintStrips } from './recolor';
import { FIXTURE_MODEL, MODEL_OFFSET, SLOT_BOXES, productGeometry, productModelIds, WALL_COLOURS, FIXTURE_PAINT, LINO, WALL_BANDS, SKIRTING, RAIL, type SlotBox } from './storeArt';
import { schemeById, type Scheme } from '@/sim/schemes';
import { WINDOW_GLOW, SPILL, spillGeometry } from './glow';
import { BlobShadows } from './blobs';
import { cornerProps } from './dressing';
import { PROP_MODELS, posterGeometry, buntingGeometry } from './props';

const SLATE = '#38383D', CREAM = '#FFF3DC', YELLOW = '#FFC044';
const LEDGE = 0.3;

export const STORE_MODELS = [...new Set(Object.values(FIXTURE_MODEL))].concat(['market/wall', 'market/wall-window', 'market/wall-door', 'furniture/cardboard-box-closed', ...productModelIds(), ...PROP_MODELS]);

export type StoreHit = { kind: 'fixture'; id: number; type: FixtureType; dist: number } | { kind: 'delivery'; dist: number } | { kind: 'floor'; x: number; z: number; dist: number };

interface Side { full: Mesh; ledge: Mesh; nx: number; nz: number; extraFull: Mesh[] }

/** The player's store: shell (Kenney walls, concrete floor, doors, sign), fixtures, stock, delivered boxes. */
export class StoreView {
  readonly group = new Group();
  /** Everything is built shop-relative under this root, which carries the shop's frame (south corners are turned half round). */
  private root = new Group();
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
  private roof: Mesh | null = null;
  /** The shop's colours (from its scheme): awning, fascia, pylon, the walls inside. */
  private scheme: Scheme = schemeById(undefined);
  private painted = new Map<string, BufferGeometry>();
  /** Soft contact shadows under every fixture (shop-relative). */
  private fixtureBlobs: BlobShadows | null = null;

  constructor(private readonly assets: AssetLibrary) {
    this.group.add(this.root);
    this.root.add(this.shell);
    this.ghostMat = new MeshStandardMaterial({ color: new Color('#3FA87A'), transparent: true, opacity: 0.55, depthWrite: false, roughness: 1 });
    this.wellMat = new MeshBasicMaterial({ color: new Color('#BFEFFF') });
    this.spillMat = new MeshBasicMaterial({ color: new Color('#9FD3F0'), transparent: true, opacity: 0.7, depthWrite: false });
    this.nightLight = new PointLight(0xffd9a0, 0, 9, 1.6);
    this.root.add(this.nightLight);
  }

  async init(): Promise<void> {
    const pal = this.assets.palette;
    for (const p of PRODUCTS) {
      const geo = productGeometry(this.assets, p.id);
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      const mesh = new InstancedMesh(geo, this.assets.material, 64);
      mesh.count = 0; mesh.castShadow = true; mesh.frustumCulled = false; mesh.visible = false;
      this.root.add(mesh);
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
    this.root.add(this.boxes, this.spills, this.wells, this.stickers);
    try { this.font = await new FontLoader().loadAsync('/fonts/fredoka-bold.typeface.json'); } catch { this.font = null; }
  }

  setNight(on: boolean): void { this.night = on; this.nightLight.intensity = on ? 2.2 : 0; if (this.nightGlow) this.nightGlow.visible = on; }
  private night = false;
  private bunting: Mesh | null = null;
  /** Lit windows, the strip light under the fascia and the pool of light on the apron, shown at night. */
  private nightGlow: Group | null = null;

  /** The roof: off whenever you are inside (so the camera sees the floor), on from outside once pulled back. */
  setRoof(on: boolean): void { if (this.roof) this.roof.visible = on; }

  /** Chunky rounded letters from Fredoka Bold: cream faces, sunny-yellow sides (or any two colours). */
  /** Extruded lettering in two colours. `bevel` rounds the edges (the shop's own fascia); signs seen from afar go without, at a tenth of the triangles. */
  letters(text: string, size: number, depth: number, face = CREAM, sideHex = YELLOW, bevel = true): BufferGeometry {
    const pal = this.assets.palette;
    if (!this.font) return new Mesh().geometry;
    const g = bevel
      ? new TextGeometry(text, { font: this.font, size, depth, curveSegments: 5, bevelEnabled: true, bevelThickness: depth * 0.25, bevelSize: size * 0.03, bevelSegments: 2 })
      : new TextGeometry(text, { font: this.font, size, depth, curveSegments: 2, bevelEnabled: false });
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, 0);
    // Paint by group: 0 = front/back faces, 1 = sides.
    const n = g.getAttribute('position').count;
    const uv = new Float32Array(n * 2);
    const [fu, fv] = pal.uv(face), [su, sv] = pal.uv(sideHex);
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
    // Built shop-relative; the root carries the frame.
    const ox = 0, oz = 0;
    this.root.position.set(shop.originX, 0, shop.originZ);
    this.root.rotation.set(0, shop.flip ? Math.PI : 0, 0);
    this.root.updateMatrixWorld(true);
    const backZ = Math.min(f.z0, shop.storeroom.z0);
    this.shellKey = shellKeyOf(shop);
    const sc = this.scheme = schemeById(shop.scheme);
    this.painted.clear();

    // ---- Floor: warm checker lino, a tile a square, with fine joints between; then the lot paving outside.
    const floorParts: BufferGeometry[] = [];
    const W = f.x1 - f.x0, D = f.z1 - backZ, cx0 = ox + (f.x0 + f.x1) / 2, cz0 = oz + (backZ + f.z1) / 2;
    floorParts.push(box(pal, LINO.joint, W, 0.052, D, cx0, -0.04, cz0));
    for (let x = f.x0; x < f.x1 - 0.01; x++) for (let z = backZ; z < f.z1 - 0.01; z++) {
      const odd = (Math.round(x - f.x0) + Math.round(z - backZ)) % 2 === 1;
      floorParts.push(box(pal, odd ? LINO.b : LINO.a, 0.975, 0.003, 0.975, ox + x + 0.5, 0.011, oz + z + 0.5));
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
    { const w = rectToWorld(shop, d); this.deliveryBox.set(new Vector3(w.x0, 0, w.z0), new Vector3(w.x1, 1.0, w.z1)); }
    // Lot: apron, walkway, aisle, bays, driveway, service lane, back yard; then the frontage sidewalk.
    const L = lotLayout(shop);
    const slab = (r: { x0: number; z0: number; x1: number; z1: number }, hex: string, h = 0.03, y = -0.012) =>
      floorParts.push(box(pal, hex, r.x1 - r.x0, h, r.z1 - r.z0, ox + (r.x0 + r.x1) / 2, y, oz + (r.z0 + r.z1) / 2));
    const swIn = MAIN_N[0] - NORTH_Z, swOut = MAIN_N[1] - NORTH_Z, kerb = ROAD_Z - 1.0 - NORTH_Z;
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
    // Outside: white, with the stripe in the shop's colour. Inside: painted bands (see paintPanels).
    const outside = (id: string) => paintStrips(recolor(this.assets.geometry(id), WALL_COLOURS), pal, { '2:1': sc.primary });
    const wallG = outside('market/wall');
    const windowG = outside('market/wall-window');
    const doorG = outside('market/wall-door');
    const windowGlass = this.assets.glassGeometry('market/wall-window');
    let pane: { x0: number; x1: number; y0: number; y1: number; z1: number } | null = null;
    if (windowGlass) { windowGlass.computeBoundingBox(); const b = windowGlass.boundingBox!; pane = { x0: b.min.x, x1: b.max.x, y0: b.min.y, y1: b.max.y, z1: b.max.z }; }
    const posters: BufferGeometry[] = [];
    const glassParts: BufferGeometry[] = [], litPanes: BufferGeometry[] = [];
    const side = (tiles: number[], line: number, axis: 'x' | 'z', outward: number, yaw: number, doorAt: number | null, windows: boolean) => {
      const full: BufferGeometry[] = [], ledge: BufferGeometry[] = [];
      // The inside face of the wall pieces sits 0.05 inside the floor edge; the paint goes just in front of it.
      const lo = (axis === 'x' ? f.x0 : backZ) + 0.12, hi = (axis === 'x' ? f.x1 : f.z1) - 0.12;
      for (const t of tiles) {
        const isDoor = doorAt !== null && Math.abs(t - doorAt) < 0.01;
        const isWindow = windows && !isDoor && Math.abs(t - (doorAt ?? 99)) > 0.6;
        const src = isDoor ? doorG : isWindow ? windowG : wallG;
        const px = axis === 'x' ? ox + t : ox + line + outward * WALL_T / 2;
        const pz = axis === 'x' ? oz + line + outward * WALL_T / 2 : oz + t;
        full.push(place(src.clone(), px, 0, pz, yaw));
        ledge.push(place(isDoor ? src.clone() : cutDown(src, LEDGE), px, 0, pz, yaw));
        if (isWindow && windowGlass) glassParts.push(place(windowGlass.clone(), px, 0, pz, yaw));
        // Offers in every other front window, on the outside of the glass.
        if (isWindow && pane && axis === 'x' && outward > 0 && Math.round(t - f.x0 - 0.5) % 2 === 0) posters.push(place(posterGeometry(pal, sc.primary, sc.accent, sc.trim), px + (t < shop.door.x ? 0.12 : -0.12), pane.y0 + 0.02, line + WALL_T / 2 + pane.z1 + 0.006));
        if (isWindow && pane && axis === 'x' && outward > 0) litPanes.push(box(pal, '#FFE6A8', pane.x1 - pane.x0 - 0.02, pane.y1 - pane.y0 - 0.02, 0.01, px + (pane.x0 + pane.x1) / 2, pane.y0 + 0.01, line + 0.08));
        if (!isDoor) {
          const a = Math.max(t - 0.5, lo), b = Math.min(t + 0.5, hi);
          const hole = isWindow && pane ? { a: t + pane.x0, b: t + pane.x1, y0: pane.y0, y1: pane.y1 } : null;
          full.push(...this.paintPanels(line - outward * 0.062, axis, a, b, 1, hole));
          ledge.push(...this.paintPanels(line - outward * 0.062, axis, a, b, LEDGE, hole));
        }
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
    if (posters.length) { const pm = new Mesh(merge(posters), this.assets.material); this.shell.add(pm); front.extraFull.push(pm); }

    // ---- Front: striped awning over the windows, the name on a fascia, and a pylon by the road.
    const width = f.x1 - f.x0;
    const fz = oz + f.z1 + WALL_T + 0.02;
    const awning: BufferGeometry[] = [];
    let k = 0;
    for (let x = ox + f.x0; x < ox + f.x1 - 0.01; x += 0.25, k++) {
      if (Math.abs(x + 0.125 - (ox + shop.door.x)) < 0.55) continue;
      const g = box(pal, k % 2 ? sc.accent : sc.primary, 0.25, 0.035, 0.42, 0, 0, 0);
      g.rotateX(0.42);
      g.translate(x + 0.125, 0.86, fz + 0.18);
      awning.push(g);
    }
    awning.push(box(pal, sc.dark, width, 0.05, 0.06, ox + (f.x0 + f.x1) / 2, 0.98, fz + 0.01));
    const awningMesh = new Mesh(merge(awning), this.assets.material);
    awningMesh.castShadow = true;
    this.shell.add(awningMesh);
    front.extraFull.push(awningMesh);
    const name = shop.name;
    const fascia: BufferGeometry[] = [];
    const size = Math.min(0.3, (width - 0.6) / Math.max(1, this.textWidth(name, 1)));
    fascia.push(box(pal, sc.primary, width + 0.5, 0.5, 0.1, ox + (f.x0 + f.x1) / 2, 1.0, fz - 0.02));
    fascia.push(box(pal, sc.dark, width + 0.54, 0.05, 0.14, ox + (f.x0 + f.x1) / 2, 1.48, fz - 0.02));
    const fl = this.letters(name, size, 0.05, CREAM, sc.trim);
    fascia.push(place(fl, ox + (f.x0 + f.x1) / 2, 1.25 - size * 0.4, fz + 0.04));
    fascia.push(...this.bracket(ox + (f.x0 + f.x1) / 2, 1.06, fz + 0.04, Math.min(width - 0.3, this.textWidth(name, size) + 0.2)));
    const fasciaMesh = new Mesh(merge(fascia), this.assets.material);
    fasciaMesh.castShadow = true;
    this.shell.add(fasciaMesh);
    // The fascia stays up whatever the cut-away does: the shop keeps its name.
    // Pylon sign on the lawn by the sidewalk, readable from the street in both directions.
    const px = ox - L.halfW - 0.6, pz = oz + 1.85;
    const boardW = 2.6;
    const psize = Math.min(0.26, (boardW - 0.35) / Math.max(1, this.textWidth(name, 1)));
    const pylon: BufferGeometry[] = [
      box(pal, SLATE, 0.12, 1.5, 0.12, px - boardW / 2 + 0.2, 0, pz), box(pal, SLATE, 0.12, 1.5, 0.12, px + boardW / 2 - 0.2, 0, pz),
      box(pal, sc.primary, boardW, 0.55, 0.12, px, 1.0, pz), box(pal, sc.dark, boardW + 0.06, 0.05, 0.16, px, 1.55, pz),
    ];
    for (const yaw of [0, Math.PI]) {
      const zOff = yaw === 0 ? 0.07 : -0.07;
      pylon.push(place(this.letters(name, psize, 0.04, CREAM, sc.trim, false), px, 1.24 - psize * 0.4, pz + zOff, yaw));
      pylon.push(...this.bracket(px, 1.07, pz + zOff, Math.min(boardW - 0.3, this.textWidth(name, psize) + 0.16), yaw));
    }
    const pylonMesh = new Mesh(merge(pylon), this.assets.material);
    pylonMesh.castShadow = true;
    this.shell.add(pylonMesh);
    // Roof: a flat deck with a parapet in the shop's green, worn when you are outside and pulled back.
    { const W = f.x1 - f.x0 + 2 * WALL_T, D = f.z1 - backZ + 2 * WALL_T, cx = (f.x0 + f.x1) / 2, cz = (f.z1 + backZ) / 2;
      const roof = [box(pal, '#9AA0A8', W, 0.06, D, cx, 1.0, cz), box(pal, sc.primary, W + 0.06, 0.12, 0.08, cx, 1.0, f.z1 + WALL_T), box(pal, sc.primary, W + 0.06, 0.12, 0.08, cx, 1.0, backZ - WALL_T),
        box(pal, sc.primary, 0.08, 0.12, D, f.x0 - WALL_T, 1.0, cz), box(pal, sc.primary, 0.08, 0.12, D, f.x1 + WALL_T, 1.0, cz), box(pal, '#B9BCC4', 0.6, 0.3, 0.5, cx - W / 4, 1.06, cz - D / 5)];
      this.roof = new Mesh(merge(roof), this.assets.material);
      this.roof.castShadow = true; this.roof.visible = false;
      this.shell.add(this.roof); }
    this.nightLight.position.set(ox + (f.x0 + f.x1) / 2, 0.95, oz + (backZ + f.z1) / 2);
    // Opening day: bunting in the shop's colours across the front.
    this.bunting = new Mesh(buntingGeometry(pal, width + 0.6, [sc.primary, sc.accent, sc.trim]).translate(ox + f.x0 - 0.3, 0.97, fz + 0.48), this.assets.material);
    this.bunting.visible = false;
    this.shell.add(this.bunting);
    // Night: the windows glow from inside, a strip light under the fascia, and light spills out over the apron.
    { const g = new Group();
      if (litPanes.length) g.add(new Mesh(merge(litPanes), WINDOW_GLOW));
      g.add(new Mesh(box(pal, '#FFE6A8', width + 0.3, 0.025, 0.03, ox + (f.x0 + f.x1) / 2, 0.735, fz + 0.03), WINDOW_GLOW));
      const pool = new Mesh(mergeGeometries([spillGeometry(width * 0.6, 1.4, ox + (f.x0 + f.x1) / 2, 0.035, fz + 1.1), spillGeometry(0.9, 0.7, ox + shop.door.x, 0.036, fz + 0.45, 0.7)]), SPILL);
      pool.renderOrder = 1;
      g.add(pool);
      g.visible = this.night;
      this.nightGlow = g;
      this.shell.add(g); }
    this.layoutVersion = -1;
    this.stockKey = '';
  }

  /**
   * Garden on the parts of the plot the shop and its lot do not use: trees, bushes and flowers on a
   * loose grid, never on paving. A bench and a bin by the door, a dumpster in the yard.
   */
  private dressLot(shop: Shop, parts: BufferGeometry[]): void {
    const L = lotLayout(shop);
    const f = shop.floor, ox = 0, oz = 0;
    const backZ = Math.min(f.z0, shop.storeroom.z0);
    const used = [
      { x0: f.x0 - WALL_T, z0: backZ - WALL_T, x1: f.x1 + WALL_T, z1: f.z1 + WALL_T }, L.apron, L.aisle, L.driveway, L.serviceLane, L.backYard,
      { x0: L.walkwayX - 0.5, z0: L.apron.z1, x1: L.walkwayX + 0.5, z1: 3 },
      { x0: -L.halfW - 2.0, z0: 0, x1: -L.halfW + 0.8, z1: 1.2 }, // pylon sign
      ...L.bays.map((b) => ({ x0: b.x - 0.9, z0: b.z - 0.6, x1: b.x + 0.9, z1: b.z + 0.6 })),
    ];
    // Street props first (more as the shop grows), on the lawn beside the paths; then the garden round them.
    const tier = shop.sizeId === 'large' ? 2 : shop.sizeId === 'medium' ? 1 : 0;
    const props = cornerProps(shop, tier, { trolleys: shop.lotRows >= 2 });
    for (const pr of props) parts.push(this.placed(pr.model, ox + pr.x, oz + pr.z, pr.yaw, pr.scale ?? 1));
    const free = (x: number, z: number, m: number) => !used.some((r) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m) && !props.some((pr) => Math.hypot(pr.x - x, pr.z - z) < pr.r + m);
    const swIn = MAIN_N[0] - NORTH_Z;
    const trees = ['nature/tree-oak', 'nature/tree-default', 'nature/tree-detailed', 'suburban/tree-small'];
    const bushes = ['nature/plant-bush', 'nature/plant-bushdetailed', 'nature/plant-bushsmall'];
    const flowers = ['nature/flower-reda', 'nature/flower-yellowa', 'nature/flower-purplea'];
    for (let z = PLOT_RECT.z0 + 1.1; z < swIn - 0.5; z += 1.0) for (let x = PLOT_RECT.x0 + 1.1; x < PLOT_RECT.x1 - 0.9; x += 1.0) {
      const k = (Math.round(x * 2) * 7 + Math.round(z * 2) * 13) & 15;
      if (k === 0 && free(x, z, 1.1)) parts.push(this.placed(trees[(Math.round(x) + Math.round(z)) & 3]!, ox + x, oz + z, x * 1.7, 0.95));
      else if ((k === 5 || k === 11) && free(x, z, 0.5)) parts.push(this.placed(bushes[Math.abs(Math.round(x * 3)) % 3]!, ox + x, oz + z, z * 2.1, 1));
      else if (k === 8 && free(x, z, 0.4)) for (let i = 0; i < 3; i++) parts.push(this.placed(flowers[i]!, ox + x + (i - 1) * 0.28, oz + z + (i % 2) * 0.2, i, 1));
    }
  }

  private placed(id: string, x: number, z: number, yaw: number, s: number): BufferGeometry {
    if (!this.assets.has(id)) return new BoxGeometryEmpty();
    const g = this.assets.geometry(id).clone();
    g.scale(s, s, s); g.rotateY(yaw); g.translate(x, 0, z);
    return g;
  }

  /** The wordmark's shelf-bracket underline: a bar with two little brackets, in the trim colour. */
  private bracket(x: number, y: number, z: number, w: number, yaw = 0): BufferGeometry[] {
    const pal = this.assets.palette, c = this.scheme.trim;
    const g = [box(pal, c, w, 0.035, 0.04, 0, 0, 0), box(pal, c, 0.035, 0.07, 0.04, -w / 2 + 0.06, -0.07, 0), box(pal, c, 0.035, 0.07, 0.04, w / 2 - 0.06, -0.07, 0)];
    return g.map((p) => place(p, x, y, z, yaw));
  }

  /**
   * Paint on the inside of one wall tile, as thin boards just in front of the wall: a wooden skirting,
   * the shop's colour to waist height, a cream rail, a pale tint above. Cut to `top` (the ledge when
   * the wall is cut away) and around a window's pane.
   */
  private paintPanels(plane: number, axis: 'x' | 'z', a: number, b: number, top: number, hole: { a: number; b: number; y0: number; y1: number } | null): BufferGeometry[] {
    const pal = this.assets.palette, sc = this.scheme, out: BufferGeometry[] = [];
    const bands: [readonly [number, number], string][] = [[WALL_BANDS.skirting, SKIRTING], [WALL_BANDS.lower, sc.primary], [WALL_BANDS.rail, RAIL], [WALL_BANDS.upper, sc.light]];
    const piece = (u0: number, u1: number, y0: number, y1: number, hex: string) => {
      if (u1 - u0 < 0.01 || y1 - y0 < 0.005) return;
      const c = (u0 + u1) / 2, len = u1 - u0, deep = hex === SKIRTING ? 0.03 : 0.02;
      out.push(axis === 'x' ? box(pal, hex, len, y1 - y0, deep, c, y0, plane) : box(pal, hex, deep, y1 - y0, len, plane, y0, c));
    };
    for (const [[y0, y1], hex] of bands) {
      const t0 = y0, t1 = Math.min(y1, top);
      if (t1 <= t0) continue;
      if (!hole || t1 <= hole.y0 || t0 >= hole.y1) { piece(a, b, t0, t1, hex); continue; }
      // Around the pane: below it, above it, and the piers either side.
      if (t0 < hole.y0) piece(a, b, t0, hole.y0, hex);
      if (t1 > hole.y1) piece(a, b, hole.y1, t1, hex);
      const m0 = Math.max(t0, hole.y0), m1 = Math.min(t1, hole.y1);
      piece(a, Math.max(a, hole.a), m0, m1, hex); piece(Math.min(b, hole.b), b, m0, m1, hex);
    }
    return out;
  }

  /** A fixture model painted for the warm shop (cached per model). */
  private fixtureGeometry(model: string): BufferGeometry {
    let g = this.painted.get(model);
    if (!g) {
      const src = model === 'chiller' ? this.chillerGeo! : this.assets.geometry(model);
      const map = FIXTURE_PAINT[model];
      g = map ? paintStrips(src, this.assets.palette, map) : src;
      this.painted.set(model, g);
    }
    return g;
  }

  /** Per frame: wall cut-down (cinematic camera only), fixtures, stock, boxes, spills. */
  update(state: GameState, cameraYaw: number | null): void {
    const shop = state.shop;
    if (this.shellKey !== shellKeyOf(shop)) { this.buildShell(shop); this.layoutVersion = -1; }
    const flip = shop.flip ? -1 : 1;
    for (const s of this.sides) {
      const facing = cameraYaw !== null && flip * (s.nx * Math.sin(cameraYaw) + s.nz * Math.cos(cameraYaw)) > 0.25;
      s.full.visible = !facing; s.ledge.visible = facing;
      for (const m of s.extraFull) m.visible = !facing;
    }
    if (this.bunting) this.bunting.visible = state.day === 1 && state.phase !== 'night' && state.phase !== 'picking';
    if (shop.layoutVersion !== this.layoutVersion) { this.rebuildFixtures(shop); this.layoutVersion = shop.layoutVersion; this.stockKey = ''; }
    const key = stockKey(shop);
    if (key !== this.stockKey) { this.rebuildProducts(shop); this.rebuildBoxes(shop); this.stockKey = key; }
    const n = Math.min(8, shop.litter.length);
    for (let i = 0; i < n; i++) { const l = shop.litter[i]!; const lp = toLocal(shop, l.x, l.z); this.dummy.position.set(lp.x, 0.032, lp.z); this.dummy.rotation.set(0, 0, 0); this.dummy.scale.set(1 + (l.id % 3) * 0.2, 1, 1); this.dummy.updateMatrix(); this.spills.setMatrixAt(i, this.dummy.matrix); }
    this.spills.count = n; this.spills.instanceMatrix.needsUpdate = true;
  }

  private fixtureMatrix(shop: Shop, f: Fixture, out: Matrix4, yOffset = 0, modelOffset = false): Matrix4 {
    const yaw = f.rot * Math.PI / 2;
    const dz = modelOffset ? (MODEL_OFFSET[f.type] ?? 0) : 0;
    this.dummy.position.set(f.x + 0.5 + Math.sin(yaw) * dz, yOffset, f.z + 0.5 + Math.cos(yaw) * dz);
    this.dummy.rotation.set(0, yaw, 0);
    this.dummy.scale.set(1, 1, 1);
    this.dummy.updateMatrix();
    out.copy(this.dummy.matrix);
    return out;
  }

  private rebuildFixtures(shop: Shop): void {
    for (const { mesh } of this.fixtureMeshes.values()) { this.root.remove(mesh); mesh.dispose(); }
    this.fixtureMeshes.clear();
    const byModel = new Map<string, Fixture[]>();
    for (const f of shop.fixtures) { const id = f.type === 'fridge' ? 'chiller' : FIXTURE_MODEL[f.type]; const arr = byModel.get(id) ?? []; arr.push(f); byModel.set(id, arr); }
    const m = new Matrix4();
    for (const [model, list] of byModel) {
      const stack = model === 'market/shopping-basket' ? 3 : 1;
      const mesh = new InstancedMesh(this.fixtureGeometry(model), this.assets.material, list.length * stack);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const ids: number[] = [];
      list.forEach((f, i) => { for (let s = 0; s < stack; s++) { mesh.setMatrixAt(i * stack + s, this.fixtureMatrix(shop, f, m, s * 0.09, true)); ids.push(f.id); } });
      mesh.userData.fixtureIds = ids;
      this.root.add(mesh);
      this.fixtureMeshes.set(model, { mesh, ids });
      const glass = model === 'chiller' ? null : this.assets.glassGeometry(model);
      if (glass) {
        const gm = new InstancedMesh(glass, this.assets.glass, list.length);
        list.forEach((f, i) => gm.setMatrixAt(i, this.fixtureMatrix(shop, f, m, 0, true)));
        this.root.add(gm);
        this.fixtureMeshes.set(model + ':glass', { mesh: gm, ids: [] });
      }
    }
    this.fixtureBlobs ??= new BlobShadows(this.root, 64, 0.32, 0.02);
    this.fixtureBlobs.begin();
    for (const f of shop.fixtures) { const along = f.rot % 2 === 0; this.fixtureBlobs.add(f.x + 0.5, f.z + 0.5, along ? 1.15 : 0.95, along ? 0.95 : 1.15); }
    this.fixtureBlobs.end();
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
    const ox = 0, oz = 0;
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
    if (!this.ghost) { this.ghost = new Mesh(geo, this.ghostMat); this.root.add(this.ghost); }
    this.ghost.geometry = geo;
    this.ghost.visible = true;
    this.ghostMat.color.set(valid ? '#3FA87A' : '#E8573F');
    const yaw = rot * Math.PI / 2; const dz = MODEL_OFFSET[type] ?? 0;
    this.ghost.position.set(x + 0.5 + Math.sin(yaw) * dz, 0.02, z + 0.5 + Math.cos(yaw) * dz);
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

function shellKeyOf(shop: Shop): string { return `${shop.name}|${shop.originX}|${shop.originZ}|${shop.sizeId}|${shop.lotRows}|${shop.scheme}`; }
