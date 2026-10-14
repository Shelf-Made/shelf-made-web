/**
 * Balance harness: scripted strategies over many seeds, asserting the game is fair.
 *   npm run balance            prints a table
 *   npm run balance -- --check exits non-zero when any assertion fails
 */
import { newGame, tick, applyCommand, DAY_SECONDS, TICK, resetGridCache, FIXTURES, PRODUCTS, playerShare, type GameState, type Difficulty } from '../src/sim/index';
import { STARTER_SHELF, STARTER_FRIDGE } from '../src/sim/products';

type Strategy = (s: GameState, day: number) => void;

const sellers = (s: GameState) => s.shop.fixtures.filter((f) => FIXTURES[f.type].slots > 0);
const storageUnits = (s: GameState) => s.shop.storage.reduce((a, e) => a + e.qty, 0);

function orderToFill(s: GameState, supplier: string, mul = 1.5, cap = Infinity): void {
  const need = new Map<string, number>();
  for (const f of sellers(s)) for (const sl of f.slots) if (sl.productId) need.set(sl.productId, (need.get(sl.productId) ?? 0) + Math.max(0, Math.ceil(FIXTURES[f.type].capacity * mul - sl.qty)));
  for (const e of s.shop.storage) need.set(e.productId, Math.max(0, (need.get(e.productId) ?? 0) - e.qty));
  let budget = Math.min(cap, s.cash * 0.6);
  let room = s.shop.storageCapacity - storageUnits(s);
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

function freeTile(s: GameState): { x: number; z: number } | null {
  const f = s.shop.floor;
  for (let z = f.z0; z < f.z1 - 1; z++) for (let x = f.x0; x < f.x1; x++) {
    if (s.shop.fixtures.some((fx) => fx.x === x && fx.z === z)) continue;
    // Keep the door column and the row in front of the register clear.
    if (Math.abs(x + 0.5) < 1 && z >= f.z1 - 2) continue;
    if (z === f.z1 - 1) continue;
    // Leave every other column free so people can walk.
    if ((x - f.x0) % 2 === 1) continue;
    return { x, z };
  }
  return null;
}

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
    // What the tips teach: scan, carry, keep prices near average, order every day, add a shelf when cash allows.
    if (s.cash > 120) orderToFill(s, 'local', 2.5, Math.max(220, s.cash * 0.5));
    if (day >= 2 && s.cash > 320 && sellers(s).length < 5) { const t = freeTile(s); if (t) applyCommand(s, { type: 'placeFixture', fixtureType: day % 2 ? 'shelf' : 'produce', x: t.x, z: t.z, rot: 0 }); }
    if (day >= 4 && s.cash > 400) { const c = s.staffPool.find((x) => x.role === 'cashier'); if (c && !s.people.some((p) => p.kind === 'staff' && p.role === 'cashier')) applyCommand(s, { type: 'hire', candidateId: c.id }); }
  },
};

interface Run { strategy: string; seed: number; days: number; fitOutLeft: number; endCash: number; minCash: number; bust: boolean; profitableBy: number; totalServed: number; stuck: number; history: number[]; served: number[]; salePull: number }

function runGame(strategy: string, seed: number, days: number, difficulty: Difficulty = 'standard'): Run {
  resetGridCache();
  const s = newGame({ seed, difficulty, plotId: ['main', 'hill', 'east'][seed % 3], name: 'Balance', tutorial: false });
  fitOut(s);
  const fitOutLeft = s.cash;
  const act = STRATEGIES[strategy]!;
  let minCash = s.cash, profitableBy = 0, totalServed = 0;
  const history: number[] = [];
  const served: number[] = [];
  let salePull = 0;
  for (let day = 1; day <= days; day++) {
    act(s, day);
    const hasCashier = () => s.people.some((p) => p.kind === 'staff' && p.role === 'cashier');
    // In person, like a player: scan when somebody is waiting at the till, otherwise restock.
    const owner = s.people.find((p) => p.kind === 'owner')!;
    const waiting = () => s.shop.fixtures.some((f) => f.type === 'register' && (f.serving !== null && f.serving !== undefined || (f.queue?.length ?? 0) > 0));
    const busy = () => !!owner.task || !!owner.carrying;
    for (let i = 0; i < (DAY_SECONDS + 130) / TICK && s.phase !== 'night'; i++) {
      tick(s);
      const scanner = !hasCashier();
      if (scanner && waiting() && !busy() && i % (strategy === 'careless' ? 14 : 6) === 0) applyCommand(s, { type: 'scan' });
      if (i % 60 === 0 && (!scanner || !waiting())) carryAll(s);
      if (s.cash < minCash) minCash = s.cash;
    }
    if (s.phase !== 'night') break;
    const d = s.history[s.history.length - 1]!;
    history.push(d.profit); served.push(d.served); totalServed += d.served;
    // How much a rival sale pulls bargain hunters, measured on the live state.
    const open = s.rivals.find((r) => r.open);
    if (open) { const before = playerShare(s).bargain; const keep = open.saleDaysLeft; open.saleDaysLeft = 2; const during = playerShare(s).bargain; open.saleDaysLeft = keep; salePull = Math.max(salePull, before - during); }
    if (d.profit > 0 && !profitableBy) profitableBy = day;
    if (s.gameOver) break;
    applyCommand(s, { type: 'openTomorrow' });
  }
  return { strategy, seed, days, fitOutLeft, endCash: s.cash, minCash, bust: s.gameOver, profitableBy, totalServed, stuck: s.stuckRescues, history, served, salePull };
}

function main(): void {
  const check = process.argv.includes('--check');
  const seeds = [1, 2, 3, 4, 5, 6];
  const days = 8;
  const runs: Run[] = [];
  const t0 = Date.now();
  for (const strategy of Object.keys(STRATEGIES)) for (const seed of seeds) runs.push(runGame(strategy, seed, days));
  const failures: string[] = [];
  const by = (name: string) => runs.filter((r) => r.strategy === name);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  console.log(`strategy     seeds  bust  avgEnd   minCash  profitBy  served  stuck`);
  for (const name of Object.keys(STRATEGIES)) {
    const rs = by(name);
    console.log(`${name.padEnd(12)} ${String(rs.length).padStart(5)}  ${String(rs.filter((r) => r.bust).length).padStart(4)}  ${avg(rs.map((r) => r.endCash)).toFixed(0).padStart(6)}  ${Math.min(...rs.map((r) => r.minCash)).toFixed(0).padStart(7)}  ${avg(rs.map((r) => r.profitableBy || 99)).toFixed(1).padStart(8)}  ${avg(rs.map((r) => r.totalServed)).toFixed(0).padStart(6)}  ${rs.reduce((a, r) => a + r.stuck, 0)}`);
  }
  // 1. No sensible strategy goes bust.
  for (const name of ['cautious', 'aggressive', 'delegator', 'franchiser', 'guided']) for (const r of by(name)) if (r.bust) failures.push(`${name} seed ${r.seed} went bust`);
  // 2. A guided new player is profitable within 5 days.
  for (const r of by('guided')) if (!r.profitableBy || r.profitableBy > 5) failures.push(`guided seed ${r.seed} not profitable by day 5 (${r.profitableBy || 'never'})`);
  // 3. No early upgrade costs more than 5 days of a guided player's income.
  const guidedDaily = avg(by('guided').map((r) => avg(r.history.slice(0, 5).map((p) => Math.max(0, p)))));
  for (const [type, def] of Object.entries(FIXTURES)) if (['shelf', 'fridge', 'register', 'produce', 'endcap'].includes(type) && def.price > guidedDaily * 5) failures.push(`${type} costs $${def.price} > 5 days of income ($${(guidedDaily * 5).toFixed(0)})`);
  // 4. A bad layout is clearly worse than a guided player but not a guaranteed loss.
  const carelessEnd = avg(by('careless').map((r) => r.endCash)), guidedEnd = avg(by('guided').map((r) => r.endCash));
  if (!(carelessEnd < guidedEnd)) failures.push(`careless (${carelessEnd.toFixed(0)}) should end with less than guided (${guidedEnd.toFixed(0)})`);
  if (by('careless').every((r) => r.bust)) failures.push('careless always goes bust');
  // 5. Rivals neither crush nor ignore the player: customers keep coming after rivals open (≥ 60% of the first days),
  //    and a rival sale visibly pulls bargain hunters (share drops by at least 3 points).
  for (const r of by('guided')) {
    const early = r.served.slice(0, 2), late = r.served.slice(5);
    if (late.length && avg(late) < avg(early) * 0.6) failures.push(`guided seed ${r.seed}: customers collapsed after rivals opened (${avg(early).toFixed(0)} → ${avg(late).toFixed(0)}/day)`);
    if (r.salePull < 0.03) failures.push(`guided seed ${r.seed}: a rival sale barely moves bargain hunters (${(r.salePull * 100).toFixed(1)} points)`);
  }
  // 6. Nobody gets stuck.
  for (const r of runs) if (r.stuck > 0) failures.push(`${r.strategy} seed ${r.seed}: ${r.stuck} stuck rescues`);
  console.log(`guided avg daily profit (first 5 days): $${guidedDaily.toFixed(0)}; cash left after the fit-out: $${avg(runs.map((r) => r.fitOutLeft)).toFixed(0)}; ${runs.length} runs in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  // 7. The fit-out leaves a cushion for the first days' rent.
  for (const r of runs) if (r.fitOutLeft < 60) failures.push(`${r.strategy} seed ${r.seed}: only $${r.fitOutLeft.toFixed(0)} left after the first fit-out`);
  if (process.argv.includes('--verbose')) for (const r of runs.filter((x) => x.strategy === 'guided' || x.strategy === 'delegator')) console.log(`  ${r.strategy} seed ${r.seed}: ${r.history.map((p) => p.toFixed(0)).join(' ')}`);
  for (const f of failures) console.log('  FAIL ' + f);
  if (failures.length === 0) console.log('balance check passed');
  if (check && failures.length) process.exit(1);
}

main();
