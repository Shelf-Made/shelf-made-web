import { Group, Mesh } from 'three';
import type { AssetLibrary } from './assets';
import type { GameState } from '@/sim/types';
import type { TownPlan } from './town';
import { box, merge, place } from './geometry';
import { textGeometry } from './letters';

/** Boards at each rival site: "CLOSED" until they open, "SALE" while they run one, otherwise their name. */
export class RivalsView {
  readonly group = new Group();
  private boards = new Map<string, { closed: Mesh; sale: Mesh; name: Mesh }>();
  private branchSigns: Mesh[] = [];
  constructor(private readonly assets: AssetLibrary) {}

  build(plan: TownPlan, branchNames: Record<string, string> = {}): void {
    this.group.clear(); this.boards.clear(); this.branchSigns = [];
    const pal = this.assets.palette;
    for (const b of plan.branches) {
      const name = (branchNames[b.plotId] ?? 'BRANCH').toUpperCase();
      const h = Math.min(0.3, (2.4 * 7) / (6 * Math.max(1, name.length)));
      const g = merge([box(pal, '#38383D', 0.1, 1.2, 0.1, b.x - 1.3, 0, b.z), box(pal, '#38383D', 0.1, 1.2, 0.1, b.x + 1.3, 0, b.z), box(pal, '#38383D', 2.8, 0.55, 0.12, b.x, 1.0, b.z), box(pal, '#3FA87A', 2.86, 0.05, 0.16, b.x, 1.55, b.z), place(textGeometry(pal, name, h, 0.05, '#FFF3DC', '#FFC044'), b.x, 1.27 - h / 2, b.z + 0.08, 0)]);
      const m = new Mesh(g, this.assets.material); m.castShadow = true; this.group.add(m); this.branchSigns.push(m);
    }
    for (const r of plan.rivals) {
      const x = r.x, z = r.z - 2.6;
      const post = merge([box(pal, '#38383D', 0.1, 1.2, 0.1, x - 1.1, 0, z), box(pal, '#38383D', 0.1, 1.2, 0.1, x + 1.1, 0, z)]);
      this.group.add(new Mesh(post, this.assets.material));
      const mk = (text: string, bg: string, fg: string, side: string) => {
        const g = merge([box(pal, bg, 2.6, 0.55, 0.12, x, 1.0, z), place(textGeometry(pal, text, 0.3, 0.05, fg, side), x, 1.12, z - 0.08, Math.PI)]);
        const m = new Mesh(g, this.assets.material); m.castShadow = true; m.visible = false; this.group.add(m); return m;
      };
      this.boards.set(r.id, { closed: mk('CLOSED', '#38383D', '#B9BCC4', '#5A5A62'), sale: mk('SALE!', '#FFC044', '#E8573F', '#B8402E'), name: mk(r.name.toUpperCase(), '#FFFFFF', '#38383D', '#3FA87A') });
    }
  }

  update(state: GameState): void {
    for (const r of state.rivals) {
      const b = this.boards.get(r.id); if (!b) continue;
      b.closed.visible = !r.open; b.sale.visible = r.open && r.saleDaysLeft > 0; b.name.visible = r.open && r.saleDaysLeft === 0;
    }
  }
}
