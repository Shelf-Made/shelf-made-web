import { Group, Mesh, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WINDOW_GLOW, SPILL, spillGeometry } from './glow';
import { cornerProps } from './dressing';
import { trolleyShelterGeometry, posterGeometry, buntingGeometry, PROP_MODELS } from './props';
import type { AssetLibrary } from './assets';
import type { GameState } from '@/sim/types';
import type { TownPlan, RivalSite } from './town';
import { MAIN_N, PAVEMENT } from './town';
import { box, merge, place } from './geometry';
import { textGeometry } from './letters';
import { CORNERS, PLOT_RECT, ROAD_Z, WALL_T, lotLayout, rectToWorld, type Rect } from '@/sim/layout';
import { rivalShape } from '@/sim/rivals';
import { rivalScheme, RIVAL_SCHEMES, type Scheme } from '@/sim/schemes';

/** Each rival's fixed colours live with the sim's schemes (bags use them too); the lettering face is the accent. */
export { RIVAL_SCHEMES } from '@/sim/schemes';

/** Models the rival sites use beyond the shop's own. */
export const RIVAL_MODELS = ['market/shopping-cart', 'roads/cone', 'roads/dumpster', 'suburban/fence', 'furniture/bench', 'furniture/trashcan', ...PROP_MODELS];

/** Frontage maths as if every shop faced south (the root carries the real frame). */
const NORTH_Z = -1.6;
const SW_IN = MAIN_N[0] - NORTH_Z, SW_OUT = MAIN_N[1] - NORTH_Z, KERB = ROAD_Z - 1.0 - NORTH_Z;

interface Site {
  id: string; corner: string; key: string; root: Group;
  lot: Group; build: Group; open: Group;
  sale: Mesh; soon: Mesh; forSale: Mesh; name: Mesh; windows: Mesh; spill: Mesh; posters: Mesh; salePosters: Mesh; bunting: Mesh;
  /** The building at full height and as waist-high stubs (when it would hide the manager), and its footprint. */
  full: Mesh; stub: Mesh; footprint: Rect;
}

type Letters = (text: string, size: number, depth: number, face?: string, side?: string, bevel?: boolean) => BufferGeometry;

/** Four walls as four boxes, WALL_T thick round the floor, to a height; the front has the door gap at x = 0. */
function shell(pal: Parameters<typeof box>[0], f: Rect, backZ: number, h: number, hex: string): BufferGeometry[] {
  const T = WALL_T, cz = (f.z1 + backZ) / 2, D = f.z1 - backZ + 2 * T;
  return [
    box(pal, hex, -0.5 - (f.x0 - T), h, T, (f.x0 - T - 0.5) / 2, 0, f.z1 + T / 2),
    box(pal, hex, f.x1 + T - 0.5, h, T, (f.x1 + T + 0.5) / 2, 0, f.z1 + T / 2),
    box(pal, hex, f.x1 - f.x0 + 2 * T, h, T, (f.x0 + f.x1) / 2, 0, backZ - T / 2),
    box(pal, hex, T, h, D, f.x0 - T / 2, 0, cz),
    box(pal, hex, T, h, D, f.x1 + T / 2, 0, cz),
    ...(h > 0.8 ? [box(pal, hex, 1, h - 0.74, T, 0, 0.74, f.z1 + T / 2)] : []),
  ];
}

/**
 * The rivals' corners. Before a rival opens: a fenced lot with a "Coming soon" board, then (the
 * last two days) a half-built shop in scaffolding. Open: a proper storefront in its colours, with
 * its name on the fascia and a pylon, lit windows at night, its own parking lot (its customers'
 * cars park there, from the sim), and a SALE banner facing the road while it runs one.
 */
export class RivalsView {
  readonly group = new Group();
  private sites: Site[] = [];
  private night = false;
  constructor(private readonly assets: AssetLibrary, private readonly letters: Letters | null = null) {}

  build(plan: TownPlan): void {
    this.group.clear(); this.sites = [];
    // As the town starts: each rival in its own colours (the same key update() expects for it).
    for (const r of plan.rivals) { const site = this.site(r, RIVAL_SCHEMES[r.kind], r.name); site.key = `${r.id}|${r.name}|${RIVAL_SCHEMES[r.kind].id}|false`; this.sites.push(site); }
  }

  setNight(on: boolean): void { this.night = on; }

  /** What stands on a corner now: a rival, a challenger in its own colours, or the player's branch in theirs. */
  private want(state: GameState, r: GameState['rivals'][number]): { name: string; scheme: Scheme; key: string } {
    const bought = r.boughtDay !== undefined;
    const name = bought ? (state.franchises.find((f) => f.corner === r.corner)?.name ?? state.shop.name) : r.name;
    const scheme = rivalScheme(state, r);
    return { name, scheme, key: `${r.id}|${name}|${scheme.id}|${bought}` };
  }
  /** A rival's building between the camera and the manager drops to stubs, like the player's walls. */
  occlude(cam: { x: number; y: number; z: number } | null, mx: number, mz: number): void {
    for (const s of this.sites) {
      let hit = false;
      if (cam) {
        // Sample the sight line from the camera down to the manager's chest; blocked where it passes under the roofline.
        for (let i = 1; i < 16 && !hit; i++) {
          const t = i / 16, x = cam.x + (mx - cam.x) * t, z = cam.z + (mz - cam.z) * t, y = cam.y + (0.45 - cam.y) * t;
          hit = y < 1.2 && x > s.footprint.x0 && x < s.footprint.x1 && z > s.footprint.z0 && z < s.footprint.z1;
        }
      }
      s.full.visible = !hit; s.stub.visible = hit;
    }
  }

  update(state: GameState): void {
    for (const r of state.rivals) {
      let s = this.sites.find((x) => x.corner === r.corner);
      const w = this.want(state, r);
      // A challenger moved in, or the player bought the corner: put the building up again in its new colours.
      if (s && s.key !== w.key) {
        this.group.remove(s.root); s.root.traverse((o) => { if ((o as Mesh).isMesh) (o as Mesh).geometry.dispose(); });
        this.sites.splice(this.sites.indexOf(s), 1);
        s = undefined;
      }
      if (!s) { s = this.site({ id: r.id, name: w.name, kind: r.kind, corner: r.corner }, w.scheme, w.name); s.key = w.key; this.sites.push(s); }
      const bought = r.boughtDay !== undefined, closed = r.closedDay !== undefined && !bought;
      // A challenger fits out the old building: it stays up, signless, behind a "coming soon" board.
      const trading = r.open || bought;
      const stage = trading || closed || r.challenger ? 'open' : state.day >= r.opensDay - 2 ? 'build' : 'lot';
      s.lot.visible = stage === 'lot'; s.build.visible = stage === 'build'; s.open.visible = stage === 'open';
      s.soon.visible = !trading && !closed;
      s.forSale.visible = closed;
      s.name.visible = trading;
      s.sale.visible = r.open && r.saleDaysLeft > 0;
      s.salePosters.visible = s.sale.visible; s.posters.visible = trading && !s.sale.visible;
      s.bunting.visible = (r.open && state.day <= r.opensDay) || (bought && state.day <= (r.boughtDay ?? 0) + 1);
      s.windows.visible = trading && this.night;
      s.spill.visible = trading && this.night;
    }
  }

  private text(text: string, size: number, face: string, side: string): BufferGeometry {
    return this.letters ? this.letters(text, size, 0.05, face, side, false) : textGeometry(this.assets.palette, text, size, 0.05, face, side);
  }

  private site(r: RivalSite, sc: Scheme, label: string): Site {
    const pal = this.assets.palette;
    const c = CORNERS[r.corner];
    const root = new Group();
    root.position.set(c.originX, 0, c.originZ);
    root.rotation.set(0, c.flip ? Math.PI : 0, 0);
    this.group.add(root);
    const shape = rivalShape({ sizeId: r.kind === 'chain' ? 'large' : 'medium', lotRows: r.kind === 'chain' ? 2 : 1 });
    const L = lotLayout(shape);
    const f = shape.floor, backZ = Math.min(f.z0, shape.storeroom.z0);
    const mesh = (parts: BufferGeometry[], cast = true) => { const m = new Mesh(merge(parts), this.assets.material); m.castShadow = cast; m.receiveShadow = true; return m; };

    // ---- Always: the frontage sidewalk with dropped kerbs where the lot meets the road.
    const ground: BufferGeometry[] = [];
    const slab = (q: Rect, hex: string, h = 0.03, y = -0.012) => ground.push(box(pal, hex, q.x1 - q.x0, h, q.z1 - q.z0, (q.x0 + q.x1) / 2, y, (q.z0 + q.z1) / 2));
    const cuts = [[L.serviceLane.x0, L.serviceLane.x1], [L.driveway.x0, L.driveway.x1]].sort((a, b) => a[0]! - b[0]!);
    let sx = PLOT_RECT.x0;
    for (const [c0, c1] of cuts) { if (c0! > sx) slab({ x0: sx, z0: SW_IN, x1: c0!, z1: SW_OUT }, PAVEMENT, 0.06); sx = c1!; }
    slab({ x0: sx, z0: SW_IN, x1: PLOT_RECT.x1, z1: SW_OUT }, PAVEMENT, 0.06);
    for (const [c0, c1] of cuts) slab({ x0: c0!, z0: SW_IN, x1: c1!, z1: SW_OUT }, '#B9BCC4', 0.034, -0.01);
    root.add(Object.assign(mesh(ground, false), { name: 'rival-ground' }));

    // ---- Stage 1: a fenced, grassy lot with a "Coming soon" board.
    const lot = new Group();
    { const g: BufferGeometry[] = [];
      const fx0 = PLOT_RECT.x0 + 0.6, fx1 = PLOT_RECT.x1 - 0.6, fz0 = PLOT_RECT.z0 + 0.6, fz1 = SW_IN - 0.4;
      const fence = this.assets.has('suburban/fence') ? this.assets.geometry('suburban/fence') : null;
      if (fence) {
        for (let x = fx0 + 0.71; x <= fx1 - 0.7; x += 1.42) { g.push(place(fence.clone(), x, 0, fz1)); g.push(place(fence.clone(), x, 0, fz0)); }
        for (let z = fz0 + 0.71; z <= fz1 - 0.7; z += 1.42) { g.push(place(fence.clone(), fx0, 0, z, Math.PI / 2)); g.push(place(fence.clone(), fx1, 0, z, Math.PI / 2)); }
      }
      lot.add(Object.assign(mesh(g), { name: 'rival-lot' }));
      root.add(lot); }

    // ---- Stage 2: the shop half built: walls to waist height, scaffolding, cones, a skip.
    const build = new Group();
    { const g: BufferGeometry[] = [];
      g.push(...shell(pal, f, backZ, 0.45, '#D9D4CB'));
      // Scaffold poles and planks round the front and sides.
      for (let x = f.x0 - 0.6; x <= f.x1 + 0.61; x += 1.0) { g.push(box(pal, '#9AA0A8', 0.05, 1.6, 0.05, x, 0, f.z1 + 1.0)); }
      for (const y of [0.55, 1.1]) g.push(box(pal, '#C8925A', f.x1 - f.x0 + 1.3, 0.05, 0.36, (f.x0 + f.x1) / 2, y, f.z1 + 0.85));
      g.push(box(pal, '#9AA0A8', f.x1 - f.x0 + 1.3, 0.04, 0.04, (f.x0 + f.x1) / 2, 1.5, f.z1 + 1.0));
      for (let i = 0; i < 6; i++) g.push(place(this.assets.geometry('roads/cone').clone(), L.driveway.x0 + 0.3 + (i % 3) * 0.6, 0, 0.6 + Math.floor(i / 3) * 0.6));
      if (this.assets.has('roads/dumpster')) g.push(place(this.assets.geometry('roads/dumpster').clone(), L.backYard.x1 - 1, 0, L.backYard.z0 + 0.7, Math.PI / 2));
      // A slab poured for the floor.
      g.push(box(pal, '#C4C0B8', f.x1 - f.x0, 0.05, f.z1 - backZ, (f.x0 + f.x1) / 2, -0.03, (f.z1 + backZ) / 2));
      build.add(Object.assign(mesh(g), { name: 'rival-build' }));
      root.add(build); }

    // ---- Stage 3: open for business.
    const open = new Group();
    const lit: BufferGeometry[] = [];
    const posters: BufferGeometry[] = [], salePosters: BufferGeometry[] = [];
    const nameParts: BufferGeometry[] = [];
    const wallsFull: BufferGeometry[] = [], wallsStub: BufferGeometry[] = [];
    { const g: BufferGeometry[] = [];
      // Lot: apron, walkway, aisle, driveway, service lane, yard, bays painted in the brand's accent.
      const pave: BufferGeometry[] = [];
      const sl = (q: Rect, hex: string, h = 0.03) => pave.push(box(pal, hex, q.x1 - q.x0, h, q.z1 - q.z0, (q.x0 + q.x1) / 2, -0.012, (q.z0 + q.z1) / 2));
      sl({ ...L.apron, z0: WALL_T - 0.02, x1: Math.min(L.apron.x1, L.driveway.x0) }, '#CFCBC2', 0.04);
      sl({ x0: L.walkwayX - 0.5, z0: L.apron.z1 - 0.02, x1: L.walkwayX + 0.5, z1: SW_IN + 0.02 }, '#CFCBC2', 0.04);
      sl({ ...L.aisle, z1: L.driveway.z0 + 0.02 }, '#6E717C'); sl({ ...L.driveway, z1: KERB }, '#6E717C'); sl({ ...L.serviceLane, z1: KERB }, '#6E717C'); sl(L.backYard, '#6E717C');
      const paint = sc.accent === '#FFFFFF' || sc.accent === '#FFF3DC' ? sc.accent : sc.accent;
      for (const b of L.bays) {
        sl({ x0: b.x - 0.85, z0: b.z - 0.55, x1: b.x + 0.85, z1: b.z + 0.55 }, '#6E717C');
        pave.push(box(pal, paint, 1.6, 0.004, 0.05, b.x, 0.02, b.z - 0.55), box(pal, paint, 1.6, 0.004, 0.05, b.x, 0.02, b.z + 0.55));
      }
      open.add(Object.assign(mesh(pave, false), { name: 'rival-pave' }));
      // Walls: plain boxes (the roof hides the rest), a plinth in the brand's colour, windows and a door on the front.
      wallsFull.push(...shell(pal, f, backZ, 1.0, '#F2EEE6'));
      wallsStub.push(...shell(pal, f, backZ, 0.3, '#F2EEE6'));
      const fz0 = f.z1 + WALL_T;
      wallsFull.push(box(pal, sc.primary, f.x1 - f.x0 + 2 * WALL_T + 0.02, 0.12, 0.04, (f.x0 + f.x1) / 2, 0, fz0 + 0.01));
      for (let x = f.x0 + 0.5; x < f.x1; x++) {
        if (Math.abs(x) < 0.01) {
          wallsFull.push(box(pal, '#5B8FB0', 0.7, 0.72, 0.03, x, 0, fz0 + 0.02), box(pal, '#38383D', 0.04, 0.72, 0.05, x, 0, fz0 + 0.03));
          continue;
        }
        wallsFull.push(box(pal, '#7FB2D0', 0.7, 0.42, 0.03, x, 0.24, fz0 + 0.02));
        lit.push(box(pal, '#FFE6A8', 0.62, 0.42, 0.02, x, 0.24, fz0 + 0.04));
      }
      for (let z = backZ + 1; z < f.z1 - 0.5; z += 2) for (const sx of [-1, 1]) {
        const wx = sx < 0 ? f.x0 - WALL_T : f.x1 + WALL_T;
        wallsFull.push(box(pal, '#7FB2D0', 0.03, 0.36, 0.6, wx + sx * 0.02, 0.4, z));
      }
      // Roof: a flat deck with a parapet in the brand's trim.
      const W = f.x1 - f.x0 + 2 * WALL_T, D = f.z1 - backZ + 2 * WALL_T, cx = (f.x0 + f.x1) / 2, cz = (f.z1 + backZ) / 2;
      wallsFull.push(box(pal, '#9AA0A8', W, 0.06, D, cx, 1.0, cz));
      wallsFull.push(box(pal, sc.trim, W + 0.06, 0.12, 0.08, cx, 1.0, f.z1 + WALL_T), box(pal, sc.trim, W + 0.06, 0.12, 0.08, cx, 1.0, backZ - WALL_T));
      wallsFull.push(box(pal, sc.trim, 0.08, 0.12, D, f.x0 - WALL_T, 1.0, cz), box(pal, sc.trim, 0.08, 0.12, D, f.x1 + WALL_T, 1.0, cz));
      // A rooftop unit or two.
      wallsFull.push(box(pal, '#B9BCC4', 0.6, 0.3, 0.5, cx - W / 4, 1.06, cz - D / 5), box(pal, '#B9BCC4', 0.5, 0.25, 0.5, cx + W / 5, 1.06, cz + D / 6));
      // Awning in the brand's colours over the windows, and the fascia with the name.
      const fz = f.z1 + WALL_T + 0.02;
      let k = 0;
      for (let x = f.x0; x < f.x1 - 0.01; x += 0.25, k++) {
        if (Math.abs(x + 0.125) < 0.55) continue;
        const a = box(pal, k % 2 ? sc.accent : sc.primary, 0.25, 0.035, 0.42, 0, 0, 0);
        a.rotateX(0.42); a.translate(x + 0.125, 0.86, fz + 0.18); g.push(a);
      }
      const width = f.x1 - f.x0;
      g.push(box(pal, sc.primary, width + 0.5, 0.5, 0.1, cx, 1.0, fz - 0.02), box(pal, sc.trim, width + 0.54, 0.05, 0.14, cx, 1.48, fz - 0.02));
      const size = Math.min(0.3, (width - 0.6) / Math.max(4, label.length * 0.62));
      nameParts.push(place(this.text(label, size, sc.accent, sc.trim), cx, 1.25 - size * 0.4, fz + 0.04));
      // Pylon by the sidewalk, readable both ways down Main Road.
      const px = -L.halfW - 0.6, pz = 1.85, bw = 2.6;
      g.push(box(pal, '#38383D', 0.12, 1.5, 0.12, px - bw / 2 + 0.2, 0, pz), box(pal, '#38383D', 0.12, 1.5, 0.12, px + bw / 2 - 0.2, 0, pz), box(pal, sc.primary, bw, 0.55, 0.12, px, 1.0, pz), box(pal, sc.trim, bw + 0.06, 0.05, 0.16, px, 1.55, pz));
      const ps = Math.min(0.26, (bw - 0.35) / Math.max(4, label.length * 0.62));
      for (const yaw of [0, Math.PI]) nameParts.push(place(this.text(label, ps, sc.accent, sc.trim), px, 1.24 - ps * 0.4, pz + (yaw === 0 ? 0.07 : -0.07), yaw));
      // Street dressing on the lawn beside the paths (MegaMart has a trolley shelter with trolleys under it).
      for (const pr of cornerProps({ ...shape, door: { x: 0, z: f.z1 } }, r.kind === 'chain' ? 2 : 1, { trolleys: r.kind === 'chain' })) {
        const geo = pr.model === 'generated/trolley-shelter' ? trolleyShelterGeometry(pal, sc.primary) : this.assets.has(pr.model) ? this.assets.geometry(pr.model).clone() : null;
        if (!geo) continue;
        g.push(place(geo, pr.x, 0, pr.z, pr.yaw, pr.scale ?? 1, pr.scale ?? 1, pr.scale ?? 1));
        if (pr.model === 'generated/trolley-shelter' && this.assets.has('market/shopping-cart')) for (let i = 0; i < 3; i++) g.push(place(this.assets.geometry('market/shopping-cart').clone(), pr.x - 0.25 + i * 0.25, 0, pr.z, pr.yaw + Math.PI / 2));
      }
      // Posters in the windows: the brand's offers on a normal day, big SALE sheets while a sale runs.
      const winXs: number[] = []; for (let x = f.x0 + 0.5; x < f.x1; x++) if (Math.abs(x) > 0.01) winXs.push(x);
      const glassZ = f.z1 + WALL_T + 0.045;
      winXs.forEach((x, i) => { if (i % 2 === 0) posters.push(place(posterGeometry(pal, sc.primary, sc.accent, sc.trim), x - 0.12, 0.2, glassZ)); });
      winXs.forEach((x, i) => { if (i % 2 === 1 || winXs.length < 3) salePosters.push(place(posterGeometry(pal, '#E8573F', '#FFFFFF', '#FFC044'), x + 0.1, 0.2, glassZ)); });
      open.add(Object.assign(mesh(g), { name: 'rival-front' }));
      root.add(open); }
    // The name on the fascia and the pylon: it comes down when the store closes.
    const name = Object.assign(mesh(nameParts), { name: 'rival-name' });
    open.add(name);
    const full = Object.assign(mesh(wallsFull), { name: 'rival-walls' }), stub = Object.assign(mesh(wallsStub), { name: 'rival-stubs' });
    stub.visible = false;
    open.add(full, stub);
    const posterMesh = new Mesh(merge(posters), this.assets.material), salePosterMesh = new Mesh(merge(salePosters), this.assets.material);
    salePosterMesh.visible = false;
    open.add(posterMesh, salePosterMesh);
    // Bunting across the front on the day it opens.
    const bunting = new Mesh(buntingGeometry(pal, f.x1 - f.x0 + 0.6, [sc.primary, sc.accent, sc.trim]).translate(f.x0 - 0.3, 1.0, f.z1 + WALL_T + 0.4), this.assets.material);
    bunting.visible = false;
    open.add(bunting);
    const windows = new Mesh(merge(lit), WINDOW_GLOW);
    windows.visible = false;
    open.add(windows);
    // At night the windows throw a warm pool across the apron and the pavement in front.
    const fw = f.x1 - f.x0, fzn = f.z1 + WALL_T;
    const spill = new Mesh(mergeGeometries([spillGeometry(fw * 0.55, 1.5, (f.x0 + f.x1) / 2, 0.03, fzn + 1.2), spillGeometry(1.0, 0.8, 0, 0.031, fzn + 0.5, 0.7)]), SPILL);
    spill.visible = false; spill.renderOrder = 1;
    open.add(spill);

    // ---- Boards facing the road: "Coming soon" before opening, "SALE!" while one runs.
    const board = (text: string, bg: string, fg: string, side: string, x: number) => {
      const g = merge([box(pal, '#38383D', 0.1, 1.2, 0.1, x - 1.1, 0, 2.2), box(pal, '#38383D', 0.1, 1.2, 0.1, x + 1.1, 0, 2.2), box(pal, bg, 2.6, 0.55, 0.12, x, 1.0, 2.2), place(textGeometry(pal, text, 0.24, 0.05, fg, side), x, 1.15, 2.28)]);
      const m = new Mesh(g, this.assets.material); m.castShadow = true; m.visible = false; m.name = 'rival-board'; root.add(m); return m;
    };
    const soon = board(`${label.toUpperCase()} - SOON`, '#FFFFFF', '#38383D', sc.primary, 1.8);
    const sale = board('SALE!', '#FFC044', '#E8573F', '#B8402E', -L.halfW - 0.6 + 3.2);
    const forSale = board('FOR SALE', '#FFFFFF', '#E8573F', '#B8402E', 1.8);
    const footprint = rectToWorld(c, { x0: f.x0 - WALL_T, z0: backZ - WALL_T, x1: f.x1 + WALL_T, z1: f.z1 + WALL_T + 0.5 });
    return { id: r.id, corner: r.corner, key: '', root, lot, build, open, sale, soon, forSale, name, windows, spill, posters: posterMesh, salePosters: salePosterMesh, bunting, full, stub, footprint };
  }
}
