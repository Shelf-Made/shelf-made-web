import { describe, it, expect } from 'vitest';
import { BUS_STOP, BILLBOARDS, CORNERS, CORNER_IDS, SHOP_SIZES, lotLayout, rectToWorld } from './layout';

/** Every stretch of the south sidewalk a vehicle crosses into a lot, at any shop size and lot depth, on any corner. */
function mouths(): [number, number][] {
  const out: [number, number][] = [];
  for (const c of CORNER_IDS) for (const size of SHOP_SIZES) for (const rows of [1, 2]) {
    const L = lotLayout({ floor: size.floor, storeroom: size.storeroom, lotRows: rows });
    for (const r of [L.driveway, L.serviceLane]) { const w = rectToWorld(CORNERS[c], r); if (w.z1 > 2.5) out.push([w.x0, w.x1]); }
  }
  return out;
}

describe('the bus stop', () => {
  it('stands clear of every driveway and service lane, so no truck or car drives through it', () => {
    expect(mouths().length).toBeGreaterThan(0);
    // The shelter, its stop sign (west) and its bin (east).
    const shelter: [number, number] = [BUS_STOP.x - 1.3, BUS_STOP.x + 1.6];
    const board = BILLBOARDS.find((b) => b.id === 'bus')!;
    for (const [a, b] of mouths()) {
      expect(b < shelter[0] || a > shelter[1], `lane ${a}..${b} through the shelter ${shelter}`).toBe(true);
      expect(b < board.x - 1.35 || a > board.x + 1.35, `lane ${a}..${b} through the bus-shelter board at ${board.x}`).toBe(true);
    }
  });
});
