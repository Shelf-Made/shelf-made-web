/**
 * Who comes through the door with whom, and how: a parent with a child or two, a couple, an older regular on a
 * mobility scooter, a driver pushing a trolley, and now and then someone nobody expected (an astronaut, a mascot
 * in a banana suit, a king). All of it is read off the shopper's id (no random draws), so a shop plays exactly as
 * it did; the renderer draws the company and the scooters. What does change play: shoppers drop the odd wrapper
 * (fewer near a bin), and step round a crowd at a shelf to shop the rest of their list first.
 */
import type { GameState, Person, Fixture } from './types';
import { withRng, popup, react } from './state';
import { fixtureAccessWorld, fixtureCentre } from './grid';
import { gridFor } from './state';
import { addLitter } from './people';

/** A fixed scramble of an id (the same every time). */
export function idHash(id: number, salt = 0): number {
  let x = Math.imul((id + 1) ^ Math.imul(salt + 7, 0x9e3779b9), 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Who a shopper brings along (drawn walking behind them): none, a child or two, or a partner (and a child). Cyclists come alone. */
export type Company = { kids: number; partner: boolean };
export function companyOf(p: Pick<Person, 'id' | 'kind' | 'ctype' | 'thief' | 'bike' | 'riding'>): Company {
  if (p.kind !== 'customer' || p.thief || p.bike || p.riding) return { kids: 0, partner: false };
  const h = idHash(p.id, 1) % 100;
  // Impulse buyers are kids and teens themselves; the rest bring a child now and then, or come as a couple.
  if (p.ctype === 'impulse') return { kids: 0, partner: h < 12 };
  if (h < 12) return { kids: 1, partner: false };
  if (h < 16) return { kids: 2, partner: false };
  if (h < 26) return { kids: 0, partner: true };
  if (h < 31) return { kids: 1, partner: true };
  return { kids: 0, partner: false };
}

/** Older regulars now and then come on a mobility scooter (never a cyclist, on the way in or riding home). */
export function onScooter(p: Pick<Person, 'id' | 'kind' | 'ctype' | 'bike' | 'riding' | 'thief'>): boolean {
  return p.kind === 'customer' && p.ctype === 'loyalist' && !p.bike && !p.riding && !p.thief && idHash(p.id, 2) % 100 < 14;
}

/** Someone nobody expected, once in a long while. */
export type Novelty = 'astronaut' | 'mascot' | 'royal';
export const NOVELTY_NAMES: Record<Novelty, string> = { astronaut: 'An astronaut', mascot: 'A banana mascot', royal: 'A king' };
export function noveltyOf(p: Pick<Person, 'id' | 'kind' | 'thief'>): Novelty | null {
  if (p.kind !== 'customer' || p.thief) return null;
  const h = idHash(p.id, 3) % 400;
  return h === 0 ? 'astronaut' : h === 1 ? 'mascot' : h === 2 ? 'royal' : null;
}

/** On the way in: a wave for the unexpected visitor, a trolley for a driver who can take one (or a moan when there are none). */
export function arrive(state: GameState, p: Person): void {
  const n = noveltyOf(p);
  if (n) { popup(state, p, `${NOVELTY_NAMES[n]} is shopping!`, 'info', 1.6); react(state, p.id, 'love'); }
  const byCar = p.carId !== null && p.carId !== undefined;
  if (!byCar) return;
  if (state.shop.fixtures.some((f) => f.type === 'trolleys')) p.trolley = true;
  else if ((p.list?.length ?? 0) >= 3 && idHash(p.id, 4) % 3 === 0) popup(state, p, 'I wanted a trolley!', 'bad', 1.3);
}

/**
 * Done at a shelf: now and then a wrapper or a receipt is dropped on the floor (from the second day; a bin
 * within a few steps catches most of them). Their own draws, so nothing else in the day changes. It lands like
 * any litter (open floor, six pieces at most) and takes a little off the shop's cleanliness, just what picking
 * it up gives back.
 */
export function maybeLitter(state: GameState, p: Person, f: Fixture | undefined): void {
  if (state.day < 2 || !f) return;
  const c = fixtureCentre(state.shop, f);
  const bin = state.shop.fixtures.some((b) => b.type === 'bin' && Math.hypot(fixtureCentre(state.shop, b).x - c.x, fixtureCentre(state.shop, b).z - c.z) < 3.5);
  if (!withRng(state, 'litter', (r) => r.chance(bin ? 0.004 : 0.018))) return;
  addLitter(state, p.x + 0.15, p.z + 0.1, 0.01);
}

/**
 * A crowd at the shelf they are heading for (two or more shoppers at it already): shop the next thing on the list
 * first and come back for this. Twice a visit at most, so nobody dithers between two busy shelves.
 */
export function stepRoundCrowd(state: GameState, p: Person, f: Fixture): boolean {
  const list = p.list ?? [], i = p.listIdx ?? 0;
  if (i + 1 >= list.length || (p.dodged ?? 0) >= 2) return false;
  const at = fixtureAccessWorld(state.shop, f, p, gridFor(state));
  const there = state.people.filter((o) => o !== p && o.kind === 'customer' && (o.state === 'browsing' || o.state === 'shopping') && Math.hypot(o.x - at.x, o.z - at.z) < 1.1).length;
  if (there < 2) return false;
  p.dodged = (p.dodged ?? 0) + 1;
  const [a] = list.splice(i, 1);
  list.splice(i + 1, 0, a!);
  return true;
}
