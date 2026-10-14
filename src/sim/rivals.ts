/**
 * Rival stores: a discounter, a premium grocer and an expanding chain, each on its own corner
 * of the crossroads. They open over the first days, keep a simple state, and act through the
 * same command layer as the player. MegaMart's extra branches open off the map.
 */
import type { GameState, RivalState, CornerId, ParkingBay } from './types';
import { withRng, popup, cue } from './state';
import { CORNERS, RIVAL_CORNER, SHOP_SIZES, OFFMAP_SITES, cornerOfPlot, lotLayout, toWorld, yawToWorld, type Frame } from './layout';

type RivalDef = Omit<RivalState, 'open' | 'saleDaysLeft' | 'nextSaleDay' | 'cash' | 'reputation' | 'corner' | 'x' | 'z' | 'bays' | 'branches'>;

export const RIVAL_DEFS: RivalDef[] = [
  { id: 'discount', name: 'Cheapo', kind: 'discount', opensDay: 3, priceIndex: 0.86, availability: 0.6, quality: 0.35, service: 0.55, parking: 0.8, awareness: 0.6, stores: 1, sizeId: 'medium', lotRows: 1 },
  { id: 'premium', name: 'Fresh & Fine', kind: 'premium', opensDay: 6, priceIndex: 1.22, availability: 0.85, quality: 0.9, service: 0.8, parking: 0.6, awareness: 0.5, stores: 1, sizeId: 'medium', lotRows: 1 },
  { id: 'chain', name: 'MegaMart', kind: 'chain', opensDay: 10, priceIndex: 0.95, availability: 0.9, quality: 0.65, service: 0.7, parking: 0.95, awareness: 0.75, stores: 1, sizeId: 'large', lotRows: 2 },
];

/** Which corner each rival takes: MegaMart always has the south-east; the other two fill the corners the player left. */
export function rivalCorners(playerPlotId: string): Record<string, CornerId> {
  const mine = cornerOfPlot(playerPlotId);
  const free = (['nw', 'ne', 'sw'] as CornerId[]).filter((c) => c !== mine);
  return { discount: free[0]!, premium: free[1]!, chain: RIVAL_CORNER };
}

export function rivalFrame(r: { corner: CornerId }): Frame { const c = CORNERS[r.corner]; return { originX: c.originX, originZ: c.originZ, flip: !!c.flip }; }
export function rivalShape(r: { sizeId: string; lotRows: number }) {
  const size = SHOP_SIZES.find((s) => s.id === r.sizeId) ?? SHOP_SIZES[1]!;
  return { floor: size.floor, storeroom: size.storeroom, lotRows: r.lotRows };
}

/** Put a rival on a corner: its door point and its bays in world space. */
export function placeRival(r: RivalState, corner: CornerId): void {
  r.corner = corner;
  const fr = rivalFrame(r);
  const door = toWorld(fr, 0, 0.95);
  r.x = door.x; r.z = door.z;
  r.bays = lotLayout(rivalShape(r)).bays.map((b): ParkingBay => { const w = toWorld(fr, b.x, b.z); return { x: w.x, z: w.z, yaw: yawToWorld(fr, b.yaw), carId: null }; });
}

export function makeRivals(playerPlotId = 'main'): RivalState[] {
  const corners = rivalCorners(playerPlotId);
  return RIVAL_DEFS.map((d) => {
    const r: RivalState = { ...d, open: false, saleDaysLeft: 0, nextSaleDay: d.opensDay + 2, cash: 5000, reputation: 0.5, corner: corners[d.id]!, x: 0, z: 0, bays: [], branches: [] };
    placeRival(r, corners[d.id]!);
    return r;
  });
}

/** After the player picks a corner, the rivals settle on the other three. */
export function seatRivals(state: GameState): void {
  const corners = rivalCorners(state.shop.plotId);
  for (const r of state.rivals) if (r.corner !== corners[r.id]) placeRival(r, corners[r.id]!);
}

/** "across Main Road", "across Elm Street" or "diagonally across the crossing", from the player's corner. */
export function whereIs(state: GameState, r: RivalState): string {
  const mine = cornerOfPlot(state.shop.plotId);
  const ns = mine[0] !== r.corner[0], ew = mine[1] !== r.corner[1];
  const name = CORNERS[r.corner].name;
  if (ns && ew) return `diagonally across the crossing, on the ${name}`;
  if (ns) return `across Main Road, on the ${name}`;
  return `across Elm Street, on the ${name}`;
}

/** Rival decisions at the start of each day: open, run sales, drift toward their strategy, advertise. */
export function rivalDay(state: GameState): void {
  for (const r of state.rivals) {
    if (!r.open && state.day >= r.opensDay) {
      r.open = true;
      popup(state, { x: r.x, z: r.z }, `${r.name} just opened`, 'info', 2.2);
      state.notices.push({ day: state.day, text: `${r.name} opened ${whereIs(state, r)}. Expect a few shoppers to stray.`, kind: 'rival' });
      cue(state, 'bad');
      continue;
    }
    if (!r.open) continue;
    if (r.saleDaysLeft > 0) { r.saleDaysLeft--; if (r.saleDaysLeft === 0) r.awareness = Math.max(0.3, r.awareness - 0.05); }
    else if (state.day >= r.nextSaleDay) {
      r.saleDaysLeft = r.kind === 'discount' ? 2 : 1;
      r.nextSaleDay = state.day + withRng(state, 'rivals', (rr) => rr.int(4, 8));
      popup(state, { x: r.x, z: r.z }, `${r.name} is running a sale!`, 'bad', 2.2);
      state.notices.push({ day: state.day, text: `${r.name} (${CORNERS[r.corner].name}) is running a sale. Bargain hunters will cross the road for ${r.saleDaysLeft} day${r.saleDaysLeft > 1 ? 's' : ''}.`, kind: 'rival' });
      cue(state, 'bad');
    }
    // Awareness grows slowly; the chain keeps expanding (each branch off the map adds awareness and parking).
    r.awareness = Math.min(1, r.awareness + 0.01);
    if (r.kind === 'chain' && state.day > r.opensDay + 8 && r.stores < 3 && withRng(state, 'rivals', (rr) => rr.chance(0.15))) {
      r.stores++; r.awareness = Math.min(1, r.awareness + 0.1); r.parking = Math.min(1, r.parking + 0.03);
      const taken = new Set([...r.branches, ...state.franchises.map((f) => f.siteId)]);
      const site = OFFMAP_SITES.find((s) => !taken.has(s.id)) ?? OFFMAP_SITES[r.stores % OFFMAP_SITES.length]!;
      r.branches.push(site.id);
      state.notices.push({ day: state.day, text: `${r.name} opened another branch in ${site.name}, ${site.km} km ${site.dir}.`, kind: 'rival' });
    }
    // Reputation drifts toward quality, dented by the player's reputation lead.
    r.reputation += (r.quality * 0.6 + r.service * 0.4 - r.reputation) * 0.1 - Math.max(0, state.shop.reputation - r.reputation) * 0.02;
  }
}

export function rivalOnSale(state: GameState): RivalState | undefined { return state.rivals.find((r) => r.open && r.saleDaysLeft > 0); }
