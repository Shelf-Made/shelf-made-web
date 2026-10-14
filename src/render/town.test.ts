import { describe, it, expect } from 'vitest';
import { buildTown, plotLot, rectsOverlap, groundHeight, onRoad, TOWN, type Rect } from './town';
import { PLOTS, CORNER_IDS, SHOP_SIZES, lotLayout, rectToWorld, CORNERS, ROAD_Z, ROAD_FAR, PLOT_RECT, cornerOfPlot } from '@/sim/layout';

const inside = (r: Rect, x: number, z: number, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
const touchesRoad = (r: Rect) => {
  for (let x = r.x0; x <= r.x1; x += 0.25) for (let z = r.z0; z <= r.z1; z += 0.25) if (onRoad(x, z)) return true;
  return false;
};

describe('crossroads plan', () => {
  for (const plot of PLOTS) {
    for (const seed of [1, 7, 12345]) {
      const plan = buildTown(seed, plot.id);

      it(`lots never overlap, and no lot touches a road (${plot.id}, seed ${seed})`, () => {
        for (let i = 0; i < plan.lots.length; i++) for (let j = i + 1; j < plan.lots.length; j++) {
          expect(rectsOverlap(plan.lots[i]!, plan.lots[j]!), `${JSON.stringify(plan.lots[i])} vs ${JSON.stringify(plan.lots[j])}`).toBe(false);
        }
        for (const l of plan.lots) expect(touchesRoad(l), JSON.stringify(l)).toBe(false);
      });

      it(`the player's corner holds only the player's shop (${plot.id}, seed ${seed})`, () => {
        const own = plotLot(plot.id);
        for (const p of plan.placements) expect(inside(own, p.x, p.z), `${p.model} at ${p.x},${p.z}`).toBe(false);
        for (const s of plan.slabs) expect(rectsOverlap(s.rect, own), `slab ${s.color} ${JSON.stringify(s.rect)}`).toBe(false);
        for (const g of plan.scatter) expect(inside(own, g.x, g.z), `${g.kind} at ${g.x},${g.z}`).toBe(false);
        expect(plan.lots.filter((l) => l.kind === 'plot').length).toBe(1);
        expect(plan.rivals.every((r) => r.corner !== cornerOfPlot(plot.id))).toBe(true);
      });
    }
  }

  it('every corner lot fits the largest shop with the doubled lot', () => {
    const big = SHOP_SIZES[SHOP_SIZES.length - 1]!;
    const L = lotLayout({ floor: big.floor, storeroom: big.storeroom, lotRows: 2 });
    for (const c of CORNER_IDS) {
      const lot = rectToWorld(CORNERS[c], PLOT_RECT);
      for (const r of [big.floor, L.apron, L.aisle, L.driveway, L.serviceLane, L.backYard, L.plot, ...L.bays.map((b) => ({ x0: b.x - 0.85, z0: b.z - 0.55, x1: b.x + 0.85, z1: b.z + 0.55 }))]) {
        const w = rectToWorld(CORNERS[c], { ...r, z1: Math.min(r.z1, PLOT_RECT.z1) });
        expect(w.x0 >= lot.x0 - 1e-6 && w.x1 <= lot.x1 + 1e-6 && w.z0 >= lot.z0 - 1e-6 && w.z1 <= lot.z1 + 1e-6, `${c}: ${JSON.stringify(r)}`).toBe(true);
      }
    }
  });

  it('the ground is level everywhere, town and plain alike', () => {
    for (let x = -120; x <= 120; x += 4) for (let z = -110; z <= 110; z += 4) expect(groundHeight(x, z), `${x},${z}`).toBe(0);
  });

  it('nothing but the crossroads: the four corners, and the roads running off into empty space', () => {
    const plan = buildTown(3, 'main');
    expect(plan.lots.map((l) => l.kind).sort()).toEqual(['plot', 'rival', 'rival', 'rival']);
    expect(plan.rivals.length).toBe(3);
    // Out beyond the town only the roads (and their sidewalks and lamps) go on.
    const roadside = (x: number, z: number) => Math.abs(z - ROAD_Z) < 3.2 || Math.abs(x) < 3.2;
    for (const p of plan.placements) if (Math.abs(p.x) > TOWN.x1 + 2 || p.z < TOWN.z0 - 2 || p.z > TOWN.z1 + 2) expect(roadside(p.x, p.z), `${p.model} at ${p.x},${p.z}`).toBe(true);
    for (const g of plan.scatter) expect(Math.abs(g.x) < TOWN.x1 + 6 && g.z > TOWN.z0 - 6 && g.z < TOWN.z1 + 6, `${g.kind} at ${g.x},${g.z}`).toBe(true);
    // Both roads reach far out, past where the traffic appears.
    const xs = plan.placements.filter((p) => p.model.startsWith('roads/road-') && Math.abs(p.z - ROAD_Z) < 0.1).map((p) => p.x);
    expect(Math.max(...xs)).toBeGreaterThan(ROAD_FAR);
    expect(Math.min(...xs)).toBeLessThan(-ROAD_FAR);
  });
});
