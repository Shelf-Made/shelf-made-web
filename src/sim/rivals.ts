/**
 * Rival stores: a discounter, a premium grocer and an expanding chain, each on its own corner
 * of the crossroads. They open over the first days, keep a simple state, and act through the
 * same command layer as the player. MegaMart's extra branches open off the map.
 */
import type { GameState, RivalState, CornerId, ParkingBay, DayPlan, RivalMove, RivalMods, CustomerType } from './types';
import { withRng, popup, cue } from './state';
import { CORNERS, RIVAL_CORNER, SHOP_SIZES, OFFMAP_SITES, PLOTS, BILLBOARDS, cornerOfPlot, lotLayout, toWorld, yawToWorld, type Frame } from './layout';
import { rivalShoppersToday, townGrowth, rivalPriceIndex } from './customers';
import { dollars } from './money';

type RivalDef = Omit<RivalState, 'open' | 'saleDaysLeft' | 'nextSaleDay' | 'cash' | 'reputation' | 'corner' | 'x' | 'z' | 'bays' | 'branches' | 'brokeDays'>;

/**
 * Each rival's daily books: shoppers x average basket x margin, minus fixed costs (rent, staff, power).
 * A sale halves the margin. MegaMart's branches off the map send money back to the crossroads store.
 * Tuned so a strong player can push Cheapo or Fresh & Fine under in weeks three to five, and MegaMart
 * hardly at all.
 */
export const RIVAL_ECON: Record<RivalState['kind'], { basket: number; margin: number; fixed: number; cash: number }> = {
  discount: { basket: 3.6, margin: 0.22, fixed: 45, cash: 600 },
  premium: { basket: 5.4, margin: 0.32, fixed: 80, cash: 900 },
  chain: { basket: 4.6, margin: 0.26, fixed: 95, cash: 2500 },
};
export const BRANCH_SUBSIDY = 40;
/** Closing nights in a row in the red before a rival shuts for good. */
export const BROKE_DAYS_TO_CLOSE = 5;
/** Days a closed corner stays for sale before a challenger moves in. */
export const CHALLENGER_AFTER = 10;
/** What a closed rival's corner sells for, building as it stands. */
export const CORNER_PRICE: Record<RivalState['kind'], number> = { discount: 4500, premium: 5500, chain: 9000 };
/** A challenger's name, by the kind of store it replaces. */
export const CHALLENGER_NAMES: Record<RivalState['kind'], string> = { discount: 'Price Pal', premium: 'Green Basket', chain: 'ValueWorld' };

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
    const r: RivalState = { ...d, open: false, saleDaysLeft: 0, nextSaleDay: d.opensDay + 2, cash: RIVAL_ECON[d.kind].cash, reputation: 0.5, corner: corners[d.id]!, x: 0, z: 0, bays: [], branches: [], brokeDays: 0 };
    placeRival(r, corners[d.id]!);
    return r;
  });
}

/** After the player picks a corner, the rivals settle on the other three. */
export function seatRivals(state: GameState): void {
  const corners = rivalCorners(state.shop.plotId);
  for (const r of state.rivals) { const c = corners[r.id]; if (c && r.corner !== c) placeRival(r, c); }
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

// ---- Moves in answer to the player.

/** How long each move lasts (days), and how long before the same rival makes it again. */
export const MOVE_DAYS: Record<RivalMove, number> = { priceMatch: 7, renovation: 2, renovated: 14, tasting: 1, loyalty: 10, bigSale: 2, billboard: 10, longHours: 10 };
export const MOVE_COOLDOWN: Record<RivalMove, number> = { priceMatch: 10, renovation: 24, renovated: 0, tasting: 7, loyalty: 14, bigSale: 10, billboard: 14, longHours: 14 };
/** Days between any two moves by the same rival. */
export const RIVAL_REST = 4;

/** The moves each kind of store makes: the discounter matches prices, the premium grocer polishes, the chain spends. */
export const MOVES_OF: Record<RivalState['kind'], RivalMove[]> = { discount: ['priceMatch'], premium: ['renovation', 'tasting', 'loyalty'], chain: ['bigSale', 'billboard', 'longHours'] };

/** The player's last three closes, as the rivals read them. */
function watched(state: GameState) { return state.history.slice(-3).filter((d) => d.mine); }

/** What this rival would do about the player right now (before cooldowns and pacing). */
export function triggeredMoves(state: GameState, r: RivalState): RivalMove[] {
  const d = watched(state);
  if (d.length < 2) return [];
  const first = d[0]!.mine!, last = d[d.length - 1]!.mine!;
  const avg = (f: (m: NonNullable<typeof first>) => number) => d.reduce((a, x) => a + f(x.mine!), 0) / d.length;
  const rising = (t: CustomerType) => last.share[t] - first.share[t];
  const out: RivalMove[] = [];
  if (r.kind === 'discount') {
    // Your prices below theirs, or bargain hunters drifting your way.
    if (avg((m) => m.priceIndex) < rivalPriceIndex(r) - 0.01 || rising('bargain') >= 0.04) out.push('priceMatch');
  } else if (r.kind === 'premium') {
    if (avg((m) => m.reputation) > r.reputation + 0.05) out.push('renovation');
    if (rising('impulse') >= 0.03) out.push('tasting');
    if (rising('loyalist') >= 0.03) out.push('loyalty');
  } else {
    // More of the crossroads than MegaMart over the last days.
    const share = (id: string) => d.reduce((a, x) => { const sh = x.shoppers ?? {}; const all = Object.values(sh).reduce((p, q) => p + q, 0) || 1; return a + (sh[id] ?? 0) / all; }, 0) / d.length;
    if (share('player') > share(r.id)) {
      if (r.saleDaysLeft === 0) out.push('bigSale');
      if (freeBillboard(state)) out.push('billboard');
      out.push('longHours');
    }
  }
  return out;
}

/** A billboard site nobody holds (MegaMart buys the first one free). */
function freeBillboard(state: GameState): string | undefined {
  return BILLBOARDS.find((b) => !state.marketing.billboards.includes(b.id) && !state.rivals.some((r) => r.billboard === b.id))?.id;
}

/** Moves this rival may make tomorrow: triggered and off cooldown. */
function readyMoves(state: GameState, r: RivalState, day: number): RivalMove[] {
  if (!r.open || r.renovatingUntil !== undefined || (r.cooldown ?? 0) > day) return [];
  return triggeredMoves(state, r).filter((m) => (r.moveCooldown?.[m] ?? 0) <= day);
}

const MOVE_RUMOURS: Record<RivalMove, (r: RivalState, site?: string) => string> = {
  priceMatch: (r) => `${r.name}'s staff are relabelling the shelves: a price match is coming.`,
  renovation: (r) => `Scaffolders are booked at ${r.name}.`,
  renovated: (r) => `${r.name} reopens tomorrow after its makeover.`,
  tasting: (r) => `${r.name} is handing out tickets for a free tasting tomorrow.`,
  loyalty: (r) => `${r.name} is printing loyalty cards.`,
  bigSale: (r) => `${r.name} is hanging MEGA SALE banners.`,
  billboard: (r, site) => `${r.name} is pasting up a poster on the ${(BILLBOARDS.find((b) => b.id === site)?.name ?? 'billboard').toLowerCase()}.`,
  longHours: (r) => `${r.name} is hiring night staff.`,
};
const MOVE_NOTICES: Record<RivalMove, (r: RivalState) => string> = {
  priceMatch: (r) => `${r.name} is matching your prices: "We match any price!" banners are up, and its sales will be louder for a week.`,
  renovation: (r) => `${r.name} has closed for two days to renovate. Their shoppers are looking elsewhere for now.`,
  renovated: (r) => `${r.name} has reopened: brighter, better stocked, better served.`,
  tasting: (r) => `${r.name} is running a free tasting today. Impulse buyers are flocking over.`,
  loyalty: (r) => `${r.name} launched a loyalty card: regulars get points for coming back.`,
  bigSale: (r) => `${r.name} is running a MEGA SALE: deep cuts for two days.`,
  billboard: (r) => `${r.name} bought a billboard on the crossroads.`,
  longHours: (r) => `${r.name} is open late now: shorter queues at the busy times.`,
};

/** A rival's move today, from its active responses: full strength, fading over the last three days. */
export function computeMods(r: RivalState, day: number): RivalMods {
  const m: RivalMods = { price: 0, quality: 0, service: 0, awareness: 0, availability: 0, saleDepth: 0 };
  for (const x of r.responses ?? []) {
    if (day < x.from || day > x.until) continue;
    const f = Math.min(1, (x.until - day + 1) / 3);
    switch (x.move) {
      case 'priceMatch': m.price += 0.05 * f; m.saleDepth += 0.04; m.awareness += 0.04 * f; break;
      case 'renovated': m.quality += 0.08 * f; m.service += 0.06 * f; break;
      case 'tasting': m.awareness += 0.2; break;
      case 'loyalty': m.availability += 0.08 * f; break;
      case 'bigSale': m.saleDepth += 0.07; m.awareness += 0.1; break;
      case 'billboard': m.awareness += 0.08 * f; break;
      case 'longHours': m.service += 0.1 * f; break;
      case 'renovation': break;
    }
  }
  return m;
}

/** Start a move this morning. */
function startMove(state: GameState, r: RivalState, move: RivalMove, site?: string): void {
  r.responses ??= []; r.moveCooldown ??= {};
  r.responses.push({ move, from: state.day, until: state.day + MOVE_DAYS[move] - 1 });
  r.cooldown = state.day + RIVAL_REST;
  r.moveCooldown[move] = state.day + MOVE_COOLDOWN[move];
  if (move === 'renovation') { r.open = false; r.renovatingUntil = state.day + MOVE_DAYS.renovation; r.saleDaysLeft = 0; }
  if (move === 'bigSale') { r.saleDaysLeft = 2; r.nextSaleDay = state.day + 8; }
  if (move === 'billboard') r.billboard = site && !state.marketing.billboards.includes(site) ? site : freeBillboard(state);
  if (move !== 'renovated') popup(state, { x: r.x, z: r.z }, move === 'priceMatch' ? 'We match any price!' : move === 'renovation' ? 'Closed for renovation' : move === 'tasting' ? 'Free tasting!' : move === 'loyalty' ? 'Loyalty cards!' : move === 'bigSale' ? 'MEGA SALE!' : move === 'longHours' ? 'Open late!' : 'New billboard', 'bad', 2.4);
  state.notices.push({ day: state.day, text: MOVE_NOTICES[move](r), kind: 'rival' });
  cue(state, 'bad');
}

/** Each morning: drop finished moves and work out what the active ones add to the rival's scores. */
function refreshMods(state: GameState, r: RivalState): void {
  if (r.responses?.length) r.responses = r.responses.filter((x) => x.until >= state.day);
  if (r.billboard && !r.responses?.some((x) => x.move === 'billboard')) r.billboard = undefined;
  r.mods = computeMods(r, state.day);
}

/** A closed rival whose corner is up for sale (at most one at a time). */
export function forSale(state: GameState): RivalState | undefined { return state.rivals.find((r) => r.closedDay !== undefined && r.boughtDay === undefined); }

/** Still trading, building, or for sale: anything but a corner the player bought. */
export function cornerLabel(r: RivalState): string { return CORNERS[r.corner].name; }

/**
 * What the rivals will do tomorrow, decided tonight (the 'rivals' random stream, in the same order the
 * day used to roll it): who opens, who starts a sale, whether MegaMart opens a branch. Plus what the
 * town is saying about it.
 */
export function planRivals(state: GameState, day: number): Pick<DayPlan, 'rivals' | 'rumours'> {
  const rivals: DayPlan['rivals'] = [];
  const rumours: string[] = [];
  for (const r of state.rivals) {
    if (r.closedDay !== undefined || r.boughtDay !== undefined) continue;
    if (r.renovatingUntil !== undefined) {
      if (day >= r.renovatingUntil) { rivals.push({ id: r.id, opens: true }); rumours.push(MOVE_RUMOURS.renovated(r)); }
      continue;
    }
    if (!r.open) {
      if (day >= r.opensDay) { rivals.push({ id: r.id, opens: true }); rumours.push(r.challenger ? `A new store, ${r.name}, opens on the ${cornerLabel(r)} tomorrow.` : `${r.name} opens tomorrow ${whereIs(state, r)}.`); }
      continue;
    }
    const plan: DayPlan['rivals'][number] = { id: r.id };
    if (r.saleDaysLeft > 1) rumours.push(`${r.name}'s sale runs another day.`);
    else if (r.saleDaysLeft === 0 && day >= r.nextSaleDay) {
      plan.sale = r.kind === 'discount' ? 2 : 1;
      plan.nextSaleDay = day + withRng(state, 'rivals', (rr) => rr.int(4, 8));
      rumours.push(r.kind === 'discount' ? `${r.name} is printing flyers...` : r.kind === 'premium' ? `${r.name} has a chalkboard out: something is on offer tomorrow.` : `${r.name}'s trucks are unloading pallets of offers...`);
    }
    if (r.kind === 'chain' && day > r.opensDay + 8 && r.stores < 3 && withRng(state, 'rivals', (rr) => rr.chance(0.15))) { plan.branch = true; rumours.push(`${r.name} is hiring for another branch.`); }
    if (r.brokeDays >= 3) rumours.push(`${r.name}'s shelves look thin. Word is they may not last the week.`);
    else if (r.brokeDays >= 1) rumours.push(`Word is ${r.name} is behind on the rent.`);
    rivals.push(plan);
  }
  // At most one move in answer to the player, across all the rivals (the 'rivals' stream picks when several are ready).
  const ready = state.rivals.flatMap((r) => readyMoves(state, r, day).map((move) => ({ r, move })));
  if (ready.length) {
    const pick = ready.length === 1 ? ready[0]! : withRng(state, 'rivals', (rr) => rr.pick(ready));
    const entry = rivals.find((x) => x.id === pick.r.id);
    if (entry && !(pick.move === 'bigSale' && entry.sale)) {
      entry.move = pick.move;
      if (pick.move === 'billboard') entry.site = freeBillboard(state);
      rumours.push(MOVE_RUMOURS[pick.move](pick.r, entry.site));
    }
  }
  const fs = forSale(state);
  if (fs) rumours.push(day - fs.closedDay! >= CHALLENGER_AFTER - 1 ? `Builders are measuring up the old ${fs.name} on the ${cornerLabel(fs)}.` : `The old ${fs.name} on the ${cornerLabel(fs)} is for sale: ${dollars(CORNER_PRICE[fs.kind])}.`);
  return { rivals, rumours };
}

/** Rival moves at the start of the day, as planned last night: open, run sales, drift toward their strategy, advertise. */
export function rivalDay(state: GameState, plan: Pick<DayPlan, 'rivals'>): void {
  for (const r of state.rivals) {
    const p = plan.rivals.find((x) => x.id === r.id);
    if (!r.open && p?.opens && r.renovatingUntil !== undefined) {
      r.open = true; r.renovatingUntil = undefined;
      startMove(state, r, 'renovated');
      refreshMods(state, r);
      continue;
    }
    if (!r.open && p?.opens) {
      r.open = true;
      popup(state, { x: r.x, z: r.z }, `${r.name} just opened`, 'info', 2.2);
      state.notices.push({ day: state.day, text: `${r.name} opened ${whereIs(state, r)}. Expect a few shoppers to stray.`, kind: 'rival' });
      cue(state, 'bad');
      continue;
    }
    if (!r.open) continue;
    if (r.saleDaysLeft > 0) { r.saleDaysLeft--; if (r.saleDaysLeft === 0) r.awareness = Math.max(0.3, r.awareness - 0.05); }
    else if (p?.sale) {
      r.saleDaysLeft = p.sale;
      r.nextSaleDay = p.nextSaleDay ?? state.day + 6;
      popup(state, { x: r.x, z: r.z }, `${r.name} is running a sale!`, 'bad', 2.2);
      state.notices.push({ day: state.day, text: `${r.name} (${CORNERS[r.corner].name}) is running a sale. Bargain hunters will cross the road for ${r.saleDaysLeft} day${r.saleDaysLeft > 1 ? 's' : ''}.`, kind: 'rival' });
      cue(state, 'bad');
    }
    // Awareness grows slowly; the chain keeps expanding (each branch off the map adds awareness and parking).
    r.awareness = Math.min(1, r.awareness + 0.01);
    if (p?.branch) {
      r.stores++; r.awareness = Math.min(1, r.awareness + 0.1); r.parking = Math.min(1, r.parking + 0.03);
      const taken = new Set([...r.branches, ...state.franchises.map((f) => f.siteId)]);
      const site = OFFMAP_SITES.find((s) => !taken.has(s.id)) ?? OFFMAP_SITES[r.stores % OFFMAP_SITES.length]!;
      r.branches.push(site.id);
      state.notices.push({ day: state.day, text: `${r.name} opened another branch in ${site.name}, ${site.km} km ${site.dir}.`, kind: 'rival' });
    }
    // Reputation drifts toward quality, dented by the player's reputation lead.
    r.reputation += (r.quality * 0.6 + r.service * 0.4 - r.reputation) * 0.1 - Math.max(0, state.shop.reputation - r.reputation) * 0.02;
    if (p?.move) startMove(state, r, p.move, p.site);
    refreshMods(state, r);
  }
}

/**
 * The rivals' books at close: today's shoppers (the same model the crossroads share uses), sales,
 * margin and fixed costs. Five nights in a row in the red and a rival shuts (one closed corner at a
 * time); a corner nobody buys gets a challenger after ten days. Returns each open rival's shoppers.
 */
export function rivalsNight(state: GameState): Record<string, number> {
  const shoppers = rivalShoppersToday(state);
  for (const r of state.rivals) {
    if (!r.open) continue;
    const e = RIVAL_ECON[r.kind];
    const n = shoppers[r.id] ?? 0;
    const sales = n * e.basket;
    const profit = sales * e.margin * (r.saleDaysLeft > 0 ? 0.5 : 1) - e.fixed * townGrowth(state.day) + (r.kind === 'chain' ? (r.stores - 1) * BRANCH_SUBSIDY : 0);
    r.cash = Math.round((r.cash + profit) * 100) / 100;
    r.lastShoppers = Math.round(n); r.lastSales = Math.round(sales); r.lastProfit = Math.round(profit);
    const wasBroke = r.brokeDays > 0;
    r.brokeDays = r.cash < 0 ? r.brokeDays + 1 : 0;
    if (r.brokeDays === 1 && !wasBroke) state.notices.push({ day: state.day, text: `${r.name} is losing money: their takings no longer cover the rent.`, kind: 'rival' });
    if (r.brokeDays >= BROKE_DAYS_TO_CLOSE && !forSale(state)) closeRival(state, r);
  }
  const fs = forSale(state);
  if (fs && state.day - fs.closedDay! >= CHALLENGER_AFTER) challenge(state, fs);
  return shoppers;
}

/** A rival shuts: the sign comes down, a "For sale" board goes up, its shoppers spread over the rest. */
export function closeRival(state: GameState, r: RivalState): void {
  r.open = false; r.closedDay = state.day; r.saleDaysLeft = 0;
  popup(state, { x: r.x, z: r.z }, `${r.name} has closed`, 'info', 2.6);
  state.notices.push({ day: state.day, text: `${r.name} has closed for good after a week in the red. Their shoppers are looking for a new store, and the corner is for sale (${dollars(CORNER_PRICE[r.kind])}, Build card).`, kind: 'rival' });
  cue(state, 'reward');
}

/** Nobody bought the corner: a challenger fits it out and opens tomorrow, in its own colours. */
function challenge(state: GameState, old: RivalState): void {
  const def = RIVAL_DEFS.find((d) => d.kind === old.kind) ?? RIVAL_DEFS[0]!;
  const n = state.rivals.filter((r) => r.challenger).length + 1;
  const r: RivalState = {
    ...def, id: `challenger${n}`, name: CHALLENGER_NAMES[old.kind], challenger: true, opensDay: state.day + 1, open: false,
    saleDaysLeft: 0, nextSaleDay: state.day + 4, cash: RIVAL_ECON[old.kind].cash, reputation: 0.45, awareness: 0.45, stores: 1, branches: [], brokeDays: 0,
    corner: old.corner, x: 0, z: 0, bays: [],
  };
  placeRival(r, old.corner);
  state.rivals[state.rivals.indexOf(old)] = r;
  state.notices.push({ day: state.day, text: `Nobody bought the old ${old.name}: ${r.name} has taken the ${cornerLabel(r)} and opens tomorrow.`, kind: 'rival' });
}

/**
 * Buy a closed rival's corner, building as it stands. It trades as one of your branches (a manager
 * runs it by your rules, reports each night), in your colours and under your name.
 */
export function buyCorner(state: GameState, rivalId: string, managerId: number): string | null {
  const r = state.rivals.find((x) => x.id === rivalId);
  if (!r || r.closedDay === undefined || r.boughtDay !== undefined) return 'That corner is not for sale.';
  const price = CORNER_PRICE[r.kind];
  const c = state.staffPool.find((x) => x.id === managerId && x.role === 'manager');
  if (!c) return "Pick a manager from today's pool to run it.";
  if (state.cash < price) return `Need ${dollars(price)} for the corner.`;
  state.cash -= price;
  state.staffPool = state.staffPool.filter((x) => x.id !== c.id);
  r.boughtDay = state.day;
  const name = `${state.shop.name} ${CORNERS[r.corner].name.replace(' corner', '').replace(/(^|-)\w/g, (m) => m.toUpperCase())}`;
  state.franchises.push({ id: state.nextId++, siteId: `corner-${r.corner}`, corner: r.corner, name, manager: c, openedDay: state.day, stockLevel: 0.7, reputation: state.shop.reputation, cashToday: 0, history: [], alerts: [] });
  popup(state, { x: r.x, z: r.z }, `${name} is yours!`, 'money', 2.6);
  state.notices.push({ day: state.day, text: `You bought the old ${r.name}. ${name} opens tomorrow with ${c.name} as manager.`, kind: 'info' });
  cue(state, 'reward');
  return null;
}

/** The traffic a corner gets (the south-east corner trades like the town average). */
export function cornerTraffic(corner: CornerId): number { return PLOTS.find((p) => p.corner === corner)?.traffic ?? 1; }

export function rivalOnSale(state: GameState): RivalState | undefined { return state.rivals.find((r) => r.open && r.saleDaysLeft > 0); }
