/**
 * Balance harness: scripted strategies over many seeds, asserting the game is fair.
 *   npm run balance            prints a table
 *   npm run balance -- --check exits non-zero when any assertion fails
 *   --progress prints each run's time; --only franchiser:3 runs one strategy (and seed); --trace prints it day by day
 */
import { newGame, tick, applyCommand, DAY_SECONDS, TICK, resetGridCache, FIXTURES, PRODUCTS, playerShare, GOALS, playerShareOf, SHOP_SIZES, type GameState, type Difficulty, type FixtureType } from '../src/sim/index';
import { STARTER_SHELF, STARTER_FRIDGE } from '../src/sim/products';
import { TYPE_BASE, priceIndex, rivalPriceIndex } from '../src/sim/customers';
import { plotDef, BAY_PRICE, storageCap } from '../src/sim/layout';
import { lotSlots } from '../src/sim/lot';
import { writeFileSync } from 'node:fs';

type Strategy = (s: GameState, day: number) => void;

const sellers = (s: GameState) => s.shop.fixtures.filter((f) => FIXTURES[f.type].slots > 0);
const storageUnits = (s: GameState) => s.shop.storage.reduce((a, e) => a + e.qty, 0);

function orderToFill(s: GameState, supplier: string, mul = 1.5, cap = Infinity): void {
  const need = new Map<string, number>();
  for (const f of sellers(s)) for (const sl of f.slots) if (sl.productId) need.set(sl.productId, (need.get(sl.productId) ?? 0) + Math.max(0, Math.ceil(FIXTURES[f.type].capacity * mul - sl.qty)));
  for (const e of s.shop.storage) need.set(e.productId, Math.max(0, (need.get(e.productId) ?? 0) - e.qty));
  let budget = Math.min(cap, s.cash * 0.6);
  let room = storageCap(s.shop) - storageUnits(s);
  const lines: { productId: string; qty: number }[] = [];
  for (const [productId, qty0] of need) {
    const qty = Math.min(qty0, room);
    if (qty <= 0) continue;
    const cost = qty * (PRODUCTS.find((p) => p.id === productId)?.cost ?? 1);
    if (cost > budget) continue;
    budget -= cost; room -= qty; lines.push({ productId, qty });
  }
  if (lines.length) applyCommand(s, { type: 'placeOrder', supplierId: supplier, lines });
}

/** Fill empty slots with products the shop does not sell yet, best sellers first (what the Stock card's "new lines" does). */
function orderNew(s: GameState, budget: number): void {
  const stocked = new Set<string>([...s.shop.storage.map((e) => e.productId), ...s.shop.fixtures.flatMap((f) => f.slots.map((sl) => sl.productId).filter((x): x is string => !!x))]);
  for (const o of s.orders) if (o.state !== 'delivered') for (const l of o.lines) stocked.add(l.productId);
  const lines: { productId: string; qty: number }[] = [];
  let room = storageCap(s.shop) - storageUnits(s);
  for (const f of sellers(s)) {
    const def = FIXTURES[f.type];
    for (const sl of f.slots) {
      if (sl.productId) continue;
      const p = PRODUCTS.filter((x) => !stocked.has(x.id) && (x.chilled ? def.chilled : !def.chilled || f.type === 'fridge') && (!def.accepts || def.accepts.includes(x.category))).sort((a, b) => b.demand - a.demand)[0];
      if (!p) continue;
      const qty = Math.min(def.capacity, room);
      if (qty <= 0 || qty * p.cost > budget) continue;
      budget -= qty * p.cost; room -= qty; stocked.add(p.id);
      lines.push({ productId: p.id, qty });
    }
  }
  if (lines.length) applyCommand(s, { type: 'placeOrder', supplierId: 'local', lines });
}

function carryAll(s: GameState): void {
  for (const f of sellers(s)) applyCommand(s, { type: 'carry', fixtureId: f.id });
}

/**
 * The first five minutes, paid for like a player would: a counter, two shelves and a chiller from
 * the starting cash, a first order, the truck, carrying every box onto the shelves, then Open shop.
 */
function fitOut(s: GameState): void {
  const f = s.shop.floor;
  for (const [fixtureType, x, z, rot] of [['register', f.x1 - 1, f.z1 - 3, 2], ['shelf', f.x0, f.z0 + 2, 1], ['shelf', f.x0, f.z0 + 3, 1], ['fridge', f.x1 - 1, f.z0, 3]] as const) {
    const r = applyCommand(s, { type: 'placeFixture', fixtureType, x, z, rot });
    if (!r.ok) throw new Error(`fit-out: ${r.message}`);
  }
  const r = applyCommand(s, { type: 'placeOrder', supplierId: 'local', lines: [...STARTER_SHELF.map((productId) => ({ productId, qty: 10 })), ...STARTER_FRIDGE.map((productId) => ({ productId, qty: 8 }))] });
  if (!r.ok) throw new Error(`fit-out order: ${r.message}`);
  for (let i = 0; i < 6000 && (s.orders.some((o) => o.state !== 'delivered') || s.shop.storage.some((e) => e.qty > 0)); i++) { tick(s); if (i % 40 === 0) carryAll(s); }
  const open = applyCommand(s, { type: 'openShop' });
  if (!open.ok) throw new Error(`fit-out open: ${open.message}`);
}

/** Free floor tiles a sensible player would build on: not the door column, not the front row, every other column left for walking. */
function freeTiles(s: GameState): { x: number; z: number }[] {
  const f = s.shop.floor;
  const out: { x: number; z: number }[] = [];
  for (let z = f.z0; z < f.z1 - 1; z++) for (let x = f.x0; x < f.x1; x++) {
    // (A wall stands on an edge of its tile, not on it.)
    if (s.shop.fixtures.some((fx) => fx.x === x && fx.z === z && !FIXTURES[fx.type].edge)) continue;
    // Keep the door column and the row in front of the register clear.
    if (Math.abs(x + 0.5) < 1 && z >= f.z1 - 2) continue;
    if (z === f.z1 - 1) continue;
    // Leave every other column free so people can walk.
    if ((x - f.x0) % 2 === 1) continue;
    out.push({ x, z });
  }
  return out;
}
const freeTile = (s: GameState) => freeTiles(s)[0] ?? null;

/** Place a fixture on the first free tile where it fits (one that would box the manager in is refused, so try the next). */
function placeSomewhere(s: GameState, fixtureType: FixtureType): boolean {
  for (const t of freeTiles(s)) if (applyCommand(s, { type: 'placeFixture', fixtureType, x: t.x, z: t.z, rot: 0 }).ok) return true;
  return false;
}

/** The undercutter cuts every price to 80% of the town's from day 4 (Cheapo opens on day 3). */
const UNDERCUT_FROM = 4;

const STRATEGIES: Record<string, Strategy> = {
  cautious: (s, day) => { if (day % 2 === 1 && s.cash > 150) orderToFill(s, 'local', 2.0, 160); },
  aggressive: (s, day) => {
    if (s.cash > 250) orderToFill(s, 'local', 2, 400);
    if (day >= 2 && s.cash > 500) { const t = freeTile(s); if (t) applyCommand(s, { type: 'placeFixture', fixtureType: 'shelf', x: t.x, z: t.z, rot: 0 }); }
    for (const id of Object.keys(s.prices)) applyCommand(s, { type: 'setPrice', productId: id, price: (PRODUCTS.find((p) => p.id === id)?.basePrice ?? 1) * 1.12 });
  },
  delegator: (s, day) => {
    if (s.cash > 200) orderToFill(s, 'local', 2.5, 300);
    // Hands the work over one hire at a time, when the till can carry the wage.
    const has = (role: string) => s.people.some((p) => p.kind === 'staff' && p.role === role);
    const hire = (role: 'cashier' | 'stocker', cushion: number) => { const c = s.staffPool.find((x) => x.role === role); if (c && s.cash > c.wage * cushion) applyCommand(s, { type: 'hire', candidateId: c.id }); };
    if (day >= 3 && !has('cashier')) hire('cashier', 8);
    else if (day >= 5 && has('cashier') && !has('stocker')) hire('stocker', 14);
  },
  franchiser: (s, day) => {
    if (s.cash > 200) orderToFill(s, 'local', 2.5, 320);
    if (day >= 3) { const c = s.staffPool.find((x) => x.role === 'cashier'); if (c && !s.people.some((p) => p.kind === 'staff' && p.role === 'cashier') && s.cash > 300) applyCommand(s, { type: 'hire', candidateId: c.id }); }
    if (day >= 6 && s.cash > 1200 && s.shop.sizeId === 'starter') applyCommand(s, { type: 'expandShop', sizeId: 'medium' });
  },
  careless: (s, day) => {
    // Fills the floor with shelves in a bad layout and never restocks sensibly.
    if (day >= 2) { for (let i = 0; i < 3; i++) { const t = freeTile(s); if (t && s.cash > 200) applyCommand(s, { type: 'placeFixture', fixtureType: 'shelf', x: t.x, z: t.z, rot: 1 }); } }
    if (day % 3 === 0 && s.cash > 100) orderToFill(s, 'express', 1, 150);
  },
  guided: (s, day) => {
    // What the tips and the goal ladder teach: scan, carry, keep prices near average, stock first every morning and
    // keep a cushion for it; add a shelf (and new lines for it) when cash allows, a cashier when the staff card
    // opens; from the second week move up to the 7×7 shop (a small loan bridges the gap), double the lot once
    // drivers are turned away, hand out flyers, and build the market hall when the goal asks for it.
    const goal = GOALS[s.goals.index]?.id;
    const has = (role: string) => s.people.some((p) => p.kind === 'staff' && p.role === role);
    const last = s.history[s.history.length - 1];
    const reserve = 300;
    const can = (cost: number) => s.cash - cost >= reserve;
    // Moving up comes first on the morning it is affordable (with $200 kept back for the day's stock).
    if (s.shop.sizeId === 'starter' && day >= 6 && s.cash - SHOP_SIZES[1]!.cost >= 200) applyCommand(s, { type: 'expandShop', sizeId: 'medium' });
    // A bigger shop has room for more bays down its side: paint them in the first row.
    if (s.shop.sizeId !== 'starter') for (const sl of lotSlots(s.shop)) if (sl.row === 0 && sl.fid === undefined && can(BAY_PRICE)) applyCommand(s, { type: 'paintBay', slot: sl.id });
    // And the second row once drivers are being turned away.
    const freeBays = lotSlots(s.shop).filter((sl) => sl.fid === undefined).length;
    if (s.shop.sizeId !== 'starter' && freeBays > 0 && (last?.turnedAway ?? 0) >= 15 && s.cash - freeBays * BAY_PRICE >= 200) applyCommand(s, { type: 'expandLot' });
    if (s.cash > 120) orderToFill(s, 'local', 2.5, Math.max(220, s.cash * 0.5));
    if (s.cash > reserve) orderNew(s, (s.cash - reserve) * 0.5);
    if (goal === 'hall' && s.shop.sizeId === 'medium' && can(SHOP_SIZES[2]!.cost - SHOP_SIZES[1]!.cost)) applyCommand(s, { type: 'expandShop', sizeId: 'large' });
    const cap = s.shop.sizeId === 'starter' ? 5 : s.shop.sizeId === 'medium' ? 9 : 13;
    for (let i = 0; i < 2; i++) if (day >= 2 && can(90) && sellers(s).length < cap) placeSomewhere(s, (day + i) % 2 ? 'shelf' : 'produce');
    if (day >= 4 && can(150) && !has('cashier')) { const c = s.staffPool.find((x) => x.role === 'cashier'); if (c) applyCommand(s, { type: 'hire', candidateId: c.id }); }
    if (s.shop.sizeId !== 'starter' && s.shop.lotRows > 1 && can(100) && has('cashier') && !has('stocker')) { const c = s.staffPool.find((x) => x.role === 'stocker'); if (c) applyCommand(s, { type: 'hire', candidateId: c.id }); }
    if (s.unlocks.marketing && s.shop.awareness < 0.8 && can(150) && day % 4 === 1) applyCommand(s, { type: 'flyers', areaId: ['hillside', 'eastend', 'elmheights', 'riverside'][day % 4]! });
  },
  undercutter: (s, day) => {
    // Plays like the guided player, but prices everything 20% under the town from day 4 on.
    STRATEGIES.guided!(s, day);
    if (day === UNDERCUT_FROM) for (const p of PRODUCTS) applyCommand(s, { type: 'setPrice', productId: p.id, price: p.basePrice * 0.8 });
  },
};

interface Run { matchDay: number; gapBefore: number; gapAfter: number; bust8: boolean; trace: { day: number; shoppers: Record<string, number>; sale: Record<string, boolean>; open: Record<string, boolean>; revenue: number }[]; strategy: string; seed: number; days: number; fitOutLeft: number; endCash: number; cash8: number; minCash: number; bust: boolean; profitableBy: number; totalServed: number; stuck: number; history: number[]; served: number[]; salePull: number; rivalTake: number; goalDays: Record<string, number>; closed: { id: string; day: number }[] }

function runGame(strategy: string, seed: number, days: number, difficulty: Difficulty = 'standard'): Run {
  resetGridCache();
  const s = newGame({ seed, difficulty, plotId: ['main', 'elm', 'bus'][seed % 3], name: 'Balance', tutorial: false });
  fitOut(s);
  const fitOutLeft = s.cash;
  const act = STRATEGIES[strategy]!;
  let minCash = s.cash, profitableBy = 0, totalServed = 0, cash8 = 0, bust8 = false, matchDay = 0, gapBefore = 0, gapAfter = Infinity;
  const closed: { id: string; day: number }[] = [];
  const dayLog: Run['trace'] = [];
  const history: number[] = [];
  const served: number[] = [];
  let salePull = 0;
  const takes: number[] = [];
  const trace = process.argv.includes('--trace');
  const shelfDays = process.argv.includes('--shelves') ? process.argv[process.argv.indexOf('--shelves') + 1]!.split(',').map(Number) : [];
  for (let day = 1; day <= days; day++) {
    const t0 = Date.now();
    act(s, day);
    const hasCashier = () => s.people.some((p) => p.kind === 'staff' && p.role === 'cashier');
    // In person, like a player: scan when somebody is waiting at the till, otherwise restock.
    const owner = s.people.find((p) => p.kind === 'owner')!;
    const waiting = () => s.shop.fixtures.some((f) => f.type === 'register' && (f.serving !== null && f.serving !== undefined || (f.queue?.length ?? 0) > 0));
    const busy = () => !!owner.task || !!owner.carrying;
    let dumped = false;
    for (let i = 0; i < (DAY_SECONDS + 130) / TICK && s.phase !== 'night'; i++) {
      tick(s);
      // --trace: at midday with nobody served yet, show the tills and who is on them.
      if (trace && i === Math.round(DAY_SECONDS / 2 / TICK) && s.today.served === 0 && s.today.customers > 5) {
        for (const f of s.shop.fixtures.filter((x) => x.type === 'register' || x.type === 'kiosk')) {
          console.log(`    till ${f.id} at ${f.x},${f.z} rot ${f.rot} staff ${f.staffId ?? '-'} serving ${f.serving ?? '-'} queue ${(f.queue ?? []).length}`);
          for (const id of (f.queue ?? []).slice(0, 4)) { const q = s.people.find((x) => x.id === id); console.log(`      in line ${id}: ${q ? `${q.state} at ${q.x.toFixed(2)},${q.z.toFixed(2)} path ${q.pathIdx}/${q.path.length} -> ${q.path[q.path.length - 1] ? q.path[q.path.length - 1]!.x.toFixed(2) + ',' + q.path[q.path.length - 1]!.z.toFixed(2) : '-'}` : 'missing'}`); }
        }
        for (const p of s.people.filter((x) => x.kind === 'staff' || x.kind === 'owner')) console.log(`    ${p.kind} ${p.role ?? ''} ${p.id} ${p.state} at ${p.x.toFixed(2)},${p.z.toFixed(2)} path ${p.pathIdx}/${p.path.length} task ${JSON.stringify(p.task)} shift ${p.shift ?? '-'} carrying ${JSON.stringify(p.carrying)}`);
        for (const p of s.people.filter((x) => x.kind === 'customer').slice(0, 6)) console.log(`    customer ${p.id} ${p.state} at ${p.x.toFixed(2)},${p.z.toFixed(2)} patience ${p.patience?.toFixed?.(0)} basket ${(p.basket ?? []).length}`);
      }
      // --trace: the first time traffic piles up, show the longest-waiting car, its neighbours and their drivers.
      if (trace && !dumped && s.cars.length > 40) {
        dumped = true;
        console.log(`    jam at day ${day} t=${s.time.toFixed(1)}`);
        const worst = s.cars.reduce((a, c) => ((c.waited ?? 0) > (a.waited ?? 0) ? c : a));
        const fmt = (c: typeof worst) => `      car ${c.id} ${c.state} lot=${c.lot ?? '-'} bay=${c.bay} at ${c.x.toFixed(2)},${c.z.toFixed(2)} yaw ${c.yaw.toFixed(2)} waited ${(c.waited ?? 0).toFixed(1)} rev=${!!c.reversing} yield=${!!c.yielding} gap=${c.gap?.toFixed(2)} path ${c.pathIdx}/${c.path.length} ${c.path.map((p) => p.x.toFixed(1) + ',' + p.z.toFixed(1)).join(' ')}`;
        console.log('    near the worst:');
        for (const c of s.cars.filter((c) => Math.hypot(c.x - worst.x, c.z - worst.z) < 3)) { console.log(fmt(c)); const o = s.people.find((p) => p.id === c.ownerId); console.log(`        owner ${c.ownerId}: ${o ? `${o.kind} ${o.state} at ${o.x.toFixed(1)},${o.z.toFixed(1)} rival=${o.rivalId ?? '-'} path ${o.pathIdx}/${o.path.length}` : 'gone'}`); }
      }
      // --shelves 17,20: at midday on those days, what is on the pallet and on each shelf, and what the workers are doing.
      if (shelfDays.includes(day) && i === Math.round(DAY_SECONDS / 2 / TICK)) {
        const st = new Map<string, number>(); for (const e of s.shop.storage) st.set(e.productId, (st.get(e.productId) ?? 0) + e.qty);
        console.log(`    day ${day} pallet: ${[...st].map(([k, v]) => `${k} ${v}`).join(', ') || 'empty'}`);
        for (const f of sellers(s)) console.log(`      ${f.type} ${f.id} at ${f.x},${f.z}: ${f.slots.map((sl) => `${sl.productId ?? '-'} ${sl.qty}`).join(', ')}`);
        for (const p of s.people.filter((x) => x.kind === 'staff' || x.kind === 'owner')) console.log(`      ${p.kind}${p.role ? ' ' + p.role : ''}: ${p.state}${p.task ? ` (${p.task.productId} for ${p.task.fixtureId})` : ''}${p.carrying ? `, holding ${p.carrying.qty} ${p.carrying.productId}` : ''}`);
      }
      const scanner = !hasCashier();
      if (scanner && waiting() && !busy() && i % (strategy === 'careless' ? 14 : 6) === 0) applyCommand(s, { type: 'scan' });
      if (i % 60 === 0 && (!scanner || !waiting())) carryAll(s);
      // The guided player reorders when the pallet runs low (the truck is there in a minute and a half).
      if (strategy === 'guided' && i % 1200 === 600 && s.phase === 'open' && storageUnits(s) < storageCap(s.shop) * 0.3 && !s.orders.some((o) => o.state !== 'delivered') && s.cash > 250) orderToFill(s, 'local', 2.0, (s.cash - 200) * 0.6);
      if (s.cash < minCash) minCash = s.cash;
    }
    if (trace) { const h = s.history[s.history.length - 1]; console.log(`    day ${day}: ${Date.now() - t0}ms, ${s.people.length} people, ${s.cars.length} cars, $${s.cash.toFixed(0)}, ${s.shop.sizeId}${h ? `, ${h.customers} came, ${h.served} served, ${h.walkedOut} walked out, ${h.turnedAway} turned away, ${h.missedItems} missed, profit ${h.profit.toFixed(0)}` : ''}, staff ${s.people.filter((p) => p.kind === 'staff').map((p) => p.role).join('/') || '-'}, rivals ${s.rivals.filter((r) => r.open).map((r) => r.id).join('/') || '-'}`); }
    if (s.phase !== 'night') break;
    const d = s.history[s.history.length - 1]!;
    history.push(d.profit); served.push(d.served); totalServed += d.served;
    // How much a rival sale pulls bargain hunters, measured on the live state.
    const open = s.rivals.find((r) => r.open);
    if (open) { const before = playerShare(s).bargain; const keep = open.saleDaysLeft; open.saleDaysLeft = 2; const during = playerShare(s).bargain; open.saleDaysLeft = keep; salePull = Math.max(salePull, before - during); }
    // The rivals' part of this corner's trade tonight, weighted by who comes past the corner (week one only).
    if (day <= 7) {
      const share = playerShare(s), mix = plotDef(s.shop.plotId).mix;
      let all = 0, mine = 0;
      for (const t of Object.keys(TYPE_BASE) as (keyof typeof TYPE_BASE)[]) { const w = TYPE_BASE[t] * mix[t]; all += w; mine += w * share[t]; }
      takes.push(1 - mine / all);
    }
    if (d.profit > 0 && !profitableBy) profitableBy = day;
    if (day === 8) { cash8 = s.cash; bust8 = s.gameOver; }
    // The undercutter: when does Cheapo answer, and how much of the price gap is left a week on?
    { const c = s.rivals.find((r) => r.id === 'discount');
      if (c && strategy === 'undercutter') {
        if (!matchDay && c.responses?.some((x) => x.move === 'priceMatch')) matchDay = s.day;
        const gap = rivalPriceIndex(c) - priceIndex(s);
        if (day === UNDERCUT_FROM) gapBefore = c.priceIndex - priceIndex(s);
        if (day > UNDERCUT_FROM && day <= UNDERCUT_FROM + 7) gapAfter = Math.min(gapAfter, gap);
      } }
    dayLog.push({ day, shoppers: { ...(d.shoppers ?? {}) }, sale: Object.fromEntries(s.rivals.map((r) => [r.id, r.saleDaysLeft > 0])), open: Object.fromEntries(s.rivals.map((r) => [r.id, r.open])), revenue: d.revenue });
    for (const r of s.rivals) if (r.closedDay === s.day && !closed.some((c) => c.id === r.id)) closed.push({ id: r.id, day: s.day });
    if (trace || process.argv.includes('--goals')) {
      const share = playerShareOf(d);
      console.log(`    day ${String(day).padStart(2)} ${s.shop.sizeId.padEnd(7)}${s.shop.lotRows > 1 ? '+lot' : ''} goal ${GOALS[s.goals.index]?.id ?? 'done'} run ${s.goals.run} share ${share === null ? '-' : (share * 100).toFixed(0) + '%'} you ${d.shoppers?.player ?? 0} srv ${d.served} out ${d.walkedOut} lot ${d.turnedAway} miss ${d.missedItems} fx ${sellers(s).length} tills ${s.shop.fixtures.filter((f) => f.type === 'register').length} st ${s.people.filter((p) => p.kind === 'staff').length} sold $${d.revenue.toFixed(0)} net $${d.profit.toFixed(0)} cash $${s.cash.toFixed(0)} rep ${(s.shop.reputation * 100).toFixed(0)}% stuck ${s.stuckRescues} | ${s.rivals.map((r) => `${r.name} ${r.open ? `${r.lastShoppers ?? 0} $${r.lastSales ?? 0} ${(r.lastProfit ?? 0) >= 0 ? '+' : ''}${r.lastProfit ?? 0} cash ${Math.round(r.cash)}${r.saleDaysLeft ? ' SALE' : ''}` : r.closedDay !== undefined ? `CLOSED d${r.closedDay}` : '-'}`).join(' | ')}`);
    }
    if (s.gameOver) break;
    applyCommand(s, { type: 'openTomorrow' });
  }
  const rivalTake = takes.length ? takes.reduce((a, b) => a + b, 0) / takes.length : 0;
  if (process.argv.includes('--shares')) console.log(`  ${strategy} seed ${seed} (${s.shop.plotId}): rivals take ${takes.map((t) => (t * 100).toFixed(0) + '%').join(' ')} by day; week one ${(rivalTake * 100).toFixed(0)}%`);
  const goalDays: Record<string, number> = {};
  for (const g of s.goals.done) goalDays[g.id] = g.day;
  return { matchDay, gapBefore, gapAfter, bust8: bust8 || (s.gameOver && days <= 8), trace: dayLog, strategy, seed, days, fitOutLeft, endCash: s.cash, cash8: cash8 || s.cash, minCash, bust: s.gameOver, profitableBy, totalServed, stuck: s.stuckRescues, history, served, salePull, rivalTake, goalDays, closed };
}

/** One game in a child process (the parent runs several at once): prints the run as JSON on its last line. */
function worker(spec: string): void {
  const [strategy, seed, days] = spec.split(':');
  const run = runGame(strategy!, Number(seed), Number(days));
  process.stdout.write(`\n@@RUN ${JSON.stringify(run)}\n`);
}

/** Run games across the machine's cores (a forty-day game takes a couple of minutes). */
async function runParallel(jobs: { strategy: string; seed: number; days: number }[], width: number): Promise<Run[]> {
  const { spawn } = await import('node:child_process');
  const out: Run[] = new Array(jobs.length);
  let next = 0;
  const one = async (): Promise<void> => {
    while (next < jobs.length) {
      const i = next++, j = jobs[i]!;
      const t = Date.now();
      const text = await new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, [...process.execArgv, process.argv[1]!, '--worker', `${j.strategy}:${j.seed}:${j.days}`], { stdio: ['ignore', 'pipe', 'inherit'] });
        let buf = '';
        child.stdout.on('data', (d: Buffer) => { buf += d.toString(); });
        child.on('exit', (code) => (code === 0 ? resolve(buf) : reject(new Error(`${j.strategy} seed ${j.seed} exited ${code}`))));
      });
      const line = text.split('\n').find((l) => l.startsWith('@@RUN '));
      if (!line) throw new Error(`${j.strategy} seed ${j.seed}: no result`);
      out[i] = JSON.parse(line.slice(6)) as Run;
      if (process.argv.includes('--progress')) console.log(`  ${j.strategy} seed ${j.seed}: ${Date.now() - t}ms`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, width) }, one));
  return out;
}

async function main(): Promise<void> {
  if (process.argv.includes('--worker')) { worker(process.argv[process.argv.indexOf('--worker') + 1]!); return; }
  const check = process.argv.includes('--check');
  const seeds = [1, 2, 3, 4, 5, 6];
  // Everyone plays twelve days (no rival may close before day 12); the guided player plays forty, up the goal ladder.
  const daysFor = (strategy: string) => Number(process.argv[process.argv.indexOf('--days') + 1]) || (strategy === 'guided' ? 40 : strategy === 'undercutter' ? 14 : 12);
  const t0 = Date.now();
  // --only guided:3 (one strategy and seed), --only cautious,careless (several strategies). Played in this process, so --trace works.
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1]!.split(',').map((x) => x.split(':')) : null;
  const jobs: { strategy: string; seed: number; days: number }[] = [];
  for (const strategy of Object.keys(STRATEGIES)) for (const seed of seeds) {
    if (only && !only.some(([st, sd]) => st === strategy && (!sd || Number(sd) === seed))) continue;
    jobs.push({ strategy, seed, days: daysFor(strategy) });
  }
  // The long guided games first, so the short ones fill in around them.
  jobs.sort((a, b) => b.days - a.days);
  let runs: Run[];
  if (only || process.argv.includes('--serial')) {
    runs = [];
    for (const j of jobs) { const t = Date.now(); runs.push(runGame(j.strategy, j.seed, j.days)); if (process.argv.includes('--progress')) console.log(`  ${j.strategy} seed ${j.seed}: ${Date.now() - t}ms`); }
  } else {
    const { cpus } = await import('node:os');
    runs = await runParallel(jobs, Number(process.argv[process.argv.indexOf('--jobs') + 1]) || cpus().length);
  }
  if (process.argv.includes('--dump')) writeFileSync(process.argv[process.argv.indexOf('--dump') + 1]!, JSON.stringify(runs.map((r) => ({ strategy: r.strategy, seed: r.seed, trace: r.trace }))));
  const failures: string[] = [];
  const by = (name: string) => runs.filter((r) => r.strategy === name);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  console.log(`strategy     seeds  bust  avgEnd   minCash  profitBy  served  stuck`);
  for (const name of Object.keys(STRATEGIES)) {
    const rs = by(name);
    console.log(`${name.padEnd(12)} ${String(rs.length).padStart(5)}  ${String(rs.filter((r) => r.bust).length).padStart(4)}  ${avg(rs.map((r) => r.endCash)).toFixed(0).padStart(6)}  ${Math.min(...rs.map((r) => r.minCash)).toFixed(0).padStart(7)}  ${avg(rs.map((r) => r.profitableBy || 99)).toFixed(1).padStart(8)}  ${avg(rs.map((r) => r.totalServed)).toFixed(0).padStart(6)}  ${rs.reduce((a, r) => a + r.stuck, 0)}`);
  }
  // 1. No sensible strategy goes bust.
  // (within the first eight days for the twelve-day strategies; the guided player over all forty)
  for (const name of ['cautious', 'aggressive', 'delegator', 'franchiser', 'guided']) for (const r of by(name)) if (name === 'guided' ? r.bust : r.bust8) failures.push(`${name} seed ${r.seed} went bust`);
  // 2. A guided new player is profitable within 5 days.
  for (const r of by('guided')) if (!r.profitableBy || r.profitableBy > 5) failures.push(`guided seed ${r.seed} not profitable by day 5 (${r.profitableBy || 'never'})`);
  // 3. No early upgrade costs more than 5 days of a guided player's income.
  const guidedDaily = avg(by('guided').map((r) => avg(r.history.slice(0, 5).map((p) => Math.max(0, p)))));
  // (Each judged only with the runs it needs: --only runs one strategy.)
  const ran = (name: string) => by(name).length > 0;
  if (ran('guided')) for (const [type, def] of Object.entries(FIXTURES)) if (['shelf', 'fridge', 'register', 'produce', 'endcap'].includes(type) && def.price > guidedDaily * 5) failures.push(`${type} costs $${def.price} > 5 days of income ($${(guidedDaily * 5).toFixed(0)})`);
  // 4. A bad layout is clearly worse than a guided player but not a guaranteed loss.
  const carelessEnd = avg(by('careless').map((r) => r.cash8)), guidedEnd = avg(by('guided').map((r) => r.cash8));
  if (ran('careless') && ran('guided') && !(carelessEnd < guidedEnd)) failures.push(`careless (${carelessEnd.toFixed(0)}) should end with less than guided (${guidedEnd.toFixed(0)})`);
  if (ran('careless') && by('careless').every((r) => r.bust8)) failures.push('careless always goes bust within eight days');
  // 5. Rivals neither crush nor ignore the player: customers keep coming after rivals open (≥ 60% of the first days),
  //    and a rival sale visibly pulls bargain hunters (share drops by at least 3 points).
  for (const r of by('guided')) {
    const early = r.served.slice(0, 2), late = r.served.slice(5);
    if (late.length && avg(late) < avg(early) * 0.6) failures.push(`guided seed ${r.seed}: customers collapsed after rivals opened (${avg(early).toFixed(0)} → ${avg(late).toFixed(0)}/day)`);
    if (r.salePull < 0.03) failures.push(`guided seed ${r.seed}: a rival sale barely moves bargain hunters (${(r.salePull * 100).toFixed(1)} points)`);
  }
  // 6. Nobody gets stuck.
  // Rivals take at most a third of the corner's trade from a guided player over week one.
  { const g = by('guided'); const take = g.reduce((a, r) => a + r.rivalTake, 0) / Math.max(1, g.length);
    console.log(`rivals' share of trade against a guided player in week one (rivals answering the player): ${(take * 100).toFixed(0)}%`);
    if (g.length && take > 1 / 3) failures.push(`rivals take ${(take * 100).toFixed(0)}% of trade from a guided player (at most a third)`); }
  // 10. Undercut Cheapo and it answers: a price match within a week of the cut that closes most of the price gap (at its strongest that week).
  { const u = by('undercutter');
    if (u.length) console.log(`undercutter: Cheapo price-matched on day ${u.map((r) => r.matchDay || '-').join('/')}; Cheapo's price gap over you ${u.map((r) => `${(r.gapBefore * 100).toFixed(0)}→${(r.gapAfter * 100).toFixed(0)}`).join(' ')} points`);
    for (const r of u) {
      if (!r.matchDay || r.matchDay > UNDERCUT_FROM + 7) failures.push(`undercutter seed ${r.seed}: Cheapo never price-matched within a week (${r.matchDay || 'never'})`);
      else if (r.gapAfter > r.gapBefore * 0.4) failures.push(`undercutter seed ${r.seed}: Cheapo's price match left ${(r.gapAfter * 100).toFixed(1)} of ${(r.gapBefore * 100).toFixed(1)} points of your price lead`);
    } }
  for (const r of runs) if (r.stuck > 0) failures.push(`${r.strategy} seed ${r.seed}: ${r.stuck} stuck rescues`);
  // 8. The goal ladder: a guided player reaches "Busiest corner" (goal 5) by day 25 on every seed.
  for (const r of by('guided')) { const d = r.goalDays.busiest; if (r.days >= 25 && (!d || d > 25)) failures.push(`guided seed ${r.seed}: Busiest corner ${d ? `only on day ${d}` : 'never reached'} (by day 25)`); }
  // 9. Rivals close only after a long squeeze: never before day 12, and MegaMart (its branches pay its rent) never in 40 days of guided play.
  for (const r of runs) for (const c of r.closed) if (c.day < 12) failures.push(`${r.strategy} seed ${r.seed}: ${c.id} closed on day ${c.day} (before day 12)`);
  for (const r of by('guided')) for (const c of r.closed) if (c.id === 'chain' || c.id === 'MegaMart') failures.push(`guided seed ${r.seed}: MegaMart closed on day ${c.day}`);
  { const g = by('guided');
    console.log(`goals reached by the guided player (day per seed): ${GOALS.map((goal) => `${goal.id} ${g.map((r) => r.goalDays[goal.id] ?? '-').join('/')}`).join('; ')}`);
    console.log(`rivals closed by the guided player: ${g.map((r) => r.closed.length ? r.closed.map((c) => `${c.id} d${c.day}`).join(' ') : 'none').join(' | ')}`); }
  console.log(`guided avg daily profit (first 5 days): $${guidedDaily.toFixed(0)}; cash left after the fit-out: $${avg(runs.map((r) => r.fitOutLeft)).toFixed(0)}; ${runs.length} runs in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  // 7. The fit-out leaves a cushion for the first days' rent.
  for (const r of runs) if (r.fitOutLeft < 60) failures.push(`${r.strategy} seed ${r.seed}: only $${r.fitOutLeft.toFixed(0)} left after the first fit-out`);
  if (process.argv.includes('--verbose')) for (const r of runs.filter((x) => x.strategy === 'guided' || x.strategy === 'delegator')) console.log(`  ${r.strategy} seed ${r.seed}: ${r.history.map((p) => p.toFixed(0)).join(' ')}`);
  for (const f of failures) console.log('  FAIL ' + f);
  if (failures.length === 0) console.log('balance check passed');
  if (check && failures.length) process.exit(1);
}

void main();
