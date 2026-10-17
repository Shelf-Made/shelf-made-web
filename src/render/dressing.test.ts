import { describe, it, expect } from 'vitest';
import { cornerProps, pavedRects, playerCorner, SIDEWALK_IN } from './dressing';
import { newGame, resetGridCache, gridFor, applyCommand } from '@/sim/index';
import { cellOf, cellIndex } from '@/sim/grid';
import { toWorld, PLOT_RECT, PLOTS } from '@/sim/layout';
import { rivalShape } from '@/sim/rivals';

describe('street dressing', () => {
  for (const plot of PLOTS) for (const [size, rows] of [['starter', 1], ['medium', 1], ['large', 2]] as const) {
    it(`props on the ${plot.id} corner (${size}, ${rows} rows) stand on the lawn: never on a path, the paving or a bay`, () => {
      resetGridCache();
      const s = newGame({ seed: 3, plotId: plot.id, name: 'Props', sandbox: true });
      if (size !== 'starter') expect(applyCommand(s, { type: 'expandShop', sizeId: size }).ok).toBe(true);
      if (rows === 2) expect(applyCommand(s, { type: 'expandLot' }).ok).toBe(true);
      const tier = size === 'large' ? 2 : size === 'medium' ? 1 : 0;
      const props = cornerProps(playerCorner(s.shop), tier, { trolleys: rows === 2 });
      // (Your own lot is laid as you like: the bench by the door is left out when the lawn there is paved.)
      expect(props.length).toBeGreaterThanOrEqual(6 + (tier >= 1 ? 4 : 0));
      const g = gridFor(s);
      const bays = s.shop.bays;
      for (const p of props) {
        const w = toWorld(s.shop, p.x, p.z);
        const [cx, cz] = cellOf(g, w);
        const cost = g.cost[cellIndex(g, cx, cz)];
        // The grid paves paths at cost 1 to 1.3, blocks walls and fixtures at 0, and leaves lawn at 2.5.
        expect(cost, `${p.model} at ${p.x.toFixed(2)},${p.z.toFixed(2)}`).toBe(2.5);
        for (const b of bays) expect(Math.hypot(b.x - w.x, b.z - w.z), `${p.model} near a bay`).toBeGreaterThan(0.85);
        expect(p.z).toBeLessThan(SIDEWALK_IN);
        expect(p.x > PLOT_RECT.x0 && p.x < PLOT_RECT.x1).toBe(true);
      }
    });
  }

  it("rivals' props keep off their paths and bays too", () => {
    for (const [kind, tier] of [['medium', 1], ['large', 2]] as const) {
      const shape = rivalShape({ sizeId: kind, lotRows: kind === 'large' ? 2 : 1 });
      const props = cornerProps({ ...shape, door: { x: 0, z: shape.floor.z1 } }, tier, { trolleys: kind === 'large' });
      const paved = pavedRects({ ...shape, door: { x: 0, z: shape.floor.z1 } });
      for (const p of props) for (const q of paved) expect(p.x > q.x0 - p.r && p.x < q.x1 + p.r && p.z > q.z0 - p.r && p.z < q.z1 + p.r, `${p.model}`).toBe(false);
    }
  });
});
