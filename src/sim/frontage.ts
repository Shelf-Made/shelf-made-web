/**
 * The shop front and the lot's extras. A better sign (lit letters, neon, an LED board on the pylon) gets
 * the shop noticed by more of the people going past; a slogan runs under the name. A loading dock by the
 * delivery door brings the trucks sooner and unloads them faster. Car chargers on the lot earn a little from
 * every electric car that plugs in, and draw a few more drivers; your own bus stop puts the shop on the
 * bus route. None of it draws on the random streams except the bus stop's own ('transit'), so a shop
 * without them plays exactly as before.
 */
import type { GameState, Shop, SignStyle, Car, Fixture, Vec2 } from './types';
import { LOT_FRONT, FRONT_WALK_Z, WALL_T, toWorld, toLocal, bayRect, lotLayout, serviceDoor, byDoor, footprintOf } from './layout';
import { popup, cue, withRng } from './state';
import { dollars, formatMoney } from './money';
import { idHash } from './visitors';
import { bayCentre } from './drive';

/** The signs, from the one the shop came with up. `pull` is how many more of the passing shoppers notice the shop. */
export const SIGN_TIERS: { id: SignStyle; name: string; price: number; pull: number; looks: number; blurb: string }[] = [
  { id: 'classic', name: 'Painted letters', price: 0, pull: 1, looks: 0, blurb: 'The sign the shop came with.' },
  { id: 'lit', name: 'Lit letters', price: 600, pull: 1.03, looks: 0.3, blurb: 'The name glows after dark. 3% more shoppers.' },
  { id: 'neon', name: 'Neon', price: 1800, pull: 1.06, looks: 0.4, blurb: 'Neon tubes round the fascia and the pylon. 6% more shoppers.' },
  { id: 'led', name: 'LED board', price: 4500, pull: 1.1, looks: 0.5, blurb: 'A bright screen on the pylon runs your slogan. 10% more shoppers.' },
];
/** Longest slogan (letters). */
export const SLOGAN_MAX = 28;
/** With a loading dock by the delivery door, trucks come in this share of the time, and unload in this share of it. */
export const BAY_ETA = 0.6;
export const BAY_UNLOAD = 0.5;
/** What a driver pays to charge (once, when they plug in). */
export const CHARGE_FEE = 6;
/** How far from a car (tiles) a charger's cable reaches. */
export const CHARGE_REACH = 3.2;
/** One car in this many is electric (read off its id). */
export const ELECTRIC_ONE_IN = 4;
/** Your own bus stop: this many more shoppers, and at rush hour this share of those on foot get off at it. */
export const BUS_PULL = 1.06;
export const BUS_RUSH_SHARE = 0.6;
export const BUS_QUIET_SHARE = 0.15;

export function signTier(shop: Pick<Shop, 'signStyle'>): number { return Math.max(0, SIGN_TIERS.findIndex((t) => t.id === (shop.signStyle ?? 'classic'))); }
function boughtTier(state: GameState): number {
  const bought = Math.max(0, SIGN_TIERS.findIndex((t) => t.id === (state.shop.signBought ?? 'classic')));
  // Lit letters come free with the Regulars goal (and in sandbox), as they always have.
  const goal = state.goals.unlocked.includes('signLit') || state.sandbox ? 1 : 0;
  return Math.max(bought, goal, signTier(state.shop));
}
/** What putting up a sign costs now: nothing for one bought before (or a smaller one); the difference for a bigger one. */
export function signPrice(state: GameState, style: SignStyle): number {
  const i = SIGN_TIERS.findIndex((t) => t.id === style), have = boughtTier(state);
  return i <= have ? 0 : SIGN_TIERS[i]!.price - SIGN_TIERS[have]!.price;
}
/** Put up a sign (buying it when it is bigger than any bought before). */
export function setSign(state: GameState, style: SignStyle): string | null {
  const i = SIGN_TIERS.findIndex((t) => t.id === style);
  if (i < 0) return 'No such sign.';
  if ((state.shop.signStyle ?? 'classic') === style) return null;
  const price = signPrice(state, style);
  if (price > state.cash) return `Need ${dollars(price)}.`;
  state.cash -= price;
  if (i > boughtTier(state) || !state.shop.signBought) state.shop.signBought = SIGN_TIERS[Math.max(i, boughtTier(state))]!.id;
  state.shop.signStyle = style;
  state.shop.layoutVersion++;
  if (price > 0) { const o = state.people.find((p) => p.kind === 'owner'); if (o) popup(state, o, `${SIGN_TIERS[i]!.name} up!`, 'info', 1.4); }
  return null;
}

/** The slogan, tidied: one line, no more than SLOGAN_MAX letters. */
export function cleanSlogan(text: string): string { return text.replace(/\s+/g, ' ').trim().slice(0, SLOGAN_MAX); }
/** Longest aisle-sign text (letters), and the text tidied to fit. */
export const SIGN_TEXT_MAX = 16;
export function cleanSignText(text: string): string { return text.replace(/\s+/g, ' ').trim().slice(0, SIGN_TEXT_MAX); }
export function setSlogan(state: GameState, text: string): string | null {
  const s = cleanSlogan(text);
  if ((state.shop.slogan ?? '') === s) return null;
  state.shop.slogan = s || undefined;
  state.shop.layoutVersion++;
  return null;
}

/** How far from just outside the door deliveries come in at a loading dock may be (its middle) and still serve it. */
export const DOCK_REACH = 3.5;
/** Is a dock at x, z (lot tile corner, turned rot) by the door deliveries come in at? */
export function dockByDoor(shop: Shop, x: number, z: number, rot: number): boolean {
  const sd = serviceDoor(shop);
  if (!sd) return false;
  const r = footprintOf('loadingDock', x, z, rot), out = byDoor(sd, WALL_T + 0.5);
  return Math.hypot((r.x0 + r.x1) / 2 - out.x, (r.z0 + r.z1) / 2 - out.z) <= DOCK_REACH;
}
/** Does the shop have a loading dock by its delivery door (trucks sooner, unloading faster)? */
export function hasDock(shop: Shop): boolean { return shop.fixtures.some((f) => f.type === 'loadingDock' && dockByDoor(shop, f.x, f.z, f.rot)); }

/** How much more trade the front of the shop brings in: the sign, your bus stop, car chargers (two count). */
export function frontagePull(shop: Shop): number {
  let k = SIGN_TIERS[signTier(shop)]!.pull;
  if (shop.fixtures.some((f) => f.type === 'busStop')) k *= BUS_PULL;
  k *= 1 + 0.02 * Math.min(2, shop.fixtures.filter((f) => f.type === 'evCharger').length);
  return k;
}

// ---- Car chargers.

export function isElectric(car: Pick<Car, 'id'>): boolean { return idHash(car.id, 11) % ELECTRIC_ONE_IN === 0; }

/** Chargers in use now (a parked car plugged into each). */
export function chargersInUse(state: GameState): Set<number> {
  const out = new Set<number>();
  for (const c of state.cars) if (c.charging !== undefined && c.state === 'parked') out.add(c.charging);
  return out;
}

/** The free charger nearest a bay, within reach of it, if any. */
function chargerFor(state: GameState, car: Car, busy: Set<number>): Fixture | null {
  const at = toLocal(state.shop, car.x, car.z);
  let best: Fixture | null = null, bd = CHARGE_REACH;
  for (const f of state.shop.fixtures) {
    if (f.type !== 'evCharger' || busy.has(f.id)) continue;
    const d = Math.hypot(f.x + 0.5 - at.x, f.z + 0.5 - at.z);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

/** Electric cars parked in your lot plug in at a free charger in reach, and their drivers pay for it. */
export function tickChargers(state: GameState): void {
  if (state.tick % 10 !== 0 || !state.shop.fixtures.some((f) => f.type === 'evCharger')) return;
  let busy: Set<number> | null = null;
  for (const car of state.cars) {
    if (car.state !== 'parked' || car.lot !== undefined || car.bay === null || car.ownerId === null || car.charging !== undefined || !isElectric(car)) continue;
    busy ??= chargersInUse(state);
    const f = chargerFor(state, car, busy);
    if (!f) continue;
    car.charging = f.id; busy.add(f.id);
    state.cash = Math.round((state.cash + CHARGE_FEE) * 100) / 100;
    state.today.charging = Math.round(((state.today.charging ?? 0) + CHARGE_FEE) * 100) / 100;
    popup(state, toWorld(state.shop, f.x + 0.5, f.z + 0.5), `Charging +${formatMoney(CHARGE_FEE)}`, 'money', 1.2);
    cue(state, 'coin');
  }
}

/** Is there a bay a charger here would reach? (A charger off on its own is never used.) */
export function chargerReachesBay(shop: Shop, x: number, z: number): boolean {
  if (shop.lotBaked) return shop.fixtures.some((f) => f.type === 'parkingBay' && (() => { const c = bayCentre(f); return Math.hypot(c.x - (x + 0.5), c.z - (z + 0.5)) < CHARGE_REACH; })());
  return lotLayout(shop).bays.some((b) => { const r = bayRect(b); return Math.hypot((r.x0 + r.x1) / 2 - (x + 0.5), (r.z0 + r.z1) / 2 - (z + 0.5)) < CHARGE_REACH; });
}

// ---- Your bus stop.

/** A bus stop goes in the front row of the lot, by the sidewalk, facing the street. */
export function busStopRule(r: { z1: number }, rot: number): string | null {
  if (r.z1 < LOT_FRONT - 0.5) return 'A bus stop goes by the sidewalk, in the front row of the lot';
  if ((rot & 3) !== 0) return 'Turn it to face the street (R)';
  return null;
}

/** Where riders step off at your stop (world), if you have one and this shopper came by bus. */
export function offTheBus(state: GameState, rush: boolean): Vec2 | null {
  const stop = state.shop.fixtures.find((f) => f.type === 'busStop');
  if (!stop || state.phase === 'night') return null;
  if (!withRng(state, 'transit', (r) => r.chance(rush ? BUS_RUSH_SHARE : BUS_QUIET_SHARE))) return null;
  const off = withRng(state, 'transit', (r) => r.range(-0.6, 0.6));
  return toWorld(state.shop, stop.x + 1 + off, FRONT_WALK_Z);
}
