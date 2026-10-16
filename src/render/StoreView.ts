import { Group, Mesh, InstancedMesh, Object3D, Matrix4, Color, CircleGeometry, MeshBasicMaterial, MeshStandardMaterial, Vector3, Box3, PointLight, Sprite, SpriteMaterial, type BufferGeometry, type Raycaster } from 'three';
import { icon } from './Reactions';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BufferGeometry as BoxGeometryEmpty, Float32BufferAttribute } from 'three';
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import type { AssetLibrary } from './assets';
import type { GameState, Shop, Fixture, FixtureType, Rot } from '@/sim/types';
import { PRODUCTS } from '@/sim/products';
import { FIXTURES, lotLayout, WALL_T, PLOT_RECT, ROAD_Z, PALLET_UNITS, RACK_STANDS, toLocal, rectToWorld, isFloor, floorTileList, tileKey, wallKey, footprintOf, levelOf, levelOfZ, zOnLevel, groundZ, sinkWorld, storeysOf, rideEnds, VERTICAL, MAX_LEVELS, STOREY, type Rect } from '@/sim/layout';
import { standPoint } from '@/sim/lot';
import { doubleHeight } from '@/sim/storeys';
import { underFloors, spillMark } from './levels';

/** Pieces that stand free in the middle of their tile, and ones drawn where they hang or divide (see offsetOf). */
const CENTRED: ReadonlySet<FixtureType> = new Set<FixtureType>(['sign', 'plant', 'floorLamp', 'pendant', 'basketStack', 'speaker', 'bin', 'rug', 'doormat', 'pallet', 'cafe', 'wall', 'wallWindow', 'doorway', 'railing', 'gate', 'wallLight', 'neon', 'window', 'tallWall', 'stairs', 'escalator', 'elevator']);

/** Delivery boxes drawn at most (about four units each). */
const BOX_MAX = 220;

/** The z of a north corner's shop origin: frontage maths is done as if every shop faced south. */
const NORTH_Z = -1.6;
import { MAIN_N, PAVEMENT } from './town';
import { box, merge, paint, place } from './geometry';
import { recolor, cutDown, dropTriangles, paintStrips, pressUnder } from './recolor';
import { FIXTURE_MODEL, SLOT_BOXES, productGeometry, productModelIds, WALL_COLOURS, FIXTURE_PAINT, LINO, WALL_BANDS, SKIRTING, RAIL, type SlotBox } from './storeArt';
import { schemeById, type Scheme } from '@/sim/schemes';
import type { FloorStyle, WallStyle } from '@/sim/types';
import { WINDOW_GLOW, SIGN_GLOW, SPILL, LAMP_GLOW, spillGeometry } from './glow';
import { fittingGeometry, glowGeometry, windowGhost, FITTING_MODELS, WALL_PIECES, GONE_WITH_WALLS, LAMPS } from './fittings';
import { BlobShadows } from './blobs';
import { cornerProps, pylonSpot, cornerGarden } from './dressing';
import { tuftMesh } from './StaticWorld';
import { PROP_MODELS, posterGeometry, buntingGeometry, rideBikeGeometry } from './props';
import { textGeometry } from './letters';
import { BIKE_COLOURS } from './People';

const SLATE = '#38383D', CREAM = '#FFF3DC', YELLOW = '#FFC044';
const LEDGE = 0.3;

export const STORE_MODELS = [...new Set([...Object.values(FIXTURE_MODEL).filter((id) => !id.startsWith('gen:')), ...FITTING_MODELS])].concat(['market/wall', 'market/wall-window', 'market/wall-door', 'furniture/cardboard-box-closed', ...productModelIds(), ...PROP_MODELS]);

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
  /** A bubble with a drop in it, bobbing over each spill so it is easy to find (seen through anything, but a floor over it). */
  private spillMarks: Sprite[] = [];
  /** The bubble's look: over everything; and under the floor in view, hidden by it. */
  private spillMarkMats: SpriteMaterial[] = [];
  private wells!: InstancedMesh;
  private stickers!: InstancedMesh;
  private layoutVersion = -1;
  private stockKey = '';
  private shellKey = '';
  /** Changes whenever the shell is rebuilt (a new size, plot or layout of the lot): the lawn's grass follows it. */
  get layoutKey(): string { return this.shellKey; }
  private readonly dummy = new Object3D();
  private readonly tmpM = new Matrix4();
  private readonly color = new Color();
  private ghost: Mesh | null = null;
  private windowGhostGeo: BufferGeometry | null = null;
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
  private shopName = '';
  /** Bikes locked to the racks out on the lot, one mesh per frame colour. */
  private parked = new Map<string, InstancedMesh>();
  /** Soft contact shadows under every fixture (shop-relative). */
  private fixtureBlobs: BlobShadows | null = null;
  /** Each floor above the ground's floor, walls and railings (a double-height space's upper walls go with the floor below). */
  private levelGroups: Group[] = [];
  /** The floor in view: the ones above it are lifted off (null: the whole building, from outside). */
  private viewLevel: number | null = null;

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
      const mesh = new InstancedMesh(geo, this.assets.plainMaterial, 64);
      mesh.count = 0; mesh.castShadow = true; mesh.frustumCulled = false; mesh.visible = false;
      this.root.add(mesh);
      this.productMeshes.set(p.id, { mesh, w: b.max.x - b.min.x, h: b.max.y - b.min.y, d: b.max.z - b.min.z, minY: b.min.y });
    }
    const boxGeo = this.assets.geometry('furniture/cardboard-box-closed').clone().scale(1.5, 1.5, 1.5);
    this.boxes = new InstancedMesh(boxGeo, this.assets.material, BOX_MAX);
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

  /** The shop's ceiling lights on for a photo inside (null: back to day or night as it was). */
  setInteriorLight(intensity: number | null): void { this.nightLight.intensity = intensity ?? this.nightIntensity(); }
  setNight(on: boolean): void { this.night = on; this.nightLight.intensity = this.nightIntensity(); if (this.nightGlow) this.nightGlow.visible = on; this.showLamps(); }
  /** After dark the shop glows from inside, brighter for every lamp bought. */
  private nightIntensity(): number { return this.night ? 2.2 + 0.2 * Math.min(8, this.lampCount) : 0; }
  private lampCount = 0;
  /** The lamps' bulbs and their pools of light are on after dark; the neon all the time. */
  private showLamps(): void {
    for (const [type, mesh] of this.glows) mesh.visible = type === 'neon' || this.night;
    if (this.lampPools) this.lampPools.visible = this.night;
  }
  private readonly glows = new Map<FixtureType, InstancedMesh>();
  private lampPools: InstancedMesh | null = null;
  private wallCut: { full: InstancedMesh; cut: InstancedMesh }[] = [];
  private readonly neonMat = new MeshBasicMaterial({ color: new Color(2.6, 0.9, 1.8) });
  private night = false;
  private bunting: Mesh | null = null;
  /** Lit windows, the strip light under the fascia and the pool of light on the apron, shown at night. */
  private nightGlow: Group | null = null;

  /** Show the building up to floor `level` (null: all of it). Fixtures and stock are redrawn for it. */
  setViewLevel(level: number | null): void {
    if (level === this.viewLevel) return;
    this.viewLevel = level;
    this.showLevels();
    this.layoutVersion = -1; this.stockKey = '';
  }
  private showLevels(): void { this.levelGroups.forEach((g, L) => { if (g) g.visible = this.viewLevel === null || L <= this.viewLevel; }); }
  /** Is a piece on a floor in view? */
  private shown(f: Fixture): boolean { return this.viewLevel === null || FIXTURES[f.type].outdoor === true || levelOf(f) <= this.viewLevel; }

  /** The roof: off whenever you are inside (so the camera sees the floor), on from outside once pulled back; never over floors lifted off. */
  setRoof(on: boolean): void { if (this.roof) this.roof.visible = on && !this.levelGroups.some((g) => g && !g.visible && g.children.length > 0); }

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
    this.shopName = shop.name;
    this.painted.clear();

    // ---- Floor: warm checker lino, a tile a square, with fine joints between; then the lot paving outside.
    const floorParts: BufferGeometry[] = [];
    // Tile by tile, each in its own finish (laid a tile at a time), the joints showing between.
    for (const { x, z } of floorTileList(shop)) {
      const fin = floorPaint(shop.tileStyles?.[tileKey(x, z)] ?? shop.floorStyle ?? 'lino', sc);
      floorParts.push(box(pal, fin.joint, 1, 0.052, 1, ox + x + 0.5, -0.04, oz + z + 0.5));
      const i = Math.round(x - f.x0), j = Math.round(z - backZ);
      if (fin.boards) {
        // Boards: four to a tile, each its own shade of honey.
        for (let k = 0; k < 4; k++) floorParts.push(box(pal, fin.boards[(i * 7 + j * 3 + k * 5) % fin.boards.length]!, 0.985, 0.003, 0.235, ox + x + 0.5, 0.011, oz + z + 0.125 + k * 0.25));
        continue;
      }
      floorParts.push(box(pal, (i + j) % 2 === 1 ? fin.b : fin.a, fin.gap, 0.003, fin.gap, ox + x + 0.5, 0.011, oz + z + 0.5));
    }
    // Door thresholds: steel strips across each opening.
    floorParts.push(box(pal, '#9AA0A8', 1.2, 0.02, WALL_T, ox + shop.door.x, -0.008, oz + f.z1 + WALL_T / 2));
    floorParts.push(box(pal, '#9AA0A8', 1.2, 0.02, WALL_T, ox + shop.backDoor.x, -0.008, oz + shop.backDoor.z - WALL_T / 2));
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
    // Surfaces laid on the lot, tile by tile.
    for (const [k, sf] of Object.entries(shop.lotTiles ?? {})) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      const at = (dx: number, dz: number, w: number, d: number, hex: string, y = 0.019) => floorParts.push(box(pal, hex, w, 0.003, d, ox + x + dx, y, oz + z + dz));
      if (sf === 'asphalt') slab({ x0: x, z0: z, x1: x + 1, z1: z + 1 }, '#6E717C');
      else if (sf === 'paving') { slab({ x0: x, z0: z, x1: x + 1, z1: z + 1 }, '#B9BCC4'); for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) at(0.25 + i! * 0.5, 0.25 + j! * 0.5, 0.47, 0.47, PAVEMENT); }
      else if (sf === 'brick') {
        slab({ x0: x, z0: z, x1: x + 1, z1: z + 1 }, '#D8DADF');
        for (let row = 0; row < 8; row++) for (let c = -1; c < 4; c++) {
          const x0 = Math.max(0, c * 0.25 + (row % 2) * 0.125), x1 = Math.min(1, c * 0.25 + (row % 2) * 0.125 + 0.25);
          if (x1 - x0 > 0.03) at((x0 + x1) / 2, row * 0.125 + 0.0625, x1 - x0 - 0.018, 0.107, (row + c) % 3 === 0 ? '#A84E37' : '#B8573F');
        }
      } else {
        slab({ x0: x, z0: z, x1: x + 1, z1: z + 1 }, '#CFC3A6');
        for (let i = 0; i < 26; i++) { const h = Math.sin((x * 31 + z * 17 + i * 7.13) * 12.9898) * 43758.5453, u = h - Math.floor(h), v = (h * 7.31) - Math.floor(h * 7.31); at(0.05 + u * 0.9, 0.05 + v * 0.9, 0.035, 0.035, i % 2 ? '#B5A88A' : '#E3DAC4'); }
      }
    }
    // Sidewalk across the whole plot frontage, with dropped kerbs where the driveway and service lane cross it.
    const cuts = [[L.serviceLane.x0, L.serviceLane.x1], [L.driveway.x0, L.driveway.x1]].sort((a, b) => a[0]! - b[0]!);
    let sx = PLOT_RECT.x0;
    for (const [c0, c1] of cuts) { if (c0! > sx) slab({ x0: sx, z0: swIn, x1: c0!, z1: swOut }, PAVEMENT, 0.06, -0.012); sx = c1!; }
    slab({ x0: sx, z0: swIn, x1: PLOT_RECT.x1, z1: swOut }, PAVEMENT, 0.06, -0.012);
    for (const [c0, c1] of cuts) slab({ x0: c0!, z0: swIn, x1: c1!, z1: swOut }, '#B9BCC4', 0.034, -0.01);
    // A zebra across the driveway mouth: walkers have priority.
    // Painted like the street's zebras: slim bars along the traffic, in the same soft off-white.
    for (let x = L.driveway.x0 + 0.2; x + 0.15 <= L.driveway.x1 - 0.1; x += 0.3) floorParts.push(box(pal, '#D8DADF', 0.15, 0.004, swOut - swIn - 0.12, ox + x + 0.075, 0.026, oz + (swIn + swOut) / 2));
    this.dressLot(shop, floorParts);
    // The ground material: the lot and the pavement get wet in the rain (the shop floor is sheltered).
    const floorMesh = new Mesh(merge(floorParts), this.assets.ground);
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
    // Where the inside paint stops around a window: its pane, or (Kenney's glass is painted in the atlas) the frame set back in the wall.
    const opening = pane ?? recessOf(windowG);
    const posters: BufferGeometry[] = [];
    const litPanes: BufferGeometry[] = [];
    // Walls follow the floor's outline, a piece on every outside edge of a floor tile, gathered by the way
    // they face (so the cut-away drops the ones toward the camera). Each end of a run either turns a corner
    // of the room (the paint stops short of it), carries on, or meets a wall coming the other way round a
    // notch in the floor (the paint runs on to meet it; the piece along x stops short, the other covers the corner).
    type Dir = { name: 'front' | 'back' | 'left' | 'right'; nx: number; nz: number; axis: 'x' | 'z'; yaw: number };
    const DIRS: Dir[] = [
      { name: 'front', nx: 0, nz: 1, axis: 'x', yaw: 0 }, { name: 'back', nx: 0, nz: -1, axis: 'x', yaw: Math.PI },
      { name: 'left', nx: -1, nz: 0, axis: 'z', yaw: -Math.PI / 2 }, { name: 'right', nx: 1, nz: 0, axis: 'z', yaw: Math.PI / 2 },
    ];
    const tiles = floorTileList(shop);
    const at = (x: number, z: number) => isFloor(shop, x, z);
    // Floor by floor: the ground floor, every open floor above it, and over the floor below wherever a
    // panel was sold for a double-height space. Upstairs pieces are drawn with their floor's group, and
    // a double-height space's upper walls with the floor under them.
    const st = storeysOf(shop);
    for (const g of this.levelGroups) g?.removeFromParent();
    this.levelGroups = [];
    for (let L = 1; L < MAX_LEVELS; L++) { const g = new Group(); g.name = `floor-${L}`; this.levelGroups[L] = g; this.shell.add(g); }
    let front: Side | null = null;
    for (let L = 0; L < MAX_LEVELS; L++) {
      const inside = st.inside[L];
      if (!inside?.size) continue;
      const y0 = L * STOREY;
      const parent: Group = L === 0 ? this.shell : (st.built[L] ? this.levelGroups[L] : this.levelGroups[L - 1]) ?? this.shell;
      const tilesL = L === 0 ? tiles : [...inside].map((k) => { const [x, z] = k.split(',').map(Number) as [number, number]; return { x, z }; });
      const atL = L === 0 ? at : (x: number, z: number) => inside.has(tileKey(x, z));
      // Windows: the whole front line is glass; elsewhere wherever a Window was put in (keyed by the wall it is in).
      const wins = new Set(shop.fixtures.filter((fx) => fx.type === 'window' && levelOf(fx) === L).map((fx) => {
        // Its wall is behind it: facing +z (rot 0) it is in the back wall, and so on round.
        const r = fx.rot & 3, dir = r === 0 ? DIRS[1]! : r === 1 ? DIRS[2]! : r === 2 ? DIRS[0]! : DIRS[3]!;
        const gz = groundZ(fx.z);
        const line = dir.axis === 'x' ? (dir.nz > 0 ? gz + 1 : gz) : (dir.nx > 0 ? fx.x + 1 : fx.x);
        return `${dir.name}@${line}@${dir.axis === 'x' ? fx.x + 0.5 : gz + 0.5}`;
      }));
      for (const dir of DIRS) {
        const full: BufferGeometry[] = [], ledge: BufferGeometry[] = [], glass: BufferGeometry[] = [];
        const ax = dir.axis === 'x' ? 1 : 0, az = dir.axis === 'z' ? 1 : 0;
        for (const tile of tilesL) {
          if (atL(tile.x + dir.nx, tile.z + dir.nz)) continue;
          const line = dir.axis === 'x' ? (dir.nz > 0 ? tile.z + 1 : tile.z) : (dir.nx > 0 ? tile.x + 1 : tile.x);
          const t = dir.axis === 'x' ? tile.x + 0.5 : tile.z + 0.5;
          const outward = dir.axis === 'x' ? dir.nz : dir.nx;
          const isFront = dir.name === 'front' && line === f.z1;
          const isDoor = L === 0 && ((isFront && Math.abs(t - shop.door.x) < 0.01) || (dir.name === 'back' && line === shop.backDoor.z && Math.abs(t - shop.backDoor.x) < 0.01));
          const nearDoor = L === 0 && isFront && Math.abs(t - shop.door.x) <= 0.6;
          const isWindow = !isDoor && !nearDoor && (isFront || wins.has(`${dir.name}@${line}@${t}`));
          const src = isDoor ? doorG : isWindow ? windowG : wallG;
          // How each end of this piece meets its neighbours along the wall.
          const ends = [-1, 1].map((e) => {
            const nx = tile.x + ax * e, nz = tile.z + az * e;
            if (!atL(nx, nz)) return 'corner' as const;
            return atL(nx + dir.nx, nz + dir.nz) ? 'notch' as const : 'run' as const;
          });
          // Along x, a piece that meets a notch's wall gives way to it by half a tile at that end.
          const cutLo = dir.axis === 'x' && ends[0] === 'notch', cutHi = dir.axis === 'x' && ends[1] === 'notch';
          const len = 1 - (cutLo ? 0.5 : 0) - (cutHi ? 0.5 : 0), mid = t + (cutLo ? 0.25 : 0) - (cutHi ? 0.25 : 0);
          const px = dir.axis === 'x' ? ox + mid : ox + line + outward * WALL_T / 2;
          const pz = dir.axis === 'x' ? oz + line + outward * WALL_T / 2 : oz + mid;
          // A shortened piece is the plain wall (a window or door never sits by a notch's end).
          const piece = len < 1 ? wallG : src;
          full.push(place(piece.clone(), px, y0, pz, dir.yaw, len, 1, 1));
          // Cut down, a window is a plain wall: the opening starts below the ledge, and squashing its frame
          // and pane onto the cut left a jumble of colours fighting on the sill.
          ledge.push(place(isDoor ? src.clone() : cutDown(isWindow ? wallG : piece, LEDGE), px, y0, pz, dir.yaw, len, 1, 1));
          if (isWindow && windowGlass && len === 1) glass.push(place(windowGlass.clone(), px, y0, pz, dir.yaw));
          // Offers in every other front window, on the outside of the glass; the front windows glow at night.
          if (L === 0 && isFront && isWindow && pane && Math.round(t - f.x0 - 0.5) % 2 === 0) posters.push(place(posterGeometry(pal, sc.primary, sc.accent, sc.trim), px + (t < shop.door.x ? 0.12 : -0.12), pane.y0 + 0.02, line + WALL_T / 2 + pane.z1 + 0.006));
          if (isFront && isWindow && pane) litPanes.push(box(pal, '#FFE6A8', pane.x1 - pane.x0 - 0.02, pane.y1 - pane.y0 - 0.02, 0.01, px + (pane.x0 + pane.x1) / 2, y0 + pane.y0 + 0.01, line + 0.08));
          if (!isDoor) {
            const a = t - 0.5 + (ends[0] === 'corner' ? 0.12 : ends[0] === 'notch' ? -0.062 : 0);
            const b = t + 0.5 - (ends[1] === 'corner' ? 0.12 : ends[1] === 'notch' ? -0.062 : 0);
            const hole = isWindow && opening ? { a: t + opening.x0, b: t + opening.x1, y0: opening.y0, y1: opening.y1 } : null;
            const key = L === 0 ? wallKey(dir.name, line, t) : dir.axis === 'x' ? wallKey(dir.name, zOnLevel(line, L), t) : wallKey(dir.name, line, zOnLevel(t, L));
            const finish = shop.wallStyles?.[key] ?? shop.wallStyle ?? 'bands';
            const lift = (g: BufferGeometry) => (y0 ? g.translate(0, y0, 0) : g);
            full.push(...this.paintPanels(line - outward * 0.062, dir.axis, a, b, 1, hole, finish).map(lift));
            ledge.push(...this.paintPanels(line - outward * 0.062, dir.axis, a, b, LEDGE, null, finish).map(lift));
          }
        }
        if (!full.length) continue;
        const fullMesh = new Mesh(merge(full), this.assets.material);
        const ledgeMesh = new Mesh(merge(ledge), this.assets.material);
        for (const m of [fullMesh, ledgeMesh]) { m.castShadow = true; m.receiveShadow = true; parent.add(m); }
        const side: Side = { full: fullMesh, ledge: ledgeMesh, nx: dir.nx, nz: dir.nz, extraFull: [] };
        if (glass.length) { const gm = new Mesh(merge(glass), this.assets.glass); parent.add(gm); side.extraFull.push(gm); }
        this.sides.push(side);
        if (dir.name === 'front' && L === 0) front = side;
      }
      // Corner posts: a half-width wall piece closing the square outside each outer corner of the floor.
      const corner = place(wallG.clone(), 0, 0, 0, 0, 0.5, 1, 1);
      const posts: BufferGeometry[] = [];
      const seen = new Set<string>();
      for (const tile of tilesL) for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        if (atL(tile.x + dx, tile.z) || atL(tile.x, tile.z + dz)) continue;
        const cx = tile.x + 0.5 + dx * 0.75, cz = tile.z + 0.5 + dz * 0.75, k = `${cx},${cz}`;
        if (seen.has(k)) continue;
        seen.add(k);
        posts.push(place(corner.clone(), ox + cx, y0, oz + cz));
      }
      if (posts.length) { const postMesh = new Mesh(merge(posts), this.assets.material); postMesh.castShadow = true; parent.add(postMesh); }
      if (L > 0 && st.built[L]) this.upperFloor(shop, L, st, parent);
    }
    if (posters.length && front) { const pm = new Mesh(merge(posters), this.assets.material); this.shell.add(pm); front.extraFull.push(pm); }
    const frontSide: Side = front ?? { full: new Mesh(), ledge: new Mesh(), nx: 0, nz: 1, extraFull: [] };

    // ---- Front: striped awning over the windows, the name on a fascia, and a pylon by the road. They span
    // the run of front wall either side of the door.
    let rx0 = shop.door.x - 0.5, rx1 = shop.door.x + 0.5;
    while (at(rx0 - 1, f.z1 - 1)) rx0--;
    while (at(rx1, f.z1 - 1)) rx1++;
    const fr = { x0: rx0, x1: rx1 };
    const width = fr.x1 - fr.x0;
    const fz = oz + f.z1 + WALL_T + 0.02;
    const awning: BufferGeometry[] = [];
    let k = 0;
    for (let x = ox + fr.x0; x < ox + fr.x1 - 0.01; x += 0.25, k++) {
      if (Math.abs(x + 0.125 - (ox + shop.door.x)) < 0.55) continue;
      const g = box(pal, k % 2 ? sc.accent : sc.primary, 0.25, 0.035, 0.42, 0, 0, 0);
      g.rotateX(0.42);
      g.translate(x + 0.125, 0.86, fz + 0.18);
      awning.push(g);
    }
    awning.push(box(pal, sc.dark, width, 0.05, 0.06, ox + (fr.x0 + fr.x1) / 2, 0.98, fz + 0.01));
    const awningMesh = new Mesh(merge(awning), this.assets.material);
    awningMesh.castShadow = true;
    this.shell.add(awningMesh);
    frontSide.extraFull.push(awningMesh);
    const name = shop.name;
    const fascia: BufferGeometry[] = [];
    const size = Math.min(0.3, (width - 0.6) / Math.max(1, this.textWidth(name, 1)));
    fascia.push(box(pal, sc.primary, width + 0.5, 0.5, 0.1, ox + (fr.x0 + fr.x1) / 2, 1.0, fz - 0.02));
    fascia.push(box(pal, sc.dark, width + 0.54, 0.05, 0.14, ox + (fr.x0 + fr.x1) / 2, 1.48, fz - 0.02));
    const fl = this.letters(name, size, 0.05, CREAM, sc.trim);
    fascia.push(place(fl, ox + (fr.x0 + fr.x1) / 2, 1.25 - size * 0.4, fz + 0.04));
    fascia.push(...this.bracket(ox + (fr.x0 + fr.x1) / 2, 1.06, fz + 0.04, Math.min(width - 0.3, this.textWidth(name, size) + 0.2)));
    const fasciaMesh = new Mesh(merge(fascia), this.assets.material);
    fasciaMesh.castShadow = true;
    this.shell.add(fasciaMesh);
    // The fascia stays up whatever the cut-away does: the shop keeps its name.
    // Pylon sign on the lawn by the sidewalk, readable from the street in both directions.
    // Between the service lane and the walkway; the posts sit inside the board's depth so their faces never fight it.
    const spot = pylonSpot(shop);
    const px = ox + spot.x, pz = oz + spot.z;
    const boardW = spot.w;
    const psize = Math.min(0.26, (boardW - 0.35) / Math.max(1, this.textWidth(name, 1)));
    const pylon: BufferGeometry[] = [
      box(pal, SLATE, 0.12, 1.5, 0.08, px - boardW / 2 + 0.2, 0, pz), box(pal, SLATE, 0.12, 1.5, 0.08, px + boardW / 2 - 0.2, 0, pz),
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
    { // Over the floor and its walls, tile by tile, on top of however many storeys stand there, with the parapet round each outline.
      const roof: BufferGeometry[] = [];
      const T = WALL_T;
      const height = (x: number, z: number) => { let h = -1; for (let L = 0; L < MAX_LEVELS; L++) if (st.inside[L]?.has(tileKey(x, z))) h = L; return h; };
      for (const tile of tiles) {
        const h = height(tile.x, tile.z), y = (h + 1) * STOREY;
        roof.push(box(pal, '#9AA0A8', 1, 0.06, 1, tile.x + 0.5, y, tile.z + 0.5));
        for (const dir of DIRS) {
          // The parapet where the neighbour stands lower (or is not the shop at all).
          if (height(tile.x + dir.nx, tile.z + dir.nz) >= h) continue;
          const open = !at(tile.x + dir.nx, tile.z + dir.nz);
          const cx = tile.x + 0.5 + dir.nx * (0.5 + T / 2), cz = tile.z + 0.5 + dir.nz * (0.5 + T / 2);
          if (open) roof.push(box(pal, '#9AA0A8', dir.axis === 'x' ? 1 + T : T, 0.06, dir.axis === 'x' ? T : 1 + T, cx, y, cz));
          const px = tile.x + 0.5 + dir.nx * (0.5 + (open ? T : 0)), pz = tile.z + 0.5 + dir.nz * (0.5 + (open ? T : 0));
          roof.push(box(pal, sc.primary, dir.axis === 'x' ? 1 + 2 * T : 0.08, 0.12, dir.axis === 'x' ? 0.08 : 1 + 2 * T, px, y, pz));
        }
      }
      const mid = tiles[Math.floor(tiles.length / 3)];
      if (mid) roof.push(box(pal, '#B9BCC4', 0.6, 0.3, 0.5, mid.x + 0.5, (height(mid.x, mid.z) + 1) * STOREY + 0.06, mid.z + 0.5));
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
      g.add(new Mesh(box(pal, '#FFE6A8', width + 0.3, 0.025, 0.03, ox + (f.x0 + f.x1) / 2, 0.735, fz + 0.03), SIGN_GLOW));
      // Lit letters (a goal reward): the name on the fascia and the pylon shines after dark.
      if (shop.signStyle === 'lit') {
        const lit = [place(this.letters(name, size, 0.05, CREAM, sc.trim), ox + (f.x0 + f.x1) / 2, 1.25 - size * 0.4, fz + 0.046)];
        for (const yaw of [0, Math.PI]) lit.push(place(this.letters(name, psize, 0.04, CREAM, sc.trim, false), px, 1.24 - psize * 0.4, pz + (yaw === 0 ? 0.076 : -0.076), yaw));
        g.add(Object.assign(new Mesh(merge(lit), SIGN_GLOW), { name: 'lit-sign' }));
      }
      const pool = new Mesh(mergeGeometries([spillGeometry(width * 0.6, 1.4, ox + (f.x0 + f.x1) / 2, 0.035, fz + 1.1), spillGeometry(0.9, 0.7, ox + shop.door.x, 0.036, fz + 0.45, 0.7)]), SPILL);
      pool.renderOrder = 1;
      g.add(pool);
      g.visible = this.night;
      this.nightGlow = g;
      this.shell.add(g); }
    this.showLevels();
    this.layoutVersion = -1;
    this.stockKey = '';
  }

  /**
   * An open floor upstairs: its boards (the ceiling panels below, from above), and a glass balustrade round
   * every opening in it (where the stairs come up, a double-height space), open only where the stairs land.
   */
  private upperFloor(shop: Shop, L: number, st: ReturnType<typeof storeysOf>, parent: Group): void {
    const pal = this.assets.palette, y0 = L * STOREY;
    const parts: BufferGeometry[] = [];
    const floors = st.floors[L]!, inside = st.inside[L]!;
    for (const k of floors) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      // Each tile in its own finish, as downstairs.
      const fin = floorPaint(shop.tileStyles?.[tileKey(x, zOnLevel(z, L))] ?? shop.floorStyle ?? 'lino', this.scheme);
      parts.push(box(pal, fin.joint, 1, 0.08, 1, x + 0.5, y0 - 0.068, z + 0.5));
      if (fin.boards) { for (let b = 0; b < 4; b++) parts.push(box(pal, fin.boards[(Math.round(x * 7) + z * 3 + b * 5 + 99) % fin.boards.length]!, 0.985, 0.003, 0.235, x + 0.5, y0 + 0.011, z + 0.125 + b * 0.25)); continue; }
      parts.push(box(pal, (Math.round(x - 0.5) + z) % 2 ? fin.b : fin.a, fin.gap, 0.003, fin.gap, x + 0.5, y0 + 0.011, z + 0.5));
    }
    // Where each flight comes up: no rail between its top step (or the lift's door) and the floor it lands on.
    const landings = new Set<string>();
    for (const v of shop.fixtures) {
      if (!VERTICAL.has(v.type) || levelOf(v) !== L - 1) continue;
      const top = rideEnds(v).top, tx = top.x - 0.5, tz = groundZ(top.z - 0.5);
      const fc = [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }][v.rot & 3]!;
      const s = v.type === 'elevator' ? -1 : 1;
      landings.add(`${tx},${tz}>${tx + fc.x * s},${tz + fc.z * s}`);
    }
    for (const k of floors) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = tileKey(x + dx, z + dz);
        if (!inside.has(n) || floors.has(n) || landings.has(`${x},${z}>${x + dx},${z + dz}`)) continue;
        // On this tile's edge, a hand's breadth in.
        const cx = x + 0.5 + dx * 0.46, cz = z + 0.5 + dz * 0.46, along = dz !== 0;
        parts.push(box(pal, '#BFEFFF', along ? 1 : 0.025, 0.42, along ? 0.025 : 1, cx, y0 + 0.02, cz));
        parts.push(box(pal, '#38383D', along ? 1.02 : 0.045, 0.04, along ? 0.045 : 1.02, cx, y0 + 0.44, cz));
      }
    }
    if (!parts.length) return;
    const mesh = new Mesh(merge(parts), this.assets.material);
    mesh.receiveShadow = true; mesh.castShadow = true;
    parent.add(mesh);
  }

  /**
   * Garden on the parts of the plot the shop and its lot do not use: trees, bushes and flowers on a
   * loose grid, never on paving. A bench and a bin by the door, a dumpster in the yard.
   */
  private dressLot(shop: Shop, parts: BufferGeometry[]): void {
    // Street props first (more as the shop grows), on the lawn beside the paths; then the garden round them.
    const tier = shop.sizeId === 'large' ? 2 : shop.sizeId === 'medium' ? 1 : 0;
    // Everything the player built or laid out there: the street props and the garden keep off it.
    const extra: Rect[] = [
      ...shop.fixtures.filter((f) => FIXTURES[f.type].outdoor).map((f) => footprintOf(f.type, f.x, f.z, f.rot)),
      ...Object.keys(shop.lotTiles ?? {}).map((k) => { const [x, z] = k.split(',').map(Number) as [number, number]; return { x0: x, z0: z, x1: x + 1, z1: z + 1 }; }),
    ];
    const shape = { ...shop, extra };
    const props = cornerProps(shape, tier, { trolleys: shop.lotRows >= 2, noBikes: true });
    for (const pr of props) parts.push(this.placed(pr.model, pr.x, pr.z, pr.yaw, pr.scale ?? 1));
    const garden = cornerGarden(shape, props, 1);
    for (const it of garden.items) parts.push(this.placed(it.model, it.x, it.z, it.yaw, it.scale));
    // Grass tufts and wild flowers all over the lawn: one mesh.
    const tuft = tuftMesh(this.assets, garden.tufts);
    if (tuft) this.shell.add(tuft);
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
  private paintPanels(plane: number, axis: 'x' | 'z', a: number, b: number, top: number, hole: { a: number; b: number; y0: number; y1: number } | null, style: WallStyle = 'bands'): BufferGeometry[] {
    const pal = this.assets.palette, sc = this.scheme, out: BufferGeometry[] = [];
    // Each finish as bands up the wall; thin lines (grout, mortar, a rail) stand a little proud of it.
    const lines = (y0: number, y1: number, step: number, hex: string): [readonly [number, number], string, number][] => { const o: [readonly [number, number], string, number][] = []; for (let y = y0 + step; y < y1 - 0.01; y += step) o.push([[y, y + 0.008], hex, 0.024]); return o; };
    const bands: [readonly [number, number], string, number?][] =
      style === 'plain' ? [[WALL_BANDS.skirting, '#D8DADF'], [[0.07, 0.97], RAIL]]
      : style === 'tiles' ? [[WALL_BANDS.skirting, '#D8DADF'], [[0.07, 0.6], '#FFFFFF'], ...lines(0.07, 0.6, 0.09, '#D8DADF'), [[0.6, 0.63], '#D8DADF'], [[0.63, 0.97], '#F4F7FA']]
      : style === 'wood' ? [[WALL_BANDS.skirting, '#A87B45'], [[0.07, 0.55], '#C99A62'], ...lines(0.07, 0.55, 0.12, '#B8824C'), [[0.55, 0.6], '#A87B45'], [[0.6, 0.97], RAIL]]
      : style === 'brick' ? [[[0, 0.97], '#B8402E'], ...lines(0, 0.97, 0.08, '#D8DADF')]
      : [[WALL_BANDS.skirting, SKIRTING], [WALL_BANDS.lower, sc.primary], [WALL_BANDS.rail, RAIL], [WALL_BANDS.upper, sc.light]];
    let depth = 0.02;
    const piece = (u0: number, u1: number, y0: number, y1: number, hex: string) => {
      if (u1 - u0 < 0.01 || y1 - y0 < 0.005) return;
      const c = (u0 + u1) / 2, len = u1 - u0, deep = hex === SKIRTING ? 0.03 : depth;
      out.push(axis === 'x' ? box(pal, hex, len, y1 - y0, deep, c, y0, plane) : box(pal, hex, deep, y1 - y0, len, plane, y0, c));
    };
    for (const [[y0, y1], hex, d] of bands) {
      depth = d ?? 0.02;
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

  /** The bikes shoppers locked to the racks while they shop: nose in to the hoops, in each rider's colour. */
  private updateBikes(state: GameState): void {
    const n = new Map<string, number>();
    const m = this.tmpM;
    for (const f of state.shop.fixtures) {
      if (f.type !== 'bikeRack' || !f.bikes) continue;
      for (let slot = 0; slot < Math.min(RACK_STANDS, f.bikes.length); slot++) {
        const id = f.bikes[slot];
        if (id === null || id === undefined) continue;
        const p = state.people.find((x) => x.id === id);
        if (!p || p.riding) continue;
        const hex = BIKE_COLOURS[id % BIKE_COLOURS.length]!;
        let mesh = this.parked.get(hex);
        if (!mesh) { mesh = new InstancedMesh(rideBikeGeometry(this.assets.palette, hex), this.assets.material, 16); mesh.frustumCulled = false; mesh.castShadow = true; this.parked.set(hex, mesh); this.root.add(mesh); }
        const k = n.get(hex) ?? 0;
        if (k >= 16) continue;
        const sp = standPoint(f, slot);
        m.makeRotationY(sp.yaw + Math.PI); m.setPosition(sp.bike.x, 0, sp.bike.z);
        mesh.setMatrixAt(k, m); n.set(hex, k + 1);
      }
    }
    for (const [hex, mesh] of this.parked) { mesh.count = n.get(hex) ?? 0; mesh.instanceMatrix.needsUpdate = true; }
  }

  /** A fixture model painted for the warm shop (cached per model). */
  private fixtureGeometry(model: string): BufferGeometry {
    let g = this.painted.get(model);
    if (!g) {
      let src = model === 'chiller' ? this.chillerGeo! : model.startsWith('gen:') ? fittingGeometry(this.assets, model, this.scheme) : this.assets.geometry(model);
      // Your own billboard: the shop's name across it, and a line under.
      if (model === 'gen:billboard') {
        const pal = this.assets.palette, name = this.shopName.toUpperCase();
        src = merge([src, place(textGeometry(pal, name, Math.min(0.2, 1.6 / Math.max(5, name.length * 0.85)), 0.02, CREAM, CREAM), 0, 1.25, -0.305), place(textGeometry(pal, 'FRESH EVERY DAY', 0.08, 0.015, YELLOW, YELLOW), 0, 1.02, -0.305)]);
      }
      // No taller than a storey, so nothing pokes up through the boards of a floor over it (a kiosk, an end cap):
      // pressed down over its stock (the whole of one with none). Our own fittings are made to measure.
      if (!model.startsWith('gen:')) {
        const stock = (Object.keys(FIXTURE_MODEL) as FixtureType[]).flatMap((t) => FIXTURE_MODEL[t] === model ? SLOT_BOXES[t] ?? [] : []);
        src = pressUnder(src, STOREY, Math.max(0, ...stock.map((b) => b.y + b.h)));
      }
      const map = FIXTURE_PAINT[model];
      g = map ? paintStrips(src, this.assets.palette, map) : src;
      this.painted.set(model, g);
    }
    return g;
  }

  /** Per frame: wall cut-down (cinematic camera only), fixtures, stock, boxes, spills. */
  update(state: GameState, cameraYaw: number | null, eye?: Vector3): void {
    const shop = state.shop;
    if (this.shellKey !== shellKeyOf(shop)) { this.buildShell(shop); this.layoutVersion = -1; }
    const flip = shop.flip ? -1 : 1;
    for (const s of this.sides) {
      const facing = cameraYaw !== null && flip * (s.nx * Math.sin(cameraYaw) + s.nz * Math.cos(cameraYaw)) > 0.25;
      s.full.visible = !facing; s.ledge.visible = facing;
      for (const m of s.extraFull) m.visible = !facing;
    }
    for (const w of this.wallCut) { w.full.visible = cameraYaw === null; w.cut.visible = cameraYaw !== null; }
    if (this.bunting) this.bunting.visible = (state.day === 1 || state.marketing.openingEventDay === state.day) && state.phase !== 'night' && state.phase !== 'picking';
    if (shop.layoutVersion !== this.layoutVersion) { this.rebuildFixtures(shop); this.layoutVersion = shop.layoutVersion; this.stockKey = ''; }
    this.updateBikes(state);
    const key = `${stockKey(shop)}|${this.viewLevel}`;
    if (key !== this.stockKey) { this.rebuildProducts(shop); this.rebuildBoxes(shop); this.stockKey = key; }
    const n = Math.min(8, shop.litter.length);
    // A spill upstairs sits on its floor; on a floor out of view it is not drawn, and under the floor in view (or, from
    // outside, under the boards over it) its bubble is hidden by it.
    const spillAt = (l: { x: number; z: number }) => { const lp = toLocal(shop, l.x, l.z), L = levelOfZ(lp.z), m = eye ? spillMark(shop, eye, l.x, l.z, this.viewLevel) : { hidden: this.viewLevel !== null && L > this.viewLevel, below: this.viewLevel !== null && L < this.viewLevel }; return { x: lp.x, y: L * STOREY, z: zOnLevel(lp.z, -L), ...m }; };
    for (let i = 0; i < n; i++) { const l = shop.litter[i]!; const at = spillAt(l); this.dummy.position.set(at.x, at.y + 0.032, at.z); this.dummy.rotation.set(0, 0, 0); this.dummy.scale.set(at.hidden ? 0 : 1 + (l.id % 3) * 0.2, 1, at.hidden ? 0 : 1); this.dummy.updateMatrix(); this.spills.setMatrixAt(i, this.dummy.matrix); }
    this.spills.count = n; this.spills.instanceMatrix.needsUpdate = true;
    if (n && !this.spillMarks.length && typeof document !== 'undefined') {
      const mat = new SpriteMaterial({ map: icon('spill'), depthTest: false, transparent: true });
      this.spillMarkMats = [mat, new SpriteMaterial({ map: mat.map, transparent: true })];
      for (let i = 0; i < 8; i++) { const sp = new Sprite(mat); sp.renderOrder = 5; sp.scale.set(0.3, 0.3, 1); sp.visible = false; this.spillMarks.push(sp); this.root.add(sp); }
    }
    const bob = performance.now() / 1000;
    this.spillMarks.forEach((sp, i) => {
      const l = shop.litter[i];
      sp.visible = i < n && !!l;
      if (!l) return;
      const at = spillAt(l);
      sp.visible = !at.hidden;
      sp.material = this.spillMarkMats[at.below ? 1 : 0]!;
      sp.position.set(at.x, at.y + 0.5 + 0.05 * Math.sin(bob * 3 + i), at.z);
    });
  }

  /**
   * How far a piece sits forward of its tile's centre: its back flush with the back edge of the tile
   * (so a row stands tight against a wall or against the row behind), measured from its model. Pieces
   * with no back to put against anything stay in the middle, and lights and windows hang where drawn.
   */
  private offsets = new Map<FixtureType, number>();
  private offsetOf(type: FixtureType): number {
    let d = this.offsets.get(type);
    if (d === undefined) {
      if (CENTRED.has(type)) d = 0;
      else { const g = this.fixtureGeometry(type === 'fridge' && this.chillerGeo ? 'chiller' : FIXTURE_MODEL[type]); g.computeBoundingBox(); d = -0.49 - g.boundingBox!.min.z; }
      this.offsets.set(type, d);
    }
    return d;
  }

  private fixtureMatrix(shop: Shop, f: Fixture, out: Matrix4, yOffset = 0, modelOffset = false): Matrix4 {
    const yaw = f.rot * Math.PI / 2;
    const dz = modelOffset ? this.offsetOf(f.type) : 0;
    // The middle of its footprint (a billboard spans two tiles), up on its floor; a hanging light under a
    // double-height ceiling hangs from that.
    const r = footprintOf(f.type, f.x, f.z, f.rot), L = levelOf(f);
    const y = yOffset + L * STOREY + (f.type === 'pendant' && doubleHeight(shop, f.x, f.z) ? STOREY : 0);
    this.dummy.position.set((r.x0 + r.x1) / 2 + Math.sin(yaw) * dz, y, zOnLevel((r.z0 + r.z1) / 2, -L) + Math.cos(yaw) * dz);
    this.dummy.rotation.set(0, yaw, 0);
    this.dummy.scale.set(1, 1, 1);
    this.dummy.updateMatrix();
    out.copy(this.dummy.matrix);
    return out;
  }

  private rebuildFixtures(shop: Shop): void {
    for (const { mesh } of this.fixtureMeshes.values()) { this.root.remove(mesh); mesh.dispose(); }
    this.fixtureMeshes.clear();
    for (const { cut } of this.wallCut) { this.root.remove(cut); cut.dispose(); }
    this.wallCut = [];
    for (const g of this.glows.values()) { this.root.remove(g); g.dispose(); }
    this.glows.clear();
    if (this.lampPools) { this.root.remove(this.lampPools); this.lampPools.dispose(); this.lampPools = null; }
    const byModel = new Map<string, Fixture[]>();
    const shown = shop.fixtures.filter((f) => this.shown(f));
    for (const f of shown) { const id = f.type === 'fridge' ? 'chiller' : FIXTURE_MODEL[f.type]; const arr = byModel.get(id) ?? []; arr.push(f); byModel.set(id, arr); }
    const m = new Matrix4();
    for (const [model, list] of byModel) {
      // A piece whose model is missing is skipped, never the rest of the shop with it.
      let geo: BufferGeometry;
      try { geo = this.fixtureGeometry(model); } catch (e) { console.error(`No model for ${model}`, e); continue; }
      const stack = model === 'market/shopping-basket' ? 3 : 1;
      const mesh = new InstancedMesh(geo, this.assets.material, list.length * stack);
      // Never culled: a handful of meshes spread over the whole shop, and a stale bound must never blank them all.
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      const ids: number[] = [];
      list.forEach((f, i) => { for (let s = 0; s < stack; s++) { mesh.setMatrixAt(i * stack + s, this.fixtureMatrix(shop, f, m, s * 0.09, true)); ids.push(f.id); } });
      mesh.userData.fixtureIds = ids;
      this.root.add(mesh);
      this.fixtureMeshes.set(model, { mesh, ids });
      if (WALL_PIECES.has(model)) {
        // Cut down to a ledge while the manager is inside, like the shop's own walls.
        let low = this.painted.get(`${model}:cut`);
        if (!low) { low = GONE_WITH_WALLS.has(model) ? new BoxGeometryEmpty() : cutDown(this.fixtureGeometry(model), LEDGE); this.painted.set(`${model}:cut`, low); }
        const cut = new InstancedMesh(low, this.assets.material, list.length);
        list.forEach((f, i) => cut.setMatrixAt(i, this.fixtureMatrix(shop, f, m, 0, true)));
        cut.castShadow = true; cut.receiveShadow = true; cut.visible = false; cut.frustumCulled = false;
        cut.userData.fixtureIds = ids;
        this.root.add(cut);
        this.wallCut.push({ full: mesh, cut });
      }
      const glass = model === 'chiller' ? null : this.assets.glassGeometry(model);
      if (glass) {
        const gm = new InstancedMesh(glass, this.assets.glass, list.length);
        gm.frustumCulled = false;
        list.forEach((f, i) => gm.setMatrixAt(i, this.fixtureMatrix(shop, f, m, 0, true)));
        this.root.add(gm);
        this.fixtureMeshes.set(model + ':glass', { mesh: gm, ids: [] });
      }
    }
    this.fixtureBlobs ??= new BlobShadows(this.root, 64, 0.32, 0.02);
    this.fixtureBlobs.begin();
    for (const f of shown) { if (FIXTURES[f.type].walkable || levelOf(f) > 0) continue; const along = f.rot % 2 === 0; this.fixtureBlobs.add(f.x + 0.5, f.z + 0.5, along ? 1.15 : 0.95, along ? 0.95 : 1.15); }
    this.fixtureBlobs.end();
    // Lights: the glowing part of each lamp and neon, and a warm pool on the floor under each lamp.
    const pal = this.assets.palette;
    const lit = shown.filter((f) => glowGeometry(f.type, pal) !== null);
    this.lampCount = lit.filter((f) => LAMPS.has(f.type)).length;
    for (const type of new Set(lit.map((f) => f.type))) {
      const list = lit.filter((f) => f.type === type);
      let geo = this.painted.get(`glow:${type}`);
      if (!geo) { geo = glowGeometry(type, pal)!; this.painted.set(`glow:${type}`, geo); }
      const gm = new InstancedMesh(geo, type === 'neon' ? this.neonMat : LAMP_GLOW, list.length);
      gm.frustumCulled = false;
      list.forEach((f, i) => gm.setMatrixAt(i, this.fixtureMatrix(shop, f, m, 0, true)));
      this.root.add(gm);
      this.glows.set(type, gm);
    }
    const lamps = lit.filter((f) => LAMPS.has(f.type));
    if (lamps.length) {
      this.lampPools = new InstancedMesh(spillGeometry(0.95, 0.95, 0, 0.02, 0, 0.5), SPILL, lamps.length);
      // On the floor: a hanging light under a double-height ceiling hangs a storey up, its pool does not.
      lamps.forEach((f, i) => { this.fixtureMatrix(shop, f, m, f.type === 'pendant' && doubleHeight(shop, f.x, f.z) ? -STOREY : 0, true); m.multiply(this.tmpM.makeTranslation(0, 0, f.type === 'wallLight' ? -0.15 : 0)); this.lampPools!.setMatrixAt(i, m); });
      this.lampPools.renderOrder = 1;
      this.root.add(this.lampPools);
    }
    this.nightLight.intensity = this.nightIntensity();
    this.showLamps();
    let wi = 0;
    // Room for every chiller's well (a big shop can have more than it started with).
    const fridges = shown.filter((f) => f.type === 'fridge').length;
    if (fridges > this.wells.instanceMatrix.count) {
      const bigger = new InstancedMesh(this.wells.geometry, this.wellMat, fridges * 2); bigger.frustumCulled = false;
      this.root.remove(this.wells); this.wells.dispose(); this.wells = bigger; this.root.add(bigger);
    }
    for (const f of shown) if (f.type === 'fridge') { this.wells.setMatrixAt(wi++, this.fixtureMatrix(shop, f, m, 0, true)); }
    this.wells.count = wi; this.wells.instanceMatrix.needsUpdate = true;
  }

  /** Stock: each slot's units laid out in a grid that fits the slot box, scaled down if needed, so nothing clips. */
  private rebuildProducts(shop: Shop): void {
    const counts = new Map<string, number>();
    const m = new Matrix4();
    let stickerI = 0;
    for (const f of shop.fixtures) {
      if (!this.shown(f)) continue;
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
          // A big shop holds more of a product than the mesh had room for: give it twice the room.
          if (i >= pm.mesh.instanceMatrix.count) {
            const bigger = new InstancedMesh(pm.mesh.geometry, pm.mesh.material, pm.mesh.instanceMatrix.count * 2);
            bigger.castShadow = true; bigger.frustumCulled = false;
            const t = new Matrix4(); for (let k = 0; k < i; k++) { pm.mesh.getMatrixAt(k, t); bigger.setMatrixAt(k, t); }
            this.root.remove(pm.mesh); pm.mesh.dispose(); pm.mesh = bigger; this.root.add(bigger);
          }
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
    // A box is about four units. The delivery pallet fills first, the extra Pallets take the overflow.
    const all = Math.min(BOX_MAX, Math.ceil(units / 4));
    const n = Math.min(all, Math.ceil(shop.storageCapacity / 4));
    let k = n;
    const m = new Matrix4();
    for (const f of shop.fixtures) {
      if (f.type !== 'pallet' || k >= all) continue;
      // A pallet upstairs out of view keeps its boxes; they are just not drawn.
      if (!this.shown(f)) { const none = new Matrix4().makeScale(0, 0, 0); for (let j = 0; j < PALLET_UNITS / 4 && k < all; j++, k++) this.boxes.setMatrixAt(k, none); continue; }
      this.fixtureMatrix(shop, f, m);
      for (let j = 0; j < PALLET_UNITS / 4 && k < all; j++, k++) {
        const layer = Math.floor(j / 9), c = j % 9;
        this.dummy.position.set(-0.28 + (c % 3) * 0.28, 0.1 + layer * 0.34, -0.28 + Math.floor(c / 3) * 0.28).applyMatrix4(m);
        this.dummy.rotation.set(0, f.rot * Math.PI / 2 + ((k * 13) % 7 - 3) * 0.04, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.boxes.setMatrixAt(k, this.dummy.matrix);
      }
    }
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
    this.boxes.count = k; this.boxes.instanceMatrix.needsUpdate = true;
  }

  /** A piece as the Build card pictures it: its model, and a lamp's bulb. */
  pictureGeometry(type: FixtureType): BufferGeometry {
    // A window is pictured as it looks from outside: a stretch of the shop's wall with the window in it.
    // A pallet is pictured with a few boxes on it.
    if (type === 'pallet') {
      const bx = this.assets.geometry('furniture/cardboard-box-closed');
      return merge([this.fixtureGeometry('gen:pallet').clone(), ...[[-0.28, -0.28], [0, -0.28], [0.28, -0.28], [-0.28, 0], [0, 0], [-0.28, 0.28]].map(([x, z]) => place(bx.clone(), x!, 0.1, z!, 0, 1.5))]);
    }
    if (type === 'window') return paintStrips(recolor(this.assets.geometry('market/wall-window'), WALL_COLOURS), this.assets.palette, { '2:1': this.scheme.primary });
    const g = this.fixtureGeometry(type === 'fridge' && this.chillerGeo ? 'chiller' : FIXTURE_MODEL[type]);
    const glow = glowGeometry(type, this.assets.palette);
    return glow ? merge([g.clone(), glow]) : g.clone();
  }

  /** A tile tool's tile under the pointer: green when it can be bought or laid, red when not. */
  private tileGhost: Mesh | null = null;
  // Drawn over the grass (and anything else on the tile) so it always shows.
  private tileGhostMat = new MeshBasicMaterial({ color: '#3FA87A', transparent: true, opacity: 0.55, depthWrite: false, depthTest: false });
  /** A tile under the pointer (or any rectangle: a parking bay), lit green or red. */
  setTileGhost(t: { x: number; z: number; ok: boolean; w?: number; d?: number } | null): void {
    if (!t) { if (this.tileGhost) this.tileGhost.visible = false; return; }
    if (!this.tileGhost) { this.tileGhost = new Mesh(box(this.assets.palette, '#FFFFFF', 1, 0.04, 1, 0, 0, 0), this.tileGhostMat); this.tileGhost.renderOrder = 6; this.root.add(this.tileGhost); }
    this.tileGhostMat.color.set(t.ok ? '#3FA87A' : '#E8573F');
    const w = t.w ?? 1, d = t.d ?? 1, L = levelOfZ(t.z + d / 2);
    this.tileGhost.scale.set(w - 0.04, 1, d - 0.04);
    this.tileGhost.position.set(t.x + w / 2, L * STOREY + 0.05, zOnLevel(t.z + d / 2, -L));
    this.tileGhost.visible = true;
  }
  /** A wall tool's stretch of wall under the pointer, lit along its inside face. */
  private wallGhost: Mesh | null = null;
  private wallGhostMat = new MeshBasicMaterial({ color: '#3FA87A', transparent: true, opacity: 0.5, depthWrite: false, depthTest: false });
  setWallGhost(w: { axis: 'x' | 'z'; nx: number; nz: number; line: number; t: number; ok: boolean } | null): void {
    if (!w) { if (this.wallGhost) this.wallGhost.visible = false; return; }
    if (!this.wallGhost) { this.wallGhost = new Mesh(box(this.assets.palette, '#FFFFFF', 1, 0.9, 0.06, 0, 0, 0), this.wallGhostMat); this.wallGhost.renderOrder = 6; this.root.add(this.wallGhost); }
    this.wallGhostMat.color.set(w.ok ? '#3FA87A' : '#E8573F');
    // Upstairs, the stretch is lit on its floor.
    const L = levelOfZ(w.axis === 'x' ? w.line - w.nz * 0.5 : w.t), y = L * STOREY + 0.05;
    if (w.axis === 'x') { this.wallGhost.position.set(w.t, y, zOnLevel(w.line, -L) - w.nz * 0.1); this.wallGhost.rotation.set(0, 0, 0); }
    else { this.wallGhost.position.set(w.line - w.nx * 0.1, y, zOnLevel(w.t, -L)); this.wallGhost.rotation.set(0, Math.PI / 2, 0); }
    this.wallGhost.visible = true;
  }
  /** Growing the shop: every tile that could be bought, faintly marked on the ground. */
  private growHints: InstancedMesh | null = null;
  setGrowHints(tiles: { x: number; z: number }[]): void {
    if (!this.growHints) {
      this.growHints = new InstancedMesh(box(this.assets.palette, '#FFFFFF', 0.9, 0.02, 0.9, 0, 0, 0), new MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.35, depthWrite: false, depthTest: false }), 128);
      this.growHints.frustumCulled = false; this.growHints.renderOrder = 5;
      this.root.add(this.growHints);
    }
    const m = new Matrix4();
    tiles.slice(0, 128).forEach((t, i) => this.growHints!.setMatrixAt(i, m.makeTranslation(t.x + 0.5, 0.025, t.z + 0.5)));
    this.growHints.count = Math.min(128, tiles.length);
    this.growHints.instanceMatrix.needsUpdate = true;
  }

  /** The ceiling panel tools: every panel over the floor being built on, faint at ceiling height. */
  private panelHints: InstancedMesh | null = null;
  setPanelHints(tiles: { x: number; z: number }[], level: number): void {
    if (!this.panelHints) {
      this.panelHints = new InstancedMesh(box(this.assets.palette, '#FFFFFF', 0.94, 0.02, 0.94, 0, 0, 0), new MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.22, depthWrite: false }), 128);
      this.panelHints.frustumCulled = false; this.panelHints.renderOrder = 5;
      this.root.add(this.panelHints);
    }
    const m = new Matrix4();
    tiles.slice(0, 128).forEach((t, i) => this.panelHints!.setMatrixAt(i, m.makeTranslation(t.x + 0.5, (level + 1) * STOREY - 0.04, t.z + 0.5)));
    this.panelHints.count = Math.min(128, tiles.length);
    this.panelHints.instanceMatrix.needsUpdate = true;
  }

  /** Build-mode ghost: green when it can go there, red when it cannot. */
  setGhost(type: FixtureType | null, shop: Shop, x: number, z: number, rot: Rot, valid: boolean): void {
    if (!type) { if (this.ghost) this.ghost.visible = false; return; }
    const geo = type === 'window' ? (this.windowGhostGeo ??= windowGhost(this.assets)) : this.fixtureGeometry(type === 'fridge' && this.chillerGeo ? 'chiller' : FIXTURE_MODEL[type]);
    if (!this.ghost) { this.ghost = new Mesh(geo, this.ghostMat); this.root.add(this.ghost); }
    this.ghost.geometry = geo;
    this.ghost.visible = true;
    this.ghostMat.color.set(valid ? '#3FA87A' : '#E8573F');
    const yaw = rot * Math.PI / 2; const dz = type === 'window' ? 0 : this.offsetOf(type);
    const r = footprintOf(type, x, z, rot), L = levelOfZ(z + 0.5);
    this.ghost.position.set((r.x0 + r.x1) / 2 + Math.sin(yaw) * dz, L * STOREY + 0.02, zOnLevel((r.z0 + r.z1) / 2, -L) + Math.cos(yaw) * dz);
    this.ghost.rotation.set(0, yaw, 0);
  }

  debugFixtures(): unknown { return [...this.fixtureMeshes.entries()].map(([k, v]) => ({ model: k, count: v.mesh.count, ids: v.ids })); }

  /**
   * Raycast fixtures, then the delivery boxes, then the floor (of floor `level`, in its region as the sim has it).
   * Only what is in sight: nothing under the floor in view (or one between), but down a stairwell or into a double-height space.
   */
  pick(ray: Raycaster, shop: Shop, level = 0): StoreHit | null {
    const meshes = [...this.fixtureMeshes.values()].filter((e) => e.ids.length).map((e) => e.mesh);
    // Hidden or not by the floor the thing stands on (the delivery's on the ground), not by how high the ray met it.
    const eye = ray.ray.origin, hidden = (p: Vector3, on: number) => underFloors(shop, eye, p.x, p.y, p.z, on, this.viewLevel);
    const fixtureOf = (h: { object: unknown; instanceId?: number }) => { const ids = (h.object as InstancedMesh).userData.fixtureIds as number[]; return shop.fixtures.find((x) => x.id === ids[h.instanceId ?? 0]); };
    const hits = ray.intersectObjects(meshes, false).filter((h) => { const f = fixtureOf(h); return f && !hidden(h.point, levelOf(f)); });
    const boxHit = ray.ray.intersectBox(this.deliveryBox, new Vector3());
    const boxDist = boxHit && !hidden(boxHit, 0) ? boxHit.distanceTo(eye) : Infinity;
    if (hits.length && hits[0]!.distance < boxDist) {
      const h = hits[0]!, f = fixtureOf(h)!;
      return { kind: 'fixture', id: f.id, type: f.type, dist: h.distance };
    }
    if (boxDist < Infinity && shop.storage.length) return { kind: 'delivery', dist: boxDist };
    const t = (level * STOREY - ray.ray.origin.y) / ray.ray.direction.y;
    if (t > 0) { const p = new Vector3().copy(ray.ray.origin).addScaledVector(ray.ray.direction, t); const q = sinkWorld(shop, p.x, p.z, level); return { kind: 'floor', x: q.x, z: q.z, dist: t }; }
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

function shellKeyOf(shop: Shop): string { return `${shop.name}|${shop.originX}|${shop.originZ}|${JSON.stringify(shop.floor)}|${(shop.gaps ?? []).join(';')}|${shop.backDoor.z}|${JSON.stringify(shop.tileStyles ?? {})}|${shop.wallStyle ?? ''}|${JSON.stringify(shop.wallStyles ?? {})}|${shop.lotRows}|${shop.scheme}|${shop.signStyle ?? 'classic'}|${shop.floorStyle ?? 'lino'}|${shop.fixtures.filter((f) => f.type === 'window' || FIXTURES[f.type].outdoor || VERTICAL.has(f.type)).map((f) => `${f.type}:${f.x},${f.z},${f.rot}`).join(';')}|${(shop.ceilings ?? []).map((r) => r.join(' ')).join('/')}|${JSON.stringify(shop.lotTiles ?? {})}|${(shop.bayPlan ?? []).join(',')}`; }

/** The floor's colours for a finish (every one a colour in the baked palette). */
function floorPaint(style: FloorStyle, sc: Scheme): { a: string; b: string; joint: string; gap: number; boards?: string[] } {
  switch (style) {
    case 'concrete': return { a: '#C4C0B8', b: '#BBB6AD', joint: '#A39E95', gap: 0.99 };
    case 'checker': return { a: '#FFFFFF', b: '#38383D', joint: '#D8D8DC', gap: 0.985 };
    case 'colour': return { a: '#FFFFFF', b: sc.light, joint: '#D8D8DC', gap: 0.975 };
    case 'stone': return { a: '#F4F7FA', b: '#FFFFFF', joint: '#C9CBD1', gap: 0.97 };
    case 'wood': return { a: '#D9A066', b: '#C99A62', joint: '#A87B45', gap: 1, boards: ['#D9A066', '#C99A62', '#C8925A', '#D9A066', '#B8824C'] };
    default: return { a: LINO.a, b: LINO.b, joint: LINO.joint, gap: 0.975 };
  }
}

/** A window piece's frame, set back inside the wall's thickness (the layer of it nearest the wall faces): its extent on the wall. */
function recessOf(g: BufferGeometry): { x0: number; x1: number; y0: number; y1: number } | null {
  const pos = g.getAttribute('position'), idx = g.getIndex();
  g.computeBoundingBox();
  const deep = Math.max(-g.boundingBox!.min.z, g.boundingBox!.max.z) * 0.6;
  const tris = idx ? idx.count / 3 : pos.count / 3;
  const depth: number[] = [];
  for (let t = 0; t < tris; t++) depth.push(Math.max(...[0, 1, 2].map((k) => Math.abs(pos.getZ(idx ? idx.getX(t * 3 + k) : t * 3 + k)))));
  const frame = Math.max(...depth.filter((d) => d <= deep));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let t = 0; t < tris; t++) {
    if (Math.abs(depth[t]! - frame) > 0.005) continue;
    for (let k = 0; k < 3; k++) { const i = idx ? idx.getX(t * 3 + k) : t * 3 + k; x0 = Math.min(x0, pos.getX(i)); x1 = Math.max(x1, pos.getX(i)); y0 = Math.min(y0, pos.getY(i)); y1 = Math.max(y1, pos.getY(i)); }
  }
  return x1 > x0 ? { x0, x1, y0, y1 } : null;
}
