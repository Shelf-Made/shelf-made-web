import { describe, it, expect } from 'vitest';
import { buildTown, plotLot, rectsOverlap, groundHeight, onRoad, TOWN, type Rect } from './town';
import { PLOTS, CORNER_IDS, SHOP_SIZES, lotLayout, rectToWorld, CORNERS, ROAD_Z, PLOT_RECT, cornerOfPlot } from '@/sim/layout';

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

      it(`every building stands inside its own lot (${plot.id}, seed ${seed})`, () => {
        for (const f of plan.footprints) {
          const l = plan.lots[f.lot]!;
          expect(f.x0 >= l.x0 - 1e-6 && f.x1 <= l.x1 + 1e-6 && f.z0 >= l.z0 - 1e-6 && f.z1 <= l.z1 + 1e-6, `${JSON.stringify(f)} in ${JSON.stringify(l)}`).toBe(true);
        }
      });

      it(`the player's corner holds only the player's shop (${plot.id}, seed ${seed})`, () => {
        const own = plotLot(plot.id);
        for (const p of plan.placements) expect(inside(own, p.x, p.z), `${p.model} at ${p.x},${p.z}`).toBe(false);
        for (const t of plan.forest) expect(inside(own, t.x, t.z, 0.5)).toBe(false);
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

  it('the ground is level across the town, and along both roads out of it; hills rise beyond', () => {
    for (let x = TOWN.x0; x <= TOWN.x1; x += 2) for (let z = TOWN.z0; z <= TOWN.z1; z += 2) expect(groundHeight(x, z), `${x},${z}`).toBe(0);
    for (let d = -95; d <= 95; d += 5) { expect(groundHeight(d, ROAD_Z)).toBe(0); expect(groundHeight(0, d)).toBe(0); }
    expect(groundHeight(70, -60)).toBeGreaterThan(3);
    expect(groundHeight(-20, -100)).toBeGreaterThan(10);
  });

  it('a backdrop of houses and blocks, but nothing walkable beyond the corners', () => {
    const plan = buildTown(3, 'main');
    expect(plan.lots.filter((l) => l.kind === 'house').length).toBeGreaterThan(20);
    expect(plan.lots.filter((l) => l.kind === 'apartment').length).toBeGreaterThan(6);
    expect(plan.rivals.length).toBe(3);
    expect(plan.forest.length).toBeGreaterThan(300);
  });
});
