import { describe, it, expect } from 'vitest';
import { buildTown, plotLot, rectsOverlap, groundHeight, MAIN_N, type Rect } from './town';
import { PLOTS, CROSS_XS, ROAD_Z, BACK_Z, riverZ, RIVER_HALF_W } from '@/sim/layout';

const inside = (r: Rect, x: number, z: number, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;

describe('town plan', () => {
  for (const plot of PLOTS) {
    for (const seed of [1, 7, 12345]) {
      const plan = buildTown(seed, plot.id, PLOTS.filter((p) => p.id !== plot.id).slice(0, 1).map((p) => p.id));

      it(`lots never overlap (${plot.id}, seed ${seed})`, () => {
        for (let i = 0; i < plan.lots.length; i++) for (let j = i + 1; j < plan.lots.length; j++) {
          expect(rectsOverlap(plan.lots[i]!, plan.lots[j]!), `${JSON.stringify(plan.lots[i])} vs ${JSON.stringify(plan.lots[j])}`).toBe(false);
        }
      });

      it(`every building stands inside its own lot and clear of the others (${plot.id}, seed ${seed})`, () => {
        for (const f of plan.footprints) {
          const l = plan.lots[f.lot]!;
          expect(f.x0 >= l.x0 - 1e-6 && f.x1 <= l.x1 + 1e-6 && f.z0 >= l.z0 - 1e-6 && f.z1 <= l.z1 + 1e-6, `${JSON.stringify(f)} in ${JSON.stringify(l)}`).toBe(true);
        }
        for (let i = 0; i < plan.footprints.length; i++) for (let j = i + 1; j < plan.footprints.length; j++) {
          expect(rectsOverlap(plan.footprints[i]!, plan.footprints[j]!)).toBe(false);
        }
      });

      it(`nothing from the town lands on the shop's own plot (${plot.id}, seed ${seed})`, () => {
        const own = plotLot(plot.x);
        // Only the boundary hedge may stand on the edge strip.
        const core: Rect = { x0: own.x0 + 0.6, z0: own.z0 + 0.6, x1: own.x1 - 0.6, z1: own.z1 };
        for (const p of plan.placements) expect(inside(core, p.x, p.z), `${p.model} at ${p.x},${p.z}`).toBe(false);
        for (const t of plan.forest) expect(inside(own, t.x, t.z, 0.5)).toBe(false);
        for (const s of plan.slabs) expect(rectsOverlap(s.rect, core), `slab ${s.color} ${JSON.stringify(s.rect)}`).toBe(false);
      });

      it(`fences run along their property lines (${plot.id}, seed ${seed})`, () => {
        const fences = plan.placements.filter((p) => p.model.includes('fence'));
        expect(fences.length).toBeGreaterThan(50);
        for (const f of fences) {
          const along = Math.abs(Math.sin(f.yaw)) < 1e-6 ? 'x' : 'z';
          // A fence running along x sits on a lot's front or back line; one running along z on a side line.
          const onLine = plan.lots.some((l) => along === 'x'
            ? (Math.abs(f.z - l.z0) < 0.45 || Math.abs(f.z - l.z1) < 0.45) && f.x > l.x0 - 0.1 && f.x < l.x1 + 0.1
            : (Math.abs(f.x - l.x0) < 0.45 || Math.abs(f.x - l.x1) < 0.45) && f.z > l.z0 - 0.1 && f.z < l.z1 + 0.1);
          const field = plan.fields.some((fl) => along === 'x' ? (Math.abs(f.z - fl.z0) < 0.45 || Math.abs(f.z - fl.z1) < 0.45) : (Math.abs(f.x - fl.x0) < 0.45 || Math.abs(f.x - fl.x1) < 0.45));
          expect(onLine || field, `${f.model} at ${f.x.toFixed(2)},${f.z.toFixed(2)} yaw ${f.yaw}`).toBe(true);
        }
      });
    }
  }

  it('trees stay off roads, the river and every lot', () => {
    const plan = buildTown(3, 'main');
    expect(plan.forest.length).toBeGreaterThan(800);
    for (const t of plan.forest) {
      expect(Math.abs(t.z - ROAD_Z) < 2.5 || Math.abs(t.z - BACK_Z) < 2.5, `tree on a road at ${t.x},${t.z}`).toBe(false);
      expect(Math.abs(t.z - riverZ(t.x)) < RIVER_HALF_W + 1, `tree in the river at ${t.x},${t.z}`).toBe(false);
      for (const l of plan.lots) expect(inside(l, t.x, t.z)).toBe(false);
    }
  });

  it('the valley floor is level where the town stands, and the land rises beyond', () => {
    for (let x = -66; x <= 66; x += 3) for (let z = -38; z <= 50; z += 3) expect(groundHeight(x, z)).toBe(0);
    expect(groundHeight(0, -90)).toBeGreaterThan(10);
    expect(groundHeight(120, -10)).toBeGreaterThan(5);
    // Roads run level out of the valley.
    for (let x = -100; x <= 100; x += 5) { expect(groundHeight(x, ROAD_Z)).toBeLessThan(0.05); expect(groundHeight(x, BACK_Z)).toBeLessThan(0.05); }
  });

  it('each cross street crosses the river on a bridge, and Main Street has a sidewalk on both sides', () => {
    const plan = buildTown(3, 'hill');
    for (const cx of CROSS_XS) {
      const b = plan.bridges.find((br) => br.x === cx)!;
      expect(b).toBeTruthy();
      expect(b.z0).toBeLessThan(riverZ(cx) - RIVER_HALF_W);
      expect(b.z1).toBeGreaterThan(riverZ(cx) + RIVER_HALF_W);
    }
    const sidewalk = plan.slabs.filter((s) => Math.abs(s.rect.z0 - MAIN_N[0]) < 1e-6);
    expect(sidewalk.length).toBeGreaterThan(2);
  });
});
