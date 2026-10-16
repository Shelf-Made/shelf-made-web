/**
 * Staff: a hiring pool, wages, skill, speed and morale, visible mistakes, quitting, and
 * managers who follow the rules you set. Behaviour on the floor lives in people.ts.
 */
import type { GameState, Person, StaffRole, Candidate, ManagerRules, Look } from './types';
import { withRng, popup, cue } from './state';
import { doorOutside } from './people';
import { FIXTURES } from './layout';
import { productDef } from './products';
import { placeOrder } from './economy';
import { formatMoney, dollars } from './money';

const FIRST = ['Ada', 'Ben', 'Cleo', 'Dev', 'Ellis', 'Fay', 'Gus', 'Hana', 'Ivo', 'June', 'Kai', 'Lena', 'Milo', 'Nia', 'Oz', 'Pia', 'Quinn', 'Rae', 'Sam', 'Tess', 'Uma', 'Val', 'Wren', 'Yuki', 'Zed'];
const LAST = ['Park', 'Okafor', 'Silva', 'Novak', 'Reyes', 'Brennan', 'Chen', 'Haddad', 'Kowalski', 'Mensah', 'Dubois', 'Ito', 'Larsen', 'Moreno', 'Singh'];

/**
 * How a member of staff looks: their own face and build (one of the twelve characters), skin, hair
 * and trousers, picked from their id so they never change; the renderer dresses every one of them in
 * the shop's colour with a name badge, so staff read as staff and no two look alike.
 */
const STAFF_SKINS = ['#FFD7B0', '#F3CCA8', '#DBAB8E', '#C8925A', '#A87B45', '#6E4630'];
const STAFF_HAIRS = ['#222226', '#6E4630', '#9C6B47', '#C9541C', '#E9C46A', '#38383D', '#D8D8DC'];
const STAFF_BOTTOMS = ['#38383D', '#285795', '#5A5A62', '#7A4E2E', '#24603D', '#C4C0B8'];
export function staffLook(id: number, base: { model: number; variant: number; height: number }): Look {
  const h = (k: number) => { let x = Math.imul((id + 1) ^ (k * 0x9e3779b9), 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return ((x ^ (x >>> 16)) >>> 0); };
  return { model: base.model % 12, variant: base.variant, height: base.height, skin: STAFF_SKINS[h(1) % STAFF_SKINS.length], hair: STAFF_HAIRS[h(2) % STAFF_HAIRS.length], bottom: STAFF_BOTTOMS[h(3) % STAFF_BOTTOMS.length] };
}

export const ROLE_NAMES: Record<StaffRole, string> = { cashier: 'Cashier', stocker: 'Stocker', cleaner: 'Cleaner', orderer: 'Orderer', manager: 'Manager', guard: 'Guard' };
export const ROLE_BLURB: Record<StaffRole, string> = {
  cashier: 'Rings people up so you never have to scan again.',
  stocker: 'Carries boxes from the pallet to the shelves whenever one runs low.',
  cleaner: 'Picks up abandoned baskets and keeps the floor spotless.',
  orderer: 'Reorders products when they drop below the reorder point.',
  manager: 'Runs the shop by your rules: reorders, prices, wages and ads.',
  guard: 'Watches the door: fewer shoplifters try, and the ones who run get caught.',
};
const BASE_WAGE: Record<StaffRole, number> = { cashier: 48, stocker: 42, cleaner: 36, orderer: 52, manager: 90, guard: 58 };

/**
 * Experience: every member of staff gets better at the job by doing it (a scan, a box shelved, a spill
 * mopped, a thief caught, a reorder), and it shows as a level from 1 to 5. Each level makes them quicker
 * at it; a guard from level 3 patrols on a scooter.
 */
export const LEVEL_XP = [0, 60, 180, 400, 800];
export const MAX_LEVEL = LEVEL_XP.length;
export function staffLevel(p: { xp?: number }): number {
  let l = 1; for (let i = 1; i < LEVEL_XP.length; i++) if ((p.xp ?? 0) >= LEVEL_XP[i]!) l = i + 1;
  return l;
}
/** How far through the level they are (0..1; 1 at the top level). */
export function levelProgress(p: { xp?: number }): number {
  const l = staffLevel(p); if (l >= MAX_LEVEL) return 1;
  const a = LEVEL_XP[l - 1]!, b = LEVEL_XP[l]!;
  return Math.max(0, Math.min(1, ((p.xp ?? 0) - a) / (b - a)));
}
/** How much quicker a level makes them at their job: +20% a level, +80% at level 5. */
export function levelBoost(p: { xp?: number; kind?: string }): number { return p.kind === 'staff' ? 1 + 0.2 * (staffLevel(p) - 1) : 1; }
/** Experience for a job done; a level gained is cheered. */
export function gainXp(state: GameState, p: Person, n: number): void {
  if (p.kind !== 'staff') return;
  const before = staffLevel(p);
  p.xp = (p.xp ?? 0) + n;
  const after = staffLevel(p);
  if (after > before) {
    popup(state, { x: p.x, z: p.z }, `Level ${after}!`, 'money', 1.4);
    state.notices.push({ day: state.day, text: `${p.name} is now a level ${after} ${ROLE_NAMES[p.role ?? 'cashier'].toLowerCase()}${p.role === 'guard' && after === 3 ? ': on a scooter from now on' : ''}.`, kind: 'staff' });
    cue(state, 'reward');
  }
}

export const SHIFT_NAMES = { full: 'All day', morning: 'Mornings (8–2)', evening: 'Evenings (2–8)' } as const;

/** Is this employee on shift right now? */
export function onShift(p: Person, time: number): boolean {
  if (p.onBreak) return false;
  const half = 6 * 60;
  return p.shift === 'morning' ? time < half : p.shift === 'evening' ? time >= half : true;
}

export function setShift(state: GameState, staffId: number, shift: 'full' | 'morning' | 'evening'): string | null {
  const p = state.people.find((x) => x.id === staffId && x.kind === 'staff');
  if (!p) return 'No such employee.';
  p.shift = shift;
  return null;
}

/** Daily wage after the shift pattern. */
export function wageFor(p: Person): number { return Math.round((p.wage ?? 0) * (p.shift && p.shift !== 'full' ? 0.55 : 1) * (p.onBreak ? 0.5 : 1)); }

/** On a break, or back to work: off the floor at half pay, keeping what they have learned. */
export function setBreak(state: GameState, staffId: number, on: boolean): string | null {
  const p = state.people.find((x) => x.id === staffId && x.kind === 'staff');
  if (!p) return 'No such employee.';
  p.onBreak = on || undefined;
  if (on) { p.chase = null; releaseTill(state, p); }
  return null;
}
function releaseTill(state: GameState, p: Person): void { for (const f of state.shop.fixtures) if (f.staffId === p.id) f.staffId = null; }

/** A new name and a new look (the dice on their card). */
export function restyle(state: GameState, staffId: number): string | null {
  const p = state.people.find((x) => x.id === staffId && x.kind === 'staff');
  if (!p) return 'No such employee.';
  withRng(state, 'dice', (r) => {
    p.name = `${r.pick(FIRST)} ${r.pick(LAST)}`;
    p.look = staffLook(p.id + r.int(1, 99999), { model: r.int(0, 11), variant: r.int(0, 3), height: r.range(0.92, 1.08) });
  });
  return null;
}

export const DEFAULT_RULES: ManagerRules = { reorderPoint: 1.0, spendCap: 300, priceMin: 0.95, priceMax: 1.15, wageCap: 70, adBudget: 0 };

export function makeCandidate(state: GameState, role?: StaffRole, stream = 'staff'): Candidate {
  return withRng(state, stream, (r) => {
    const roles: StaffRole[] = ['cashier', 'stocker', 'cleaner', 'orderer', 'manager'];
    const rl = role ?? r.pick(roles);
    const skill = Math.round(r.range(0.25, 0.95) * 100) / 100;
    const speed = Math.round(r.range(0.6, 1.2) * 100) / 100;
    const wage = Math.round(BASE_WAGE[rl] * (0.75 + skill * 0.6) * (0.9 + speed * 0.15));
    return { id: state.nextId++, name: `${r.pick(FIRST)} ${r.pick(LAST)}`, role: rl, skill, speed, wage, look: { model: r.int(0, 11), variant: r.int(0, 3), height: r.range(0.92, 1.08) } };
  });
}

/** Five fresh faces every morning, always at least one cashier and one stocker. */
export function refreshPool(state: GameState): void {
  state.staffPool = [makeCandidate(state, 'cashier'), makeCandidate(state, 'stocker'), makeCandidate(state), makeCandidate(state), makeCandidate(state, state.day % 2 === 0 ? 'manager' : undefined)];
  // Once shoplifters start (the third day), a guard looking for work too (drawn on their own, so the rest of the pool is as it was).
  if (state.day >= 2) state.staffPool.push(makeCandidate(state, 'guard', 'guards'));
}

export function hire(state: GameState, candidateId: number): string | null {
  const c = state.staffPool.find((x) => x.id === candidateId);
  if (!c) return 'They already found another job.';
  if (state.cash < c.wage) return `You need a day's wage (${dollars(c.wage)}) in the till to hire.`;
  // Hire as many as you like: someone else answers the ad in their place. A cashier with no till of
  // their own takes over one whose cashier is off shift, and helps on the floor until then.
  state.staffPool = state.staffPool.map((x) => (x.id === c.id ? makeCandidate(state, c.role, c.role === 'guard' ? 'guards' : 'staff') : x));
  const d = doorOutside(state);
  const p: Person = {
    id: c.id, kind: 'staff', look: staffLook(c.id, c.look), x: d.x, z: d.z + 1.5, yaw: Math.PI, px: d.x, pz: d.z + 1.5,
    state: 'idle', anim: 'walk', path: [], pathIdx: 0, speed: 1.6 * c.speed, timer: 0,
    role: c.role, wage: c.wage, skill: c.skill, morale: 0.85, name: c.name, task: null, carrying: null, stuckTicks: 0, hiredDay: state.day, shift: 'full',
  };
  state.people.push(p);
  if (c.role === 'cashier') { const reg = state.shop.fixtures.find((f) => (f.type === 'register' || f.type === 'kiosk') && !f.staffId); if (reg) reg.staffId = p.id; }
  // A guard is quicker on their feet than the rest.
  if (c.role === 'guard') p.speed *= 1.1;
  state.notices.push({ day: state.day, text: `${c.name} starts today as your ${ROLE_NAMES[c.role].toLowerCase()} (${dollars(c.wage)}/day).`, kind: 'staff' });
  cue(state, 'reward');
  return null;
}

export function fire(state: GameState, staffId: number): string | null {
  const p = state.people.find((x) => x.id === staffId && x.kind === 'staff');
  if (!p) return 'No such employee.';
  releaseStaff(state, p);
  p.state = 'gone';
  state.notices.push({ day: state.day, text: `${p.name} was let go.`, kind: 'staff' });
  return null;
}

export function giveRaise(state: GameState, staffId: number): string | null {
  const p = state.people.find((x) => x.id === staffId && x.kind === 'staff');
  if (!p) return 'No such employee.';
  p.wage = Math.round((p.wage ?? 40) * 1.1);
  p.morale = Math.min(1, (p.morale ?? 0.8) + 0.25);
  cue(state, 'cash');
  return null;
}

function releaseStaff(state: GameState, p: Person): void {
  for (const f of state.shop.fixtures) if (f.staffId === p.id) f.staffId = null;
  if (p.carrying) state.shop.storage.push({ productId: p.carrying.productId, qty: p.carrying.qty, day: state.day });
}

/** Nightly: morale drifts, the overworked and underpaid quit, managers lift the team. */
export function staffNight(state: GameState): void {
  const manager = state.people.find((p) => p.kind === 'staff' && p.role === 'manager');
  for (const p of state.people) {
    if (p.kind !== 'staff') continue;
    const busy = state.today.customers > 45 ? 0.04 : 0;
    const underpaid = (p.wage ?? 40) < BASE_WAGE[p.role ?? 'cashier'] * (0.75 + (p.skill ?? 0.5) * 0.6) * 0.9 ? 0.03 : 0;
    p.morale = Math.max(0, Math.min(1, (p.morale ?? 0.8) - 0.015 - busy - underpaid + (manager && manager !== p ? 0.015 : 0) + (state.shop.cleanliness > 0.8 ? 0.005 : 0)));
    p.skill = Math.min(1, (p.skill ?? 0.5) + 0.006);
    // A guard learns the door by watching it; a manager with no desk to work at frets.
    if (p.role === 'guard' && !p.onBreak) gainXp(state, p, 15);
    if (p.role === 'manager' && !state.shop.fixtures.some((f) => f.type === 'desk')) p.morale = Math.max(0, (p.morale ?? 0.8) - 0.02);
    if ((p.morale ?? 1) < 0.2 && withRng(state, 'staff', (r) => r.chance(0.5))) {
      releaseStaff(state, p);
      p.state = 'gone';
      state.notices.push({ day: state.day, text: `${p.name} quit. Low morale: a raise or a quieter shop might have kept them.`, kind: 'staff' });
    }
  }
  state.people = state.people.filter((p) => p.state !== 'gone');
  refreshPool(state);
}

/** A cashier's small slip: the till comes up short. Returns the shortfall. */
export function cashierMistake(state: GameState, cashier: Person, total: number): number {
  const chance = Math.max(0.01, 0.12 - (cashier.skill ?? 0.5) * 0.12) * (1.2 - (cashier.morale ?? 0.8) * 0.4);
  if (!withRng(state, 'staff', (r) => r.chance(chance))) return 0;
  const loss = Math.round(Math.min(total, Math.max(0.5, total * 0.2)) * 100) / 100;
  popup(state, { x: cashier.x, z: cashier.z }, `Oops, ${formatMoney(-loss)}`, 'bad', 1.2);
  return loss;
}

/** Orderers and managers reorder when stock on hand drops below the reorder point. */
export function autoOrder(state: GameState, rules: ManagerRules, spendCap: number): void {
  const onHand = new Map<string, number>();
  const capacity = new Map<string, number>();
  for (const f of state.shop.fixtures) for (const s of f.slots) if (s.productId) {
    onHand.set(s.productId, (onHand.get(s.productId) ?? 0) + s.qty);
    capacity.set(s.productId, (capacity.get(s.productId) ?? 0) + FIXTURES[f.type].capacity);
  }
  for (const e of state.shop.storage) onHand.set(e.productId, (onHand.get(e.productId) ?? 0) + e.qty);
  const lines: { productId: string; qty: number }[] = [];
  let spend = 0;
  for (const [pid, cap] of capacity) {
    const have = onHand.get(pid) ?? 0;
    const point = cap * rules.reorderPoint;
    if (have < point) {
      const qty = Math.max(6, Math.ceil(cap * (rules.stockTarget ?? 1.5) - have));
      const cost = qty * productDef(pid).cost;
      if (spend + cost > spendCap) continue;
      spend += cost; lines.push({ productId: pid, qty });
    }
  }
  if (lines.length) {
    const res = placeOrder(state, 'local', lines, !!rules.instant);
    if (typeof res !== 'string') {
      state.notices.push({ day: state.day, text: `Stock reordered: ${lines.length} product${lines.length > 1 ? 's' : ''} for ${dollars(res.total)}.`, kind: 'staff' });
      for (const o of state.people) if (o.kind === 'staff' && (o.role === 'orderer' || o.role === 'manager')) gainXp(state, o, 8);
    }
  }
}

/** Managers nudge prices into the range you allow, toward the sweet spot just over average. */
export function managerPrices(state: GameState, rules: ManagerRules): void {
  for (const f of state.shop.fixtures) for (const s of f.slots) {
    if (!s.productId) continue;
    const def = productDef(s.productId);
    const target = def.basePrice * Math.min(rules.priceMax, Math.max(rules.priceMin, 1.05));
    state.prices[s.productId] = Math.round(target * 20) / 20;
  }
}
