import type { BufferGeometry, Raycaster} from 'three';
import { Group, Mesh, InstancedMesh, Object3D, Matrix4, Color, PlaneGeometry, MeshBasicMaterial, DoubleSide, Vector3 } from 'three';
import type { AssetLibrary } from './assets';
import type { GameState, Shop, Fixture, FixtureType } from '@/sim/types';
import { productDef, type Shape } from '@/sim/products';
import { FIXTURES, STARTER } from '@/sim/layout';
import { box, merge, paint, place } from './geometry';
import { textGeometry, textWidth } from './letters';
import { buildShapes, type ShapeGeo } from './products';
import { WALL_HEIGHT, WALL_THICK, LEDGE_HEIGHT, STRIPE_BOTTOM, STRIPE_TOP } from './scale';

const WHITE = '#FFFFFF', GREEN = '#3FA87A', GREEN_DARK = '#2E8560', HONEY = '#D9A066', HONEY_DARK = '#B8824C', SLATE = '#38383D', CREAM = '#FFF3DC', TILE = '#B9BCC4', TILE_DARK = '#9A9DA6', YELLOW = '#FFC044';

const FIXTURE_MODEL: Record<FixtureType, string> = {
  register: 'market/cash-register', shelf: 'market/shelf-boxes', fridge: 'market/freezers-standing', freezer: 'market/freezer', produce: 'market/display-fruit',
  endcap: 'market/shelf-end', kiosk: 'market/cash-register', rack: 'market/shelf-end', sign: 'furniture/coat-rack-standing', plant: 'furniture/potted-plant', bench: 'furniture/bench', basketStack: 'market/shopping-basket',
};
/** Local z offset so models whose pivot sits on the front face are centred in their tile. */
const MODEL_OFFSET: Partial<Record<FixtureType, number>> = { fridge: 0.25, endcap: 0.2, rack: 0.2 };
export const STORE_MODELS = [...new Set(Object.values(FIXTURE_MODEL))].concat(['market/wall-door', 'furniture/cardboard-box-closed', 'furniture/cardboard-box-open', 'furniture/rug-doormat']);

export type StoreHit = { kind: 'fixture'; id: number; type: FixtureType } | { kind: 'floor'; x: number; z: number };

interface SlotLayout { tiers: number[]; cols: number[]; frontZ: number; backZ: number; across: number }
const SLOT_LAYOUT: Partial<Record<FixtureType, SlotLayout>> = {
  shelf: { tiers: [0.055, 0.325, 0.6], cols: [-0.19, 0.19], frontZ: 0.24, backZ: -0.2, across: 2 },
  fridge: { tiers: [0.1, 0.48], cols: [-0.24, 0.24], frontZ: 0.08, backZ: -0.16, across: 2 },
  freezer: { tiers: [0.22], cols: [-0.18, 0.18], frontZ: 0.18, backZ: -0.18, across: 2 },
  produce: { tiers: [0.36], cols: [-0.14, 0.14], frontZ: 0.2, backZ: -0.2, across: 2 },
  endcap: { tiers: [0.1, 0.42, 0.74], cols: [0], frontZ: 0.12, backZ: -0.02, across: 2 },
  rack: { tiers: [0.1, 0.42], cols: [0], frontZ: 0.1, backZ: -0.1, across: 2 },
};

/** Builds and updates the player's store: shell, fixtures, stock, storeroom boxes, sign. */
export class StoreView {
  readonly group = new Group();
  private shell = new Group();
  private sides: { full: Mesh; ledge: Mesh; nx: number; nz: number; extraFull?: Mesh[] }[] = [];
  private fixtureMeshes = new Map<string, { mesh: InstancedMesh; ids: number[] }>();
  private shapes!: Record<Shape, ShapeGeo>;
  private productMeshes = new Map<Shape, { body: InstancedMesh; accent: InstancedMesh }>();
  private boxes!: InstancedMesh;
  private screens!: InstancedMesh;
  private glowPanels!: InstancedMesh;
  private glowFloor!: InstancedMesh;
  private layoutVersion = -1;
  private stockKey = '';
  private shopName = '';
  private origin = { x: 0, z: 0 };
  private readonly dummy = new Object3D();
  private signMesh: Mesh | null = null;
  private glowMat: MeshBasicMaterial;
  private glowFloorMat: MeshBasicMaterial;
  private nightGlow: Mesh | null = null;
  private nightMat: MeshBasicMaterial;

  constructor(private readonly assets: AssetLibrary) {
    this.group.add(this.shell);
    this.glowMat = new MeshBasicMaterial({ color: new Color('#D6F5FF') });
    this.glowFloorMat = new MeshBasicMaterial({ color: new Color('#BFEFFF'), transparent: true, opacity: 0.35, depthWrite: false });
    this.nightMat = new MeshBasicMaterial({ color: new Color('#FFD28A'), transparent: true, opacity: 0.42, depthWrite: false });
  }

  setNight(on: boolean): void { if (this.nightGlow) this.nightGlow.visible = on; }

  init(): void {
    const pal = this.assets.palette;
    this.shapes = buildShapes(pal);
    for (const [shape, geo] of Object.entries(this.shapes) as [Shape, ShapeGeo][]) {
      const body = new InstancedMesh(geo.body, this.assets.material, 900);
      const accent = new InstancedMesh(geo.accent, this.assets.material, 900);
      body.castShadow = true; body.count = 0; accent.count = 0;
      body.frustumCulled = false; accent.frustumCulled = false;
      this.group.add(body, accent);
      this.productMeshes.set(shape, { body, accent });
    }
    this.boxes = new InstancedMesh(this.assets.geometry('furniture/cardboard-box-closed'), this.assets.material, 64);
    this.boxes.castShadow = true; this.boxes.count = 0; this.boxes.frustumCulled = false;
    this.group.add(this.boxes);
    const screenGeo = paint(new PlaneGeometry(0.14, 0.1), pal, '#9BE3FF');
    this.screens = new InstancedMesh(screenGeo, this.glowMat, 16); this.screens.count = 0; this.screens.frustumCulled = false;
    const panelGeo = paint(new PlaneGeometry(0.86, 0.72), pal, '#D6F5FF');
    this.glowPanels = new InstancedMesh(panelGeo, this.glowMat, 32); this.glowPanels.count = 0; this.glowPanels.frustumCulled = false;
    const floorGeo = paint(new PlaneGeometry(1.0, 0.5), pal, '#BFEFFF');
    this.glowFloor = new InstancedMesh(floorGeo, this.glowFloorMat, 32); this.glowFloor.count = 0; this.glowFloor.frustumCulled = false;
    this.group.add(this.screens, this.glowPanels, this.glowFloor);
  }

  /** Rebuild the shell (walls, floors, sign) for a shop. */
  buildShell(shop: Shop): void {
    const pal = this.assets.palette;
    this.shell.clear();
    this.sides = [];
    this.origin = { x: shop.originX, z: shop.originZ };
    this.shopName = shop.name;
    const f = shop.floor, s = shop.storeroom;
    const ox = shop.originX, oz = shop.originZ;
    // Floors.
    const floorParts: BufferGeometry[] = [];
    for (let x = f.x0; x < f.x1; x++) for (let z = f.z1 - 1; z >= f.z0; z--) {
      for (let k = 0; k < 4; k++) {
        const shade = ((x * 3 + z * 5 + k) % 4 === 0) ? HONEY_DARK : HONEY;
        floorParts.push(box(pal, shade, 1.0, 0.025, 0.25, ox + x + 0.5, 0, oz + z + 0.125 + k * 0.25));
      }
    }
    for (let x = s.x0; x < s.x1; x++) for (let z = s.z0; z < s.z1; z++) {
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        floorParts.push(box(pal, (i + j) % 2 ? TILE : TILE_DARK, 0.49, 0.025, 0.49, ox + x + 0.25 + i * 0.5, 0, oz + z + 0.25 + j * 0.5));
      }
    }
    // Doormat and apron threshold.
    floorParts.push(box(pal, GREEN_DARK, 0.9, 0.03, 0.5, ox + shop.door.x, 0.0, oz + shop.door.z + 0.35));
    floorParts.push(box(pal, CREAM, 0.6, 0.032, 0.3, ox + shop.door.x, 0.0, oz + shop.door.z + 0.35));
    // Lot paving: apron, walkway, parking aisle and bays, driveway, service lane, back yard.
    const L = STARTER;
    const slab = (r: { x0: number; z0: number; x1: number; z1: number }, hex: string, h = 0.03, y = -0.012) =>
      floorParts.push(box(pal, hex, r.x1 - r.x0, h, r.z1 - r.z0, ox + (r.x0 + r.x1) / 2, y, oz + (r.z0 + r.z1) / 2));
    slab(L.apron, '#CFCBC2', 0.04);
    slab({ x0: L.walkway.x - 0.5, z0: L.apron.z1, x1: L.walkway.x + 0.5, z1: 3.3 }, '#CFCBC2', 0.04);
    slab(L.aisle, '#6E717C'); slab(L.driveway, '#6E717C'); slab(L.serviceLane, '#6E717C'); slab(L.backYard, '#6E717C');
    for (const b of L.bays) {
      slab({ x0: b.x - 0.85, z0: b.z - 0.55, x1: b.x + 0.85, z1: b.z + 0.55 }, '#6E717C');
      // White bay lines on both sides and a stop line at the head.
      floorParts.push(box(pal, '#F2F2F2', 1.6, 0.004, 0.05, ox + b.x, 0.02, oz + b.z - 0.55));
      floorParts.push(box(pal, '#F2F2F2', 1.6, 0.004, 0.05, ox + b.x, 0.02, oz + b.z + 0.55));
      floorParts.push(box(pal, '#F2F2F2', 0.05, 0.004, 1.15, ox + b.x - 0.85, 0.02, oz + b.z));
    }
    // Kerbs around the parking lot and a "P" sign post by the driveway.
    floorParts.push(box(pal, '#B9BCC4', 0.12, 0.08, L.aisle.z1 - L.aisle.z0, ox + L.aisle.x1 + 0.06, 0, oz + (L.aisle.z0 + L.aisle.z1) / 2));
    floorParts.push(box(pal, '#B9BCC4', L.aisle.x1 - L.bays[0]!.x + 1.0, 0.08, 0.12, ox + (L.aisle.x1 + L.bays[0]!.x - 0.9) / 2, 0, oz + L.aisle.z0 - 0.06));
    // A small flower bed on the west lawn (flowers and bushes are placed by the town plan).
    floorParts.push(box(pal, '#B58A5C', 1.4, 0.05, 2.2, ox + L.plot.x0 + 1.5, 0, oz - 2.6));
    // Plinth under the whole building so walls never float.
    floorParts.push(box(pal, SLATE, f.x1 - f.x0 + 0.3, 0.04, f.z1 - s.z0 + 0.3, ox + (f.x0 + f.x1) / 2, -0.03, oz + (s.z0 + f.z1) / 2));
    const floorMesh = new Mesh(merge(floorParts), this.assets.material);
    floorMesh.receiveShadow = true;
    this.shell.add(floorMesh);
    // Warm light spill over the floors at night.
    const glow = new PlaneGeometry(f.x1 - f.x0 + 1.2, f.z1 - s.z0 + 1.6);
    glow.rotateX(-Math.PI / 2);
    glow.translate(ox + (f.x0 + f.x1) / 2, 0.045, oz + (s.z0 + f.z1) / 2 + 0.3);
    this.nightGlow = new Mesh(glow, this.nightMat);
    this.nightGlow.visible = false;
    this.shell.add(this.nightGlow);

    // Walls: four sides, each with a full and a ledge version.
    const side = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number, gaps: number[], windows: boolean) => {
      const len = Math.hypot(bx - ax, bz - az);
      const yaw = Math.atan2(bx - ax, bz - az) + Math.PI / 2; // wall runs along its local x
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      const full: BufferGeometry[] = [], ledge: BufferGeometry[] = [];
      for (let i = 0; i < len; i++) {
        const t = i + 0.5 - len / 2;
        const along = { x: ax + ((bx - ax) / len) * (i + 0.5), z: az + ((bz - az) / len) * (i + 0.5) };
        const isGap = gaps.some((g) => Math.abs(g - (nx !== 0 ? along.z : along.x)) < 0.5);
        if (isGap) {
          // Door frame: Kenney glass door, full height in both modes.
          const door = this.assets.geometry('market/wall-door').clone();
          const doorGlass = this.assets.glassGeometry('market/wall-door');
          place(door, t, 0, -0.0, 0);
          full.push(door); ledge.push(door.clone());
          if (doorGlass) { const g = doorGlass.clone(); place(g, t, 0, 0, 0); this.shell.add(new Mesh(place(g, cx, 0, cz, yaw), this.assets.glass)); }
          continue;
        }
        // Full wall: white body, baseboard, green stripe, maybe a window.
        if (windows) {
          full.push(box(pal, WHITE, 1, 0.3, WALL_THICK, t, 0, 0));
          full.push(box(pal, WHITE, 1, WALL_HEIGHT - 0.86, WALL_THICK, t, 0.86, 0));
          full.push(box(pal, WHITE, 0.08, 0.56, WALL_THICK, t - 0.46, 0.3, 0));
          full.push(box(pal, WHITE, 0.08, 0.56, WALL_THICK, t + 0.46, 0.3, 0));
          const glass = new PlaneGeometry(0.84, 0.56);
          glass.translate(t, 0.58, 0);
          this.shell.add(new Mesh(place(glass, cx, 0, cz, yaw), this.assets.glass));
        } else {
          full.push(box(pal, WHITE, 1, WALL_HEIGHT, WALL_THICK, t, 0, 0));
          full.push(box(pal, GREEN, 1.002, STRIPE_TOP - STRIPE_BOTTOM, WALL_THICK + 0.01, t, STRIPE_BOTTOM, 0));
        }
        full.push(box(pal, SLATE, 1.002, 0.06, WALL_THICK + 0.012, t, 0, 0));
        // Ledge: short wall with a green cap.
        ledge.push(box(pal, WHITE, 1, LEDGE_HEIGHT, WALL_THICK, t, 0, 0));
        ledge.push(box(pal, SLATE, 1.002, 0.06, WALL_THICK + 0.012, t, 0, 0));
        ledge.push(box(pal, GREEN, 1.002, 0.05, WALL_THICK + 0.02, t, LEDGE_HEIGHT - 0.05, 0));
      }
      const fullMesh = new Mesh(place(merge(full), cx, 0, cz, yaw), this.assets.material);
      const ledgeMesh = new Mesh(place(merge(ledge), cx, 0, cz, yaw), this.assets.material);
      fullMesh.castShadow = true; fullMesh.receiveShadow = true; ledgeMesh.castShadow = true; ledgeMesh.receiveShadow = true;
      this.shell.add(fullMesh, ledgeMesh);
      this.sides.push({ full: fullMesh, ledge: ledgeMesh, nx, nz });
    };
    // Front (faces +z), with the door and windows.
    side(ox + f.x0, oz + f.z1, ox + f.x1, oz + f.z1, 0, 1, [ox + shop.door.x], true);
    // Back (faces -z) with the back door.
    side(ox + f.x1, oz + s.z0, ox + f.x0, oz + s.z0, 0, -1, [ox + shop.backDoor.x], false);
    // West (faces -x).
    side(ox + f.x0, oz + f.z1, ox + f.x0, oz + s.z0, -1, 0, [], false);
    // East (faces +x).
    side(ox + f.x1, oz + s.z0, ox + f.x1, oz + f.z1, 1, 0, [], false);
    // Partition between shop and storeroom: always a half wall with a doorway at the east end.
    const partParts: BufferGeometry[] = [];
    for (let x = f.x0; x < f.x1 - 1; x++) {
      partParts.push(box(pal, WHITE, 1, LEDGE_HEIGHT + 0.15, WALL_THICK, ox + x + 0.5, 0, oz + f.z0));
      partParts.push(box(pal, GREEN, 1.002, 0.05, WALL_THICK + 0.02, ox + x + 0.5, LEDGE_HEIGHT + 0.1, oz + f.z0));
    }
    partParts.push(box(pal, SLATE, 0.08, 1.0, 0.1, ox + f.x1 - 1, 0, oz + f.z0));
    partParts.push(box(pal, SLATE, 0.08, 1.0, 0.1, ox + f.x1, 0, oz + f.z0));
    partParts.push(box(pal, SLATE, 1.08, 0.08, 0.1, ox + f.x1 - 0.5, 1.0, oz + f.z0));
    const part = new Mesh(merge(partParts), this.assets.material);
    part.castShadow = true; part.receiveShadow = true;
    this.shell.add(part);

    // Awnings: a low one on the ledge (always, so the front keeps its stripes without hiding the floor)
    // and a high one under the fascia when the front wall is shown at full height.
    const width = f.x1 - f.x0;
    const fz = oz + f.z1 + 0.12;
    const awning = (y: number): BufferGeometry[] => {
      const parts: BufferGeometry[] = [];
      for (const sideSign of [-1, 1]) {
        const ax0 = ox + (sideSign < 0 ? f.x0 + 0.12 : shop.door.x + 0.6);
        const ax1 = ox + (sideSign < 0 ? shop.door.x - 0.6 : f.x1 - 0.12);
        let k = 0;
        for (let x = ax0; x < ax1 - 0.01; x += 0.3, k++) {
          const w = Math.min(0.3, ax1 - x);
          const g = box(pal, k % 2 ? WHITE : GREEN, w, 0.04, 0.46, 0, 0, 0);
          g.rotateX(0.38);
          g.translate(x + w / 2, y, fz + 0.2);
          parts.push(g);
        }
      }
      return parts;
    };
    const lowAwning = new Mesh(merge(awning(LEDGE_HEIGHT + 0.08)), this.assets.material);
    lowAwning.castShadow = true;
    this.shell.add(lowAwning);
    const front = this.sides[0]!;
    // Fascia (full-height front only): slate board with the name, high awning.
    const fascia: BufferGeometry[] = [];
    fascia.push(box(pal, SLATE, width + 0.2, 0.62, 0.16, ox + (f.x0 + f.x1) / 2, 1.0, fz));
    fascia.push(box(pal, GREEN, width + 0.24, 0.06, 0.2, ox + (f.x0 + f.x1) / 2, 1.6, fz));
    fascia.push(box(pal, GREEN, width + 0.24, 0.05, 0.2, ox + (f.x0 + f.x1) / 2, 0.96, fz));
    fascia.push(...awning(0.9));
    const name = shop.name.toUpperCase();
    const h = Math.min(0.4, ((width - 0.5) * 7) / (6 * Math.max(1, name.length)));
    const fasciaLetters = textGeometry(pal, name, h, 0.06, CREAM, YELLOW);
    place(fasciaLetters, ox + (f.x0 + f.x1) / 2, 1.0 + 0.31 - h / 2, fz + 0.11, 0);
    fascia.push(fasciaLetters);
    const fasciaMesh = new Mesh(merge(fascia), this.assets.material);
    fasciaMesh.castShadow = true;
    this.shell.add(fasciaMesh);
    front.extraFull = [fasciaMesh];
    // Pylon sign on the front lawn by the sidewalk: the name reads from the street in every view.
    const px = ox + 2.9, pz = oz + 2.05;
    const boardW = 3.0;
    const pylon: BufferGeometry[] = [];
    pylon.push(box(pal, SLATE, 0.12, 0.95, 0.12, px - boardW / 2 + 0.2, 0, pz));
    pylon.push(box(pal, SLATE, 0.12, 0.95, 0.12, px + boardW / 2 - 0.2, 0, pz));
    pylon.push(box(pal, SLATE, boardW, 0.62, 0.14, px, 0.9, pz));
    pylon.push(box(pal, GREEN, boardW + 0.06, 0.06, 0.18, px, 1.5, pz));
    pylon.push(box(pal, GREEN, boardW + 0.06, 0.05, 0.18, px, 0.86, pz));
    const ph = Math.min(0.34, ((boardW - 0.3) * 7) / (6 * Math.max(1, name.length)));
    for (const sideYaw of [0, Math.PI]) {
      const letters = textGeometry(pal, name, ph, 0.05, CREAM, YELLOW);
      place(letters, px, 0.9 + 0.31 - ph / 2, pz + (sideYaw === 0 ? 0.09 : -0.09), sideYaw);
      pylon.push(letters);
      const bracket = box(pal, GREEN, Math.min(boardW - 0.4, textWidth(name, ph) + 0.2), 0.03, 0.04, px, 0.9 + 0.31 - ph / 2 - 0.06, pz + (sideYaw === 0 ? 0.08 : -0.08));
      pylon.push(bracket);
    }
    this.signMesh = new Mesh(merge(pylon), this.assets.material);
    this.signMesh.castShadow = true;
    this.shell.add(this.signMesh);
    this.layoutVersion = -1;
    this.stockKey = '';
  }

  /** Per-frame: ledge toggling, fixtures, products, boxes. */
  update(state: GameState, cameraYaw: number): void {
    const shop = state.shop;
    if (shop.name !== this.shopName || shop.originX !== this.origin.x) this.buildShell(shop);
    const sx = Math.sin(cameraYaw), cz = Math.cos(cameraYaw);
    for (const s of this.sides) {
      const facing = s.nx * sx + s.nz * cz > 0.25;
      s.full.visible = !facing; s.ledge.visible = facing;
      if (s.extraFull) for (const m of s.extraFull) m.visible = !facing;
    }
    if (shop.layoutVersion !== this.layoutVersion) { this.rebuildFixtures(shop); this.layoutVersion = shop.layoutVersion; this.stockKey = ''; }
    const key = stockKey(shop);
    if (key !== this.stockKey) { this.rebuildProducts(shop); this.rebuildBoxes(shop); this.stockKey = key; }
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
    for (const f of shop.fixtures) { const id = FIXTURE_MODEL[f.type]; const arr = byModel.get(id) ?? []; arr.push(f); byModel.set(id, arr); }
    const m = new Matrix4();
    for (const [model, list] of byModel) {
      const stack = model === 'market/shopping-basket' ? 3 : 1;
      const mesh = new InstancedMesh(this.assets.geometry(model), this.assets.material, list.length * stack);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const ids: number[] = [];
      list.forEach((f, i) => {
        for (let s = 0; s < stack; s++) { mesh.setMatrixAt(i * stack + s, this.fixtureMatrix(shop, f, m, s * 0.09, true)); ids.push(f.id); }
      });
      mesh.userData.fixtureIds = ids;
      this.group.add(mesh);
      this.fixtureMeshes.set(model, { mesh, ids });
      // Glass parts of the fixture model (fridge doors) as a second instanced mesh.
      const glass = this.assets.glassGeometry(model);
      if (glass) {
        const gm = new InstancedMesh(glass, this.assets.glass, list.length);
        list.forEach((f, i) => gm.setMatrixAt(i, this.fixtureMatrix(shop, f, m, 0, true)));
        this.group.add(gm);
        this.fixtureMeshes.set(model + ':glass', { mesh: gm, ids: [] });
      }
    }
    // Register screens, fridge glow.
    let si = 0, gi = 0;
    for (const f of shop.fixtures) {
      if (f.type === 'register' || f.type === 'kiosk') {
        this.fixtureMatrix(shop, f, m);
        this.dummy.position.set(0.12, 0.52, 0.3).applyMatrix4(m);
        this.dummy.rotation.set(-0.35, f.rot * Math.PI / 2 + Math.PI, 0, 'YXZ');
        this.dummy.updateMatrix(); this.screens.setMatrixAt(si++, this.dummy.matrix);
      }
      if (f.type === 'fridge' || f.type === 'freezer') {
        this.fixtureMatrix(shop, f, m);
        this.dummy.position.set(0, 0.45, -0.18).applyMatrix4(m);
        this.dummy.rotation.set(0, f.rot * Math.PI / 2, 0);
        this.dummy.updateMatrix(); this.glowPanels.setMatrixAt(gi, this.dummy.matrix);
        this.dummy.position.set(0, 0.03, 0.52).applyMatrix4(m);
        this.dummy.rotation.set(-Math.PI / 2, 0, f.rot * Math.PI / 2, 'ZYX');
        this.dummy.updateMatrix(); this.glowFloor.setMatrixAt(gi, this.dummy.matrix);
        gi++;
      }
    }
    this.screens.count = si; this.screens.instanceMatrix.needsUpdate = true;
    this.glowPanels.count = gi; this.glowPanels.instanceMatrix.needsUpdate = true;
    this.glowFloor.count = gi; this.glowFloor.instanceMatrix.needsUpdate = true;
  }

  private rebuildProducts(shop: Shop): void {
    const counts = new Map<Shape, number>();
    for (const p of this.productMeshes.values()) { p.body.count = 0; p.accent.count = 0; }
    const m = new Matrix4();
    const color = new Color();
    for (const f of shop.fixtures) {
      const layout = SLOT_LAYOUT[f.type];
      if (!layout) continue;
      this.fixtureMatrix(shop, f, m);
      const cap = FIXTURES[f.type].capacity;
      f.slots.forEach((slot, si) => {
        if (!slot.productId || slot.qty <= 0) return;
        const def = productDef(slot.productId);
        const geo = this.shapes[def.shape];
        const pm = this.productMeshes.get(def.shape)!;
        const tier = layout.tiers[Math.floor(si / layout.cols.length) % layout.tiers.length]!;
        const colX = layout.cols[si % layout.cols.length]!;
        const colW = 0.8 / layout.cols.length / (f.type === 'fridge' ? 1 : 1);
        const across = Math.max(1, Math.min(layout.across, Math.floor(colW / (geo.w + 0.02))));
        const deep = Math.max(1, Math.ceil(cap / across));
        const dz = deep > 1 ? (layout.frontZ - layout.backZ) / (deep - 1) : 0;
        const n = Math.min(slot.qty, cap);
        for (let i = 0; i < n; i++) {
          const row = Math.floor(i / across), col = i % across;
          const lx = colX + (col - (across - 1) / 2) * (geo.w + 0.02);
          const lz = layout.frontZ - row * dz;
          const idx = (counts.get(def.shape) ?? 0);
          if (idx >= 900) break;
          this.dummy.position.set(lx, tier, lz).applyMatrix4(m);
          this.dummy.rotation.set(0, f.rot * Math.PI / 2 + ((i * 7 + si * 3) % 5 - 2) * 0.05, 0);
          this.dummy.scale.set(1, 1, 1);
          this.dummy.updateMatrix();
          pm.body.setMatrixAt(idx, this.dummy.matrix); pm.accent.setMatrixAt(idx, this.dummy.matrix);
          pm.body.setColorAt(idx, color.set(def.color)); pm.accent.setColorAt(idx, color.set(def.accent));
          counts.set(def.shape, idx + 1);
        }
      });
    }
    for (const [shape, pm] of this.productMeshes) {
      const c = counts.get(shape) ?? 0;
      pm.body.count = c; pm.accent.count = c;
      pm.body.instanceMatrix.needsUpdate = true; pm.accent.instanceMatrix.needsUpdate = true;
      if (pm.body.instanceColor) pm.body.instanceColor.needsUpdate = true;
      if (pm.accent.instanceColor) pm.accent.instanceColor.needsUpdate = true;
    }
  }

  private rebuildBoxes(shop: Shop): void {
    const units = shop.storage.reduce((a, e) => a + e.qty, 0);
    const n = Math.min(64, Math.ceil(units / 6));
    const s = shop.storeroom;
    const ox = shop.originX, oz = shop.originZ;
    const cols = Math.max(1, Math.floor((s.x1 - s.x0 - 1.4) / 0.36));
    for (let i = 0; i < n; i++) {
      const layer = Math.floor(i / (cols * 2));
      const j = i % (cols * 2);
      const col = j % cols, row = Math.floor(j / cols);
      this.dummy.position.set(ox + s.x0 + 0.3 + col * 0.36, layer * 0.23, oz + s.z0 + 0.3 + row * 0.36);
      this.dummy.rotation.set(0, ((i * 13) % 7 - 3) * 0.06, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.boxes.setMatrixAt(i, this.dummy.matrix);
    }
    this.boxes.count = n; this.boxes.instanceMatrix.needsUpdate = true;
  }

  /** Raycast fixtures, then the shop floor. */
  pick(ray: Raycaster, shop: Shop): StoreHit | null {
    const meshes = [...this.fixtureMeshes.values()].filter((e) => e.ids.length).map((e) => e.mesh);
    const hits = ray.intersectObjects(meshes, false);
    if (hits.length) {
      const h = hits[0]!;
      const ids = (h.object as InstancedMesh).userData.fixtureIds as number[];
      const id = ids[h.instanceId ?? 0];
      const f = shop.fixtures.find((x) => x.id === id);
      if (f) return { kind: 'fixture', id: f.id, type: f.type };
    }
    const t = -ray.ray.origin.y / ray.ray.direction.y;
    if (t > 0) {
      const p = new Vector3().copy(ray.ray.origin).addScaledVector(ray.ray.direction, t);
      return { kind: 'floor', x: p.x, z: p.z };
    }
    return null;
  }

  /** Debug: instanced fixture meshes and their counts. */
  debugFixtures(): unknown {
    return [...this.fixtureMeshes.entries()].map(([k, v]) => ({ model: k, count: v.mesh.count, ids: v.ids, visible: v.mesh.visible }));
  }

  /** World position of a fixture's top, for tip anchors. */
  anchor(shop: Shop, f: Fixture): Vector3 {
    return new Vector3(shop.originX + f.x + 0.5, 1.0, shop.originZ + f.z + 0.5);
  }
}

function stockKey(shop: Shop): string {
  let k = `${shop.layoutVersion}|`;
  for (const f of shop.fixtures) for (const s of f.slots) k += `${s.productId ?? '-'}:${s.qty},`;
  k += '|' + shop.storage.reduce((a, e) => a + e.qty, 0);
  return k;
}

export { DoubleSide };
