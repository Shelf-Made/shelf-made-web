import { Group, Mesh, MeshBasicMaterial, type BufferGeometry } from 'three';
import type { AssetLibrary } from './assets';
import type { GameState } from '@/sim/types';
import { box, merge, place } from './geometry';
import { textGeometry } from './letters';
import { MAIN_N, MAIN_S } from './town';
import { RIVAL_SCHEMES } from './RivalsView';
import { BILLBOARDS, OFFMAP_SITES, SIDE_HALF, ROAD_Z, lightAt } from '@/sim/layout';

type Lamp = 'mainR' | 'mainA' | 'mainG' | 'sideR' | 'sideA' | 'sideG' | 'walk' | 'wait';

/**
 * The live parts of the street: traffic-light lamps and walk signals following the sim's light,
 * billboard faces (your ad while rented, otherwise a rival's, otherwise "Space to let"), and road
 * signs at the edge of town pointing to the neighbourhoods and to every branch out there.
 */
export class StreetView {
  readonly group = new Group();
  private lamps = new Map<Lamp, Mesh>();
  private boards = new Map<string, { mine: Mesh; rival: Mesh; empty: Mesh }>();
  private signs = new Group();
  private signKey = '';
  private boardKey = '';
  private readonly on = new Map<string, MeshBasicMaterial>();
  constructor(private readonly assets: AssetLibrary) {}

  private mat(hex: string): MeshBasicMaterial { let m = this.on.get(hex); if (!m) { m = new MeshBasicMaterial({ color: hex }); this.on.set(hex, m); } return m; }

  build(): void {
    this.group.clear(); this.lamps.clear(); this.boards.clear(); this.signKey = ''; this.boardKey = '';
    this.signs = new Group(); this.group.add(this.signs);
    const pal = this.assets.palette;
    // Signal heads on the four corner poles: one facing Main Road traffic, one facing Elm Street's.
    const housing: BufferGeometry[] = [];
    const parts = new Map<Lamp, BufferGeometry[]>();
    const add = (k: Lamp, g: BufferGeometry) => { const a = parts.get(k) ?? []; a.push(g); parts.set(k, a); };
    const poles = [[-SIDE_HALF - 0.25, MAIN_N[0] - 0.2], [SIDE_HALF + 0.25, MAIN_N[0] - 0.2], [-SIDE_HALF - 0.25, MAIN_S[1] + 0.2], [SIDE_HALF + 0.25, MAIN_S[1] + 0.2]] as const;
    for (const [px, pz] of poles) {
      // Main Road head faces along x toward the traffic coming at it (from the far side of the junction).
      const mx = px < 0 ? 1 : -1, sz = pz < ROAD_Z ? 1 : -1;
      const mHead = { x: px, z: pz, y: 1.25, dx: mx, dz: 0 }, sHead = { x: px, z: pz, y: 1.05, dx: 0, dz: sz };
      for (const [h, road] of [[mHead, 'main'], [sHead, 'side']] as const) {
        const along = h.dx !== 0;
        housing.push(box(pal, '#2B2B30', along ? 0.06 : 0.12, 0.34, along ? 0.12 : 0.06, h.x + h.dx * 0.05, h.y - 0.17, h.z + h.dz * 0.05));
        const off = (y: number) => ({ x: h.x + h.dx * 0.085, y, z: h.z + h.dz * 0.085 });
        const lamp = (k: Lamp, y: number, hex: string) => { const p = off(y); add(k, box(pal, hex, along ? 0.02 : 0.07, 0.07, along ? 0.07 : 0.02, p.x, p.y, p.z)); };
        lamp(`${road}R` as Lamp, h.y + 0.06, '#FF4A3A'); lamp(`${road}A` as Lamp, h.y - 0.05, '#FFB13A'); lamp(`${road}G` as Lamp, h.y - 0.16, '#5BE37A');
      }
      // Walk signal facing the zebra landings.
      housing.push(box(pal, '#2B2B30', 0.1, 0.12, 0.1, px, 0.72, pz));
      add('walk', box(pal, '#FFFFFF', 0.11, 0.05, 0.11, px, 0.78, pz));
      add('wait', box(pal, '#FF6A3A', 0.11, 0.05, 0.11, px, 0.73, pz));
    }
    this.group.add(new Mesh(merge(housing), this.assets.material));
    const colours: Record<Lamp, string> = { mainR: '#FF4A3A', mainA: '#FFB13A', mainG: '#5BE37A', sideR: '#FF4A3A', sideA: '#FFB13A', sideG: '#5BE37A', walk: '#FFFFFF', wait: '#FF6A3A' };
    for (const [k, g] of parts) { const m = new Mesh(merge(g), this.mat(colours[k])); this.group.add(m); this.lamps.set(k, m); }
  }

  /** Billboard faces for the player's name; rebuilt when the name changes. */
  private buildBoards(shopName: string): void {
    const pal = this.assets.palette;
    for (const b of this.boards.values()) for (const m of [b.mine, b.rival, b.empty]) this.group.remove(m);
    this.boards.clear();
    for (const site of BILLBOARDS) {
      const face = (bg: string, line1: string, c1: string, line2: string, c2: string) => {
        const y = 1.3;
        const g = merge([
          box(pal, bg, 2.56, 1.06, 0.04, 0, y + 0.07, -0.04),
          place(textGeometry(pal, line1.toUpperCase(), Math.min(0.28, 2.3 / Math.max(6, line1.length * 0.9)), 0.03, c1, c1), 0, y + 0.62, -0.01),
          place(textGeometry(pal, line2.toUpperCase(), 0.14, 0.02, c2, c2), 0, y + 0.3, -0.01),
        ]);
        g.rotateY(site.yaw); g.translate(site.x, site.y, site.z);
        const m = new Mesh(g, this.assets.material); m.visible = false; this.group.add(m); return m;
      };
      this.boards.set(site.id, {
        mine: face('#3FA87A', shopName, '#FFF3DC', 'Fresh every day', '#FFC044'),
        rival: face(RIVAL_SCHEMES.chain.primary, 'MegaMart', '#FFFFFF', 'Big savings, every aisle', '#FFC044'),
        empty: face('#FFFFFF', 'Space to let', '#38383D', 'Call 555-0100', '#4A4A52'),
      });
    }
  }

  /** Road signs at the edge of town: the neighbourhood each road leads to, and the branches out there. */
  private buildSigns(state: GameState): void {
    const pal = this.assets.palette;
    this.signs.clear();
    const at: Record<string, { x: number; z: number; yaw: number }> = {
      west: { x: -27, z: MAIN_S[1] + 1.4, yaw: Math.PI / 2 }, east: { x: 27, z: MAIN_N[0] - 1.4, yaw: -Math.PI / 2 },
      north: { x: -3.6, z: -17.5, yaw: Math.PI }, south: { x: 3.6, z: 22.5, yaw: 0 },
    };
    for (const site of OFFMAP_SITES) {
      const p = at[site.dir]!;
      const lines = [`${site.name} ${site.km} km`];
      for (const f of state.franchises) if (f.siteId === site.id) lines.push(`${f.name} ${site.km} km`);
      for (const r of state.rivals) if (r.branches.includes(site.id)) lines.push(`${r.name} ${site.name} ${site.km} km`);
      const g: BufferGeometry[] = [box(pal, '#9AA0A8', 0.08, 1.2 + lines.length * 0.32, 0.08, -1.05, 0, 0), box(pal, '#9AA0A8', 0.08, 1.2 + lines.length * 0.32, 0.08, 1.05, 0, 0)];
      lines.forEach((t, i) => {
        const y = 1.0 + (lines.length - 1 - i) * 0.32;
        const own = i > 0 && state.franchises.some((f) => t.startsWith(f.name));
        const bg = i === 0 ? '#2E8560' : own ? '#3FA87A' : '#3570BC';
        g.push(box(pal, bg, 2.3, 0.28, 0.05, 0, y, 0.03));
        g.push(place(textGeometry(pal, t.toUpperCase(), Math.min(0.13, 2.1 / Math.max(8, t.length * 0.86)), 0.02, '#FFFFFF', '#FFFFFF'), 0, y + 0.07, 0.07));
      });
      const m = new Mesh(merge(g), this.assets.material);
      m.position.set(p.x, 0, p.z); m.rotation.y = p.yaw; m.castShadow = true;
      this.signs.add(m);
    }
  }

  update(state: GameState): void {
    const l = lightAt(state.tick).phase;
    const vis: Record<Lamp, boolean> = {
      mainR: l !== 'main' && l !== 'mainAmber', mainA: l === 'mainAmber', mainG: l === 'main',
      sideR: l !== 'side' && l !== 'sideAmber', sideA: l === 'sideAmber', sideG: l === 'side',
      walk: l === 'walk', wait: l !== 'walk',
    };
    for (const [k, m] of this.lamps) m.visible = vis[k];
    const bk = state.shop.name;
    if (bk !== this.boardKey) { this.boardKey = bk; this.buildBoards(state.shop.name); }
    const megaOpen = state.rivals.some((r) => r.kind === 'chain' && r.open);
    for (const [id, b] of this.boards) {
      const mine = state.marketing.billboards.includes(id);
      b.mine.visible = mine; b.rival.visible = !mine && megaOpen; b.empty.visible = !mine && !megaOpen;
    }
    const sk = state.franchises.map((f) => f.siteId + f.name).join(',') + '|' + state.rivals.map((r) => r.branches.join('+')).join(',');
    if (sk !== this.signKey) { this.signKey = sk; this.buildSigns(state); }
  }
}
