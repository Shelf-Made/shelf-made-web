import { Group, Mesh, MeshBasicMaterial, type BufferGeometry } from 'three';
import type { AssetLibrary } from './assets';
import type { GameState, RivalState } from '@/sim/types';
import type { TownPlan, RivalSite } from './town';
import { MAIN_N, PAVEMENT } from './town';
import { box, merge, place } from './geometry';
import { textGeometry } from './letters';
import { recolor, cutDown } from './recolor';
import { WALL_COLOURS } from './storeArt';
import { CORNERS, PLOT_RECT, ROAD_Z, WALL_T, lotLayout, type Rect } from '@/sim/layout';
import { rivalShape } from '@/sim/rivals';

/** Each rival's fixed colours: primary (awning, fascia), accent (stripes, lot paint), trim and lettering. */
export const RIVAL_SCHEMES: Record<RivalState['kind'], { primary: string; accent: string; trim: string; text: string }> = {
  discount: { primary: '#FFC044', accent: '#E8573F', trim: '#FFFFFF', text: '#E8573F' },
  premium: { primary: '#2E6B4F', accent: '#FFF3DC', trim: '#D9A066', text: '#FFF3DC' },
  chain: { primary: '#3570BC', accent: '#FFFFFF', trim: '#FFC044', text: '#FFFFFF' },
};

/** Models the rival sites use beyond the shop's own. */
export const RIVAL_MODELS = ['market/shopping-cart', 'roads/cone', 'roads/dumpster', 'suburban/fence', 'furniture/bench', 'furniture/trashcan'];

/** Frontage maths as if every shop faced south (the root carries the real frame). */
const NORTH_Z = -1.6;
const SW_IN = MAIN_N[0] - NORTH_Z, SW_OUT = MAIN_N[1] - NORTH_Z, KERB = ROAD_Z - 1.0 - NORTH_Z;

interface Site {
  id: string; root: Group;
  lot: Group; build: Group; open: Group;
  sale: Mesh; soon: Mesh; windows: Mesh;
}

type Letters = (text: string, size: number, depth: number, face?: string, side?: string) => BufferGeometry;

/**
 * The rivals' corners. Before a rival opens: a fenced lot with a "Coming soon" board, then (the
 * last two days) a half-built shop in scaffolding. Open: a proper storefront in its colours, with
 * its name on the fascia and a pylon, lit windows at night, its own parking lot (its customers'
 * cars park there, from the sim), and a SALE banner facing the road while it runs one.
 */
export class RivalsView {
  readonly group = new Group();
  private sites: Site[] = [];
  private glowMat = new MeshBasicMaterial({ color: '#FFE6A8' });
  private night = false;
  constructor(private readonly assets: AssetLibrary, private readonly letters: Letters | null = null) {}

  build(plan: TownPlan): void {
    this.group.clear(); this.sites = [];
    for (const r of plan.rivals) this.sites.push(this.site(r));
  }

  setNight(on: boolean): void { this.night = on; }

  update(state: GameState): void {
    for (const s of this.sites) {
      const r = state.rivals.find((x) => x.id === s.id); if (!r) continue;
      const stage = r.open ? 'open' : state.day >= r.opensDay - 2 ? 'build' : 'lot';
      s.lot.visible = stage === 'lot'; s.build.visible = stage === 'build'; s.open.visible = stage === 'open';
      s.soon.visible = stage !== 'open';
      s.sale.visible = r.open && r.saleDaysLeft > 0;
      s.windows.visible = r.open && this.night;
    }
  }

  private text(text: string, size: number, face: string, side: string): BufferGeometry {
    return this.letters ? this.letters(text, size, 0.05, face, side) : textGeometry(this.assets.palette, text, size, 0.05, face, side);
  }

  private site(r: RivalSite): Site {
    const pal = this.assets.palette;
    const c = CORNERS[r.corner];
    const root = new Group();
    root.position.set(c.originX, 0, c.originZ);
    root.rotation.set(0, c.flip ? Math.PI : 0, 0);
    this.group.add(root);
    const shape = rivalShape({ sizeId: r.kind === 'chain' ? 'large' : 'medium', lotRows: r.kind === 'chain' ? 2 : 1 });
    const L = lotLayout(shape);
    const f = shape.floor, backZ = Math.min(f.z0, shape.storeroom.z0);
    const sc = RIVAL_SCHEMES[r.kind];
    const mesh = (parts: BufferGeometry[], cast = true) => { const m = new Mesh(merge(parts), this.assets.material); m.castShadow = cast; m.receiveShadow = true; return m; };

    // ---- Always: the frontage sidewalk with dropped kerbs where the lot meets the road.
    const ground: BufferGeometry[] = [];
    const slab = (q: Rect, hex: string, h = 0.03, y = -0.012) => ground.push(box(pal, hex, q.x1 - q.x0, h, q.z1 - q.z0, (q.x0 + q.x1) / 2, y, (q.z0 + q.z1) / 2));
    const cuts = [[L.serviceLane.x0, L.serviceLane.x1], [L.driveway.x0, L.driveway.x1]].sort((a, b) => a[0]! - b[0]!);
    let sx = PLOT_RECT.x0;
    for (const [c0, c1] of cuts) { if (c0! > sx) slab({ x0: sx, z0: SW_IN, x1: c0!, z1: SW_OUT }, PAVEMENT, 0.06); sx = c1!; }
    slab({ x0: sx, z0: SW_IN, x1: PLOT_RECT.x1, z1: SW_OUT }, PAVEMENT, 0.06);
    for (const [c0, c1] of cuts) slab({ x0: c0!, z0: SW_IN, x1: c1!, z1: SW_OUT }, '#B9BCC4', 0.034, -0.01);
    root.add(mesh(ground, false));

    // ---- Stage 1: a fenced, grassy lot with a "Coming soon" board.
    const lot = new Group();
    { const g: BufferGeometry[] = [];
      const fx0 = PLOT_RECT.x0 + 0.6, fx1 = PLOT_RECT.x1 - 0.6, fz0 = PLOT_RECT.z0 + 0.6, fz1 = SW_IN - 0.4;
      const fence = this.assets.has('suburban/fence') ? this.assets.geometry('suburban/fence') : null;
      if (fence) {
        for (let x = fx0 + 0.71; x <= fx1 - 0.7; x += 1.42) { g.push(place(fence.clone(), x, 0, fz1)); g.push(place(fence.clone(), x, 0, fz0)); }
        for (let z = fz0 + 0.71; z <= fz1 - 0.7; z += 1.42) { g.push(place(fence.clone(), fx0, 0, z, Math.PI / 2)); g.push(place(fence.clone(), fx1, 0, z, Math.PI / 2)); }
      }
      lot.add(mesh(g));
      root.add(lot); }

    // ---- Stage 2: the shop half built: walls to waist height, scaffolding, cones, a skip.
    const build = new Group();
    { const g: BufferGeometry[] = [];
      const wall = recolor(this.assets.geometry('market/wall'), WALL_COLOURS);
      const low = cutDown(wall, 0.45);
      for (let x = f.x0 + 0.5; x < f.x1; x++) { g.push(place(low.clone(), x, 0, f.z1 + WALL_T / 2)); g.push(place(low.clone(), x, 0, backZ - WALL_T / 2, Math.PI)); }
      for (let z = backZ + 0.5; z < f.z1; z++) { g.push(place(low.clone(), f.x0 - WALL_T / 2, 0, z, -Math.PI / 2)); g.push(place(low.clone(), f.x1 + WALL_T / 2, 0, z, Math.PI / 2)); }
      // Scaffold poles and planks round the front and sides.
      for (let x = f.x0 - 0.6; x <= f.x1 + 0.61; x += 1.0) { g.push(box(pal, '#9AA0A8', 0.05, 1.6, 0.05, x, 0, f.z1 + 1.0)); }
      for (const y of [0.55, 1.1]) g.push(box(pal, '#C8925A', f.x1 - f.x0 + 1.3, 0.05, 0.36, (f.x0 + f.x1) / 2, y, f.z1 + 0.85));
      g.push(box(pal, '#9AA0A8', f.x1 - f.x0 + 1.3, 0.04, 0.04, (f.x0 + f.x1) / 2, 1.5, f.z1 + 1.0));
      for (let i = 0; i < 6; i++) g.push(place(this.assets.geometry('roads/cone').clone(), L.driveway.x0 + 0.3 + (i % 3) * 0.6, 0, 0.6 + Math.floor(i / 3) * 0.6));
      if (this.assets.has('roads/dumpster')) g.push(place(this.assets.geometry('roads/dumpster').clone(), L.backYard.x1 - 1, 0, L.backYard.z0 + 0.7, Math.PI / 2));
      // A slab poured for the floor.
      g.push(box(pal, '#C4C0B8', f.x1 - f.x0, 0.05, f.z1 - backZ, (f.x0 + f.x1) / 2, -0.03, (f.z1 + backZ) / 2));
      build.add(mesh(g));
      root.add(build); }

    // ---- Stage 3: open for business.
    const open = new Group();
    const lit: BufferGeometry[] = [];
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
      open.add(mesh(pave, false));
      // Walls: Kenney pieces, a door and windows on the front.
      const wallG = recolor(this.assets.geometry('market/wall'), WALL_COLOURS);
      const windowG = recolor(this.assets.geometry('market/wall-window'), WALL_COLOURS);
      const doorG = recolor(this.assets.geometry('market/wall-door'), WALL_COLOURS);
      for (let x = f.x0 + 0.5; x < f.x1; x++) {
        const door = Math.abs(x) < 0.01;
        g.push(place((door ? doorG : windowG).clone(), x, 0, f.z1 + WALL_T / 2));
        if (!door) lit.push(box(pal, '#FFE6A8', 0.62, 0.42, 0.02, x, 0.36, f.z1 + WALL_T + 0.03));
        g.push(place(wallG.clone(), x, 0, backZ - WALL_T / 2, Math.PI));
      }
      for (let z = backZ + 0.5; z < f.z1; z++) { g.push(place(wallG.clone(), f.x0 - WALL_T / 2, 0, z, -Math.PI / 2)); g.push(place(wallG.clone(), f.x1 + WALL_T / 2, 0, z, Math.PI / 2)); }
      // Roof: a flat deck with a parapet in the brand's trim.
      const W = f.x1 - f.x0 + 2 * WALL_T, D = f.z1 - backZ + 2 * WALL_T, cx = (f.x0 + f.x1) / 2, cz = (f.z1 + backZ) / 2;
      g.push(box(pal, '#9AA0A8', W, 0.06, D, cx, 1.0, cz));
      g.push(box(pal, sc.trim, W + 0.06, 0.12, 0.08, cx, 1.0, f.z1 + WALL_T), box(pal, sc.trim, W + 0.06, 0.12, 0.08, cx, 1.0, backZ - WALL_T));
      g.push(box(pal, sc.trim, 0.08, 0.12, D, f.x0 - WALL_T, 1.0, cz), box(pal, sc.trim, 0.08, 0.12, D, f.x1 + WALL_T, 1.0, cz));
      // A rooftop unit or two.
      g.push(box(pal, '#B9BCC4', 0.6, 0.3, 0.5, cx - W / 4, 1.06, cz - D / 5), box(pal, '#B9BCC4', 0.5, 0.25, 0.5, cx + W / 5, 1.06, cz + D / 6));
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
      const size = Math.min(0.3, (width - 0.6) / Math.max(4, r.name.length * 0.62));
      g.push(place(this.text(r.name, size, sc.text, sc.trim), cx, 1.25 - size * 0.4, fz + 0.04));
      // Pylon by the sidewalk, readable both ways down Main Road.
      const px = -L.halfW - 0.6, pz = 1.85, bw = 2.6;
      g.push(box(pal, '#38383D', 0.12, 1.5, 0.12, px - bw / 2 + 0.2, 0, pz), box(pal, '#38383D', 0.12, 1.5, 0.12, px + bw / 2 - 0.2, 0, pz), box(pal, sc.primary, bw, 0.55, 0.12, px, 1.0, pz), box(pal, sc.trim, bw + 0.06, 0.05, 0.16, px, 1.55, pz));
      const ps = Math.min(0.26, (bw - 0.35) / Math.max(4, r.name.length * 0.62));
      for (const yaw of [0, Math.PI]) g.push(place(this.text(r.name, ps, sc.text, sc.trim), px, 1.24 - ps * 0.4, pz + (yaw === 0 ? 0.07 : -0.07), yaw));
      // Trolley bay, bench and bins by the door.
      if (this.assets.has('furniture/bench')) g.push(place(this.assets.geometry('furniture/bench').clone(), -1.7, 0, f.z1 + WALL_T + 0.42));
      if (this.assets.has('furniture/trashcan')) g.push(place(this.assets.geometry('furniture/trashcan').clone(), 1.25, 0, f.z1 + WALL_T + 0.3));
      if (this.assets.has('market/shopping-cart')) for (let i = 0; i < 3; i++) g.push(place(this.assets.geometry('market/shopping-cart').clone(), L.apron.x0 + 0.5 + i * 0.18, 0, 0.9, Math.PI / 2));
      open.add(mesh(g));
      root.add(open); }
    const windows = new Mesh(merge(lit), this.glowMat);
    windows.visible = false;
    open.add(windows);

    // ---- Boards facing the road: "Coming soon" before opening, "SALE!" while one runs.
    const board = (text: string, bg: string, fg: string, side: string, x: number) => {
      const g = merge([box(pal, '#38383D', 0.1, 1.2, 0.1, x - 1.1, 0, 2.2), box(pal, '#38383D', 0.1, 1.2, 0.1, x + 1.1, 0, 2.2), box(pal, bg, 2.6, 0.55, 0.12, x, 1.0, 2.2), place(textGeometry(pal, text, 0.24, 0.05, fg, side), x, 1.15, 2.28)]);
      const m = new Mesh(g, this.assets.material); m.castShadow = true; m.visible = false; root.add(m); return m;
    };
    const soon = board(`${r.name.toUpperCase()} - SOON`, '#FFFFFF', '#38383D', sc.primary, 1.8);
    const sale = board('SALE!', '#FFC044', '#E8573F', '#B8402E', -L.halfW - 0.6 + 3.2);
    return { id: r.id, root, lot, build, open, sale, soon, windows };
  }
}
