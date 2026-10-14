/**
 * Staff: a hiring pool, wages, skill, speed and morale, visible mistakes, quitting, and
 * managers who follow the rules you set. Behaviour on the floor lives in people.ts.
 */
import type { GameState, Person, StaffRole, Candidate, ManagerRules } from './types';
import { withRng, popup, cue } from './state';
import { doorOutside } from './people';
import { FIXTURES } from './layout';
import { productDef } from './products';
import { placeOrder } from './economy';

const FIRST = ['Ada', 'Ben', 'Cleo', 'Dev', 'Ellis', 'Fay', 'Gus', 'Hana', 'Ivo', 'June', 'Kai', 'Lena', 'Milo', 'Nia', 'Oz', 'Pia', 'Quinn', 'Rae', 'Sam', 'Tess', 'Uma', 'Val', 'Wren', 'Yuki', 'Zed'];
const LAST = ['Park', 'Okafor', 'Silva', 'Novak', 'Reyes', 'Brennan', 'Chen', 'Haddad', 'Kowalski', 'Mensah', 'Dubois', 'Ito', 'Larsen', 'Moreno', 'Singh'];

export const ROLE_NAMES: Record<StaffRole, string> = { cashier: 'Cashier', stocker: 'Stocker', cleaner: 'Cleaner', orderer: 'Orderer', manager: 'Manager' };
export const ROLE_BLURB: Record<StaffRole, string> = {
  cashier: 'Rings people up so you never have to scan again.',
  stocker: 'Carries boxes from the pallet to the shelves whenever one runs low.',
  cleaner: 'Picks up abandoned baskets and keeps the floor spotless.',
  orderer: 'Reorders products when they drop below the reorder point.',
  manager: 'Runs the shop by your rules: reorders, prices, wages and ads.',
};
const BASE_WAGE: Record<StaffRole, number> = { cashier: 48, stocker: 42, cleaner: 36, orderer: 52, manager: 90 };

export const SHIFT_NAMES = { full: 'All day', morning: 'Mornings (8–2)', evening: 'Evenings (2–8)' } as const;

/** Is this employee on shift right now? */
export function onShift(p: Person, time: number): boolean {
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
export function wageFor(p: Person): number { return Math.round((p.wage ?? 0) * (p.shift && p.shift !== 'full' ? 0.55 : 1)); }

export const DEFAULT_RULES: ManagerRules = { reorderPoint: 1.0, spendCap: 300, priceMin: 0.95, priceMax: 1.15, wageCap: 70, adBudget: 0 };

export function makeCandidate(state: GameState, role?: StaffRole): Candidate {
  return withRng(state, 'staff', (r) => {
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
}

export function hire(state: GameState, candidateId: number): string | null {
  const c = state.staffPool.find((x) => x.id === candidateId);
  if (!c) return 'They already found another job.';
  const staffCount = state.people.filter((p) => p.kind === 'staff').length;
  if (staffCount >= 6) return 'The shop is full of staff already.';
  if (state.cash < c.wage) return `You need a day's wage ($${c.wage}) in the till to hire.`;
  if (c.role === 'cashier' && !state.shop.fixtures.some((f) => (f.type === 'register' || f.type === 'kiosk') && !f.staffId)) return 'Every register already has a cashier.';
  state.staffPool = state.staffPool.filter((x) => x.id !== c.id);
  const d = doorOutside(state);
  const p: Person = {
    id: c.id, kind: 'staff', look: { model: 12, variant: c.look.variant, height: c.look.height }, x: d.x, z: d.z + 1.5, yaw: Math.PI, px: d.x, pz: d.z + 1.5,
    state: 'idle', anim: 'walk', path: [], pathIdx: 0, speed: 1.6 * c.speed, timer: 0,
    role: c.role, wage: c.wage, skill: c.skill, morale: 0.85, name: c.name, task: null, carrying: null, stuckTicks: 0, hiredDay: state.day, shift: 'full',
  };
  state.people.push(p);
  if (c.role === 'cashier') { const reg = state.shop.fixtures.find((f) => (f.type === 'register' || f.type === 'kiosk') && !f.staffId); if (reg) reg.staffId = p.id; }
  state.notices.push({ day: state.day, text: `${c.name} starts today as your ${ROLE_NAMES[c.role].toLowerCase()} ($${c.wage}/day).`, kind: 'staff' });
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
  popup(state, { x: cashier.x, z: cashier.z }, `Oops, -$${loss.toFixed(2)}`, 'bad', 1.2);
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
      const qty = Math.max(6, Math.ceil(cap * 1.5 - have));
      const cost = qty * productDef(pid).cost;
      if (spend + cost > spendCap) continue;
      spend += cost; lines.push({ productId: pid, qty });
    }
  }
  if (lines.length) {
    const res = placeOrder(state, 'local', lines);
    if (typeof res !== 'string') state.notices.push({ day: state.day, text: `Stock reordered: ${lines.length} product${lines.length > 1 ? 's' : ''} for $${res.total.toFixed(0)}.`, kind: 'staff' });
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
