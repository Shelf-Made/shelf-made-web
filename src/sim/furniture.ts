/**
 * What the furniture does. Every piece on the Build card earns its place: seats rest tired shoppers
 * (who then wait longer at the till), the café table and magazine shelf and flower table sell a little
 * extra, baskets and trolleys make for bigger shops, the help desk fetches what is missing from the
 * pallet, music and plants keep a queue calm, the promo screen sells your offer, lights put shoplifters
 * off and a doormat keeps the floor clean. Random draws use their own stream, and only when the piece
 * is there, so a shop without it plays exactly as before.
 */
import type { GameState, Person, Fixture, FixtureType, Vec2 } from './types';
import { FIXTURES } from './layout';
import { withRng } from './state';
import { productDef } from './products';
import { effectivePrice } from './marketing';
import { fixtureFrontWorld, fixtureFacingWorld, fixtureCentre } from './grid';

/** What each piece is for, in a few words (the Build card shows it). */
export const FURNITURE_USE: Partial<Record<FixtureType, string>> = {
  bench: 'Shoppers who have walked a long way sit a moment, then wait longer at the till',
  sofa: 'A comfier rest: they wait even longer at the till',
  cafe: 'Sells coffee after the till ($2.50); they sit and drink it',
  desk: 'Fetches what is off the shelves from the pallet for shoppers who ask',
  basketStack: 'Shoppers take a basket and buy a little more',
  trolleys: 'Drivers take a trolley and buy a lot more',
  bin: 'Catches receipts and wrappers: the floor stays cleaner',
  speaker: 'Music: a calmer queue, and impulse buyers pick up a treat',
  screen: 'Shows your offer (or your best seller): more of it goes in baskets',
  bookcase: 'Sells papers and magazines at the till ($2)',
  plant: 'Looks lovely, and a calmer queue',
  flowers: 'Sells bunches of flowers at the till ($4)',
  sign: 'Shoppers find things faster',
  rug: 'Looks cosy, and a calmer queue',
  doormat: 'Wipes feet: the floor stays cleaner, rain or shine',
  floorLamp: 'Light: shoplifters think twice', wallLight: 'Light: shoplifters think twice', pendant: 'Light: shoplifters think twice',
  neon: 'Seen from the street: more people hear of you',
};

const count = (state: GameState, type: FixtureType, cap = Infinity): number => Math.min(cap, state.shop.fixtures.filter((f) => f.type === type).length);
const stocked = (state: GameState): string[] => [...new Set(state.shop.fixtures.flatMap((f) => f.slots.filter((s) => s.productId && s.qty > 0).map((s) => s.productId!)))];

/** On the way in: a basket or a trolley, the music, the promo screen. Lists and budgets grow. */
export function onEnter(state: GameState, p: Person): void {
  const list = p.list ?? (p.list = []);
  const add = (pid: string | undefined) => { if (pid && !list.some((it) => it.productId === pid)) list.push({ productId: pid, qty: 1 }); };
  const baskets = count(state, 'basketStack', 1), trolleys = count(state, 'trolleys', 1), speaker = count(state, 'speaker', 1), screen = count(state, 'screen', 1);
  if (!baskets && !trolleys && !speaker && !screen) return;
  withRng(state, 'furniture', (r) => {
    const goods = stocked(state);
    const any = () => (goods.length ? r.pick(goods) : undefined);
    // A trolley for those who came by car; a basket for everyone else.
    if (trolleys && p.carId !== null && p.carId !== undefined) { p.budget = (p.budget ?? 20) * 1.3; add(any()); add(any()); }
    else if (baskets) { p.budget = (p.budget ?? 20) * 1.15; if (r.chance(0.5)) add(any()); }
    if (speaker && p.ctype === 'impulse' && r.chance(0.4)) add(any());
    if (screen) {
      const promo = state.marketing.promotion?.productId;
      const show = promo && goods.includes(promo) ? promo : goods.sort((a, b) => productDef(b).demand - productDef(a).demand)[0];
      if (show && r.chance(promo ? 0.3 : 0.15)) add(show);
    }
  });
}

/** What sells itself at the till (magazines, a bunch of flowers): money and cost of goods. */
export function tillExtras(state: GameState): { revenue: number; cost: number } {
  const mags = count(state, 'bookcase', 2), flowers = count(state, 'flowers', 2);
  if (!mags && !flowers) return { revenue: 0, cost: 0 };
  return withRng(state, 'furniture', (r) => {
    let revenue = 0, cost = 0;
    if (mags && r.chance(0.1 * mags)) { revenue += 2; cost += 0.8; }
    if (flowers && r.chance(0.05 * flowers)) { revenue += 4; cost += 1.5; }
    return { revenue, cost };
  });
}

/** How fast patience runs out in the queue (music, plants and rugs calm it, up to a quarter slower). */
export function queueDrain(state: GameState): number {
  const calm = 0.12 * count(state, 'speaker', 1) + 0.04 * count(state, 'plant', 3) + 0.03 * count(state, 'rug', 2);
  return 1 - Math.min(0.25, calm);
}

/** How much a sale dirties the floor (a doormat wipes feet). */
export function grimeFactor(state: GameState): number { return count(state, 'doormat', 1) ? 0.6 : 1; }

/** Fewer shoplifters in a well-lit shop (a few lights make most of the difference). */
export function thiefFactor(state: GameState): number {
  const lights = count(state, 'floorLamp') + count(state, 'wallLight') + count(state, 'pendant');
  return 1 - Math.min(0.4, lights * 0.08);
}

/** A neon sign in the window: awareness it adds each day. */
export function neonReach(state: GameState): number { return 0.008 * count(state, 'neon', 2); }

// ---- Sitting down: benches and the café table, two places each.

const SEATS: Partial<Record<FixtureType, number>> = { bench: 2, sofa: 2, cafe: 2 };
/** How much patience a rest gives back (as a share of their patience at the start). */
export const REST_BONUS: Partial<Record<FixtureType, number>> = { bench: 0.25, sofa: 0.4, cafe: 0.2 };

/** Who is sitting (or on their way to sit) where. */
function taken(state: GameState, f: Fixture): number[] {
  return state.people.filter((q) => q.rest?.fixtureId === f.id).map((q) => q.rest!.seat);
}

/** A free place on a piece of this kind near them (null when there is none). */
export function freeSeat(state: GameState, p: Person, types: FixtureType[], within = 9): { f: Fixture; seat: number } | null {
  let best: { f: Fixture; seat: number; d: number } | null = null;
  for (const f of state.shop.fixtures) {
    const n = SEATS[f.type];
    if (!n || !types.includes(f.type)) continue;
    const used = taken(state, f);
    const seat = [...Array(n).keys()].find((k) => !used.includes(k));
    if (seat === undefined) continue;
    const c = fixtureCentre(state.shop, f), d = Math.hypot(c.x - p.x, c.z - p.z);
    if (d <= within && (!best || d < best.d)) best = { f, seat, d };
  }
  return best ? { f: best.f, seat: best.seat } : null;
}

/** Where someone sits on a seat (world), and which way they face. */
export function seatPose(state: GameState, f: Fixture, seat: number): { at: Vec2; yaw: number } {
  const c = fixtureCentre(state.shop, f), fw = fixtureFacingWorld(state.shop, f.rot);
  const side = { x: fw.z, z: -fw.x };
  // A bench: side by side, a little forward of the back; the café table: a chair either side, facing in.
  if (f.type === 'cafe') { const s = seat ? 1 : -1; return { at: { x: c.x + side.x * 0.34 * s, z: c.z + side.z * 0.34 * s }, yaw: Math.atan2(-side.x * s, -side.z * s) }; }
  const off = seat ? 0.2 : -0.2;
  // Pieces stand flush at the back of their tile: the seat is a little in from the back edge.
  const from = -0.5 + (FIXTURES[f.type].depth ?? 0.4) * 0.55;
  return { at: { x: c.x + side.x * off + fw.x * from, z: c.z + side.z * off + fw.z * from }, yaw: Math.atan2(fw.x, fw.z) };
}

/** Where to walk to before sitting (the open floor in front of the seat). */
export function seatApproach(state: GameState, f: Fixture): Vec2 { return fixtureFrontWorld(state.shop, f); }

/** Is the help desk there, and free (nobody asking at it)? */
export function freeDesk(state: GameState): Fixture | null {
  const desks = state.shop.fixtures.filter((f) => f.type === 'desk');
  return desks.find((d) => !state.people.some((q) => q.rest?.fixtureId === d.id)) ?? null;
}

/** At the help desk: one of what they asked for, fetched from the pallet (null if it went meanwhile). */
export function fetchFromPallet(state: GameState, productId: string): { productId: string; qty: number; price: number } | null {
  const e = state.shop.storage.find((x) => x.productId === productId && x.qty > 0);
  if (!e) return null;
  e.qty--;
  if (e.qty <= 0) state.shop.storage = state.shop.storage.filter((x) => x.qty > 0);
  return { productId, qty: 1, price: effectivePrice(state, productId) };
}
