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
  constructor(private readonly assets: AssetLibrary) {}

  build(plan: TownPlan): void {
    this.group.clear(); this.boards.clear();
    const pal = this.assets.palette;
    for (const r of plan.rivals) {
      const x = r.x, z = r.z - 2.6;
      const post = merge([box(pal, '#38383D', 0.1, 1.2, 0.1, x - 1.1, 0, z), box(pal, '#38383D', 0.1, 1.2, 0.1, x + 1.1, 0, z)]);
      this.group.add(new Mesh(post, this.assets.material));
      const mk = (text: string, bg: string, fg: string, side: string) => {
        const g = merge([box(pal, bg, 2.6, 0.55, 0.12, x, 1.0, z), place(textGeometry(pal, text, 0.3, 0.05, fg, side), x, 1.12, z + 0.08, 0)]);
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
