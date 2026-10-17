/**
 * The shop's public listing on the map app: star reviews from real shoppers, with photos.
 *
 * When a shopper leaves, what they noticed on the visit is weighed up: how long they queued, whether
 * they found their list, the prices, the floor, how the shop looks (decor, full shelves, room to move,
 * the frontage), who served them, parking, fresh food, the range. Most say nothing; some go home and
 * write a few lines (the very happy and the cross most of all), and some attach photos: their haul,
 * a selfie with it, the aisles, the shopfront. The stars become the listing's rating, which in turn
 * nudges the shop's reputation (people read reviews before they choose where to shop).
 *
 * Its own random stream: nothing else in the sim draws differently because of it.
 */
import type { GameState, Person, Look, CustomerType } from './types';
import { withRng } from './state';
import type { Rng } from './rng';
import { productDef } from './products';
import { FIXTURES, FLOORS, WALLS, DAY_SECONDS, TICK, shopTileList, tileKey, wallSegments, shopArea, highCeilings, edgeOf, levelOf } from './layout';
import { FINISHED, finishOf } from './build';
import { priceIndex } from './customers';
import { effectivePrice } from './marketing';
import { formatMoney } from './money';
import { onFrontage } from './life';
import { lotAppeal } from './lot';
import { SIGN_TIERS, signTier } from './frontage';
import { weatherAt } from './weather';

export type PhotoKind = 'outside' | 'aisle' | 'haul' | 'selfie';
/** A photo a shopper took: what of, a seed for the angle, the time of day (0..1) and, for food, what they bought. */
export interface ReviewPhoto { id: string; kind: PhotoKind; seed: number; t: number; products?: string[] }
/** What a review talks about. */
export type Topic = 'wait' | 'stock' | 'price' | 'clean' | 'looks' | 'outside' | 'staff' | 'parking' | 'fresh' | 'range';
export interface Review {
  id: number;
  /** The day it went up, and when (0..1 through the opening hours). */
  day: number; t: number;
  author: string;
  /** A "Local Guide" (writes a lot), and how many reviews and photos they have posted anywhere. */
  guide: boolean; authorReviews: number; authorPhotos: number;
  /** The shopper's look (their profile picture is them). */
  look: Look; ctype?: CustomerType;
  stars: number;
  /** Empty for a stars-only review. */
  text: string;
  topics: { topic: Topic; good: boolean }[];
  photos: ReviewPhoto[];
  /** Other people who found it helpful. */
  likes: number;
  /** The owner's reply. */
  reply?: { day: number; text: string };
}
interface Pending extends Review { postTick: number }
export interface Listing {
  /** The newest reviews (older ones drop off; the totals keep counting). */
  reviews: Review[];
  /** Written but not posted yet: shoppers post when they get home. */
  pending: Pending[];
  count: number; starSum: number;
  /** How many of each star, [1★, 2★, 3★, 4★, 5★]. */
  stars: number[];
  nextId: number;
}

const KEEP = 160;

export function listingOf(state: GameState): Listing {
  state.listing ??= { reviews: [], pending: [], count: 0, starSum: 0, stars: [0, 0, 0, 0, 0], nextId: 1 };
  return state.listing;
}

/** The average rating to one decimal (0 with no reviews). */
export function rating(state: GameState): number {
  const l = state.listing;
  return l && l.count ? Math.round((l.starSum / l.count) * 10) / 10 : 0;
}

const clamp = (x: number, a = -1, b = 1) => Math.max(a, Math.min(b, x));

/** How the shop looks, each part 0..1, and overall. */
export interface Looks {
  /** Plants, signs, benches, baskets by the door. */
  decor: number;
  /** A clean floor, nothing spilt. */
  tidy: number;
  /** Shelves full and colourful. */
  shelves: number;
  /** Room to move: neither bare nor crammed. */
  space: number;
  /** The frontage: litter, dog mess, a gang of teenagers by the door. */
  outside: number;
  /** The lot: what is planted and laid out there (0..1). */
  curb: number;
  /** A lit sign, a bigger shop, a bigger car park, a fresh produce display. */
  extras: number;
  score: number;
}

/** The shop's looks, as shoppers see them. */
export function looksOf(state: GameState): Looks {
  const shop = state.shop;
  // (A wall the shop came with is no decor: the front's glass, say.)
  const count = (t: string) => shop.fixtures.filter((f) => f.type === t && !f.free).length;
  let decor = 0;
  for (const [type, def] of Object.entries(FIXTURES)) if (def.looks) decor += Math.min(count(type), def.looksCap ?? 1) * def.looks;
  decor = clamp(decor, 0, 1);
  const tidy = clamp((shop.cleanliness - 0.35) / 0.6 - shop.litter.length * 0.12, 0, 1);
  let slots = 0, full = 0;
  for (const f of shop.fixtures) for (const s of f.slots) { slots++; if (s.productId) full += Math.min(1, s.qty / Math.max(1, FIXTURES[f.type].capacity)); }
  const shelves = slots ? clamp((full / slots) * 1.15, 0, 1) : 0;
  const area = shopArea(shop);
  // (A wall stands on an edge: it covers no floor.)
  const used = shop.fixtures.reduce((a, f) => a + (FIXTURES[f.type].outdoor || FIXTURES[f.type].edge ? 0 : FIXTURES[f.type].w * FIXTURES[f.type].d), 0) / Math.max(1, area);
  // Best between about a fifth and a half of the floor: bare below, crammed above.
  const space = used < 0.2 ? clamp(used / 0.2, 0, 1) : used > 0.5 ? clamp(1 - (used - 0.5) / 0.25, 0, 1) : 1;
  const mess = (state.life?.litter ?? []).filter((l) => onFrontage(state, l)).length;
  const teens = (state.life?.hangouts ?? []).some((h) => h.mine);
  const outside = clamp(1 - mess * 0.18 - (teens ? 0.35 : 0), 0, 1);
  // The lot itself: flower beds, trees, benches, paving.
  const curb = lotAppeal(shop);
  // The floor, tile by tile on every open floor: what each finish adds, averaged over the shop.
  const tiles = shopTileList(shop);
  const floor = tiles.reduce((a, t) => a + (FLOORS.find((x) => x.id === (shop.tileStyles?.[tileKey(t.x, t.z)] ?? shop.floorStyle ?? 'lino'))?.looks ?? 0), 0) / Math.max(1, tiles.length);
  // The walls round the shop, one by one, as the floor.
  const walls = wallSegments(shop).map((w) => shop.fixtures.find((f) => f.id === w.id)!).filter((f) => FINISHED.has(f.type));
  const wallLooks = walls.reduce((a, f) => a + (WALLS.find((x) => x.id === finishOf(shop, f))?.looks ?? 0), 0) / Math.max(1, walls.length);
  // Windows in the side and back walls: daylight on more of the shop (a few each make a difference; past a dozen, not much).
  const windows = Math.min(walls.filter((f) => f.type === 'wallWindow' && !(levelOf(f) === 0 && edgeOf(f).line === shop.floor.z1 && edgeOf(f).dir === 'front')).length, 15) * 0.016;
  // A double-height space or two (panels taken down): light and air.
  const lofty = Math.min(highCeilings(shop), 6) * 0.02;
  const extras = clamp(SIGN_TIERS[signTier(shop)]!.looks + (shop.sizeId === 'medium' ? 0.2 : shop.sizeId === 'large' ? 0.35 : 0) + (shop.bays.length >= 8 ? 0.15 : 0) + 0.25 * curb + (count('produce') > 0 ? 0.25 : 0) + floor + wallLooks + windows + lofty + 0.1, 0, 1);
  // Decor matters most: a clean, full shop with nothing on show is fine, not lovely.
  const score = 0.3 * decor + 0.16 * tidy + 0.18 * shelves + 0.1 * space + 0.14 * outside + 0.12 * extras;
  return { decor, tidy, shelves, space, outside, curb, extras, score };
}

/** What one shopper made of their visit, topic by topic (-1 bad .. 1 good), and overall (0..1). */
export interface Visit { scores: Record<Topic, number>; overall: number; served: boolean }

function judge(state: GameState, p: Person, happy: boolean, looks: Looks, r: Rng): Visit {
  const served = happy && !!p.paid;
  const basket = p.basket ?? [];
  const waited = p.maxPatience && p.patience !== undefined ? clamp(1 - p.patience / p.maxPatience, 0, 1) : 0;
  const gaveUp = !happy && basket.length > 0 && waited > 0.95;
  const wait = gaveUp ? -1 : served ? clamp(0.8 - 2.2 * waited) : 0;
  const missed = p.missed ?? 0;
  const stock = !served && basket.length === 0 && missed > 0 ? -0.9 : missed === 0 && basket.length > 0 ? 0.5 : clamp(0.2 - 0.45 * missed);
  let price = clamp((1.04 - priceIndex(state)) * 5) * (p.ctype === 'bargain' ? 1.4 : p.ctype === 'loyalist' ? 0.6 : 1);
  if ((p.priceyIds?.length ?? 0) > 0) price = Math.min(price, -0.5);
  let clean = clamp((state.shop.cleanliness - 0.72) * 3.5 - state.shop.litter.length * 0.25);
  if (p.sawMess) clean = Math.min(clean, -0.5);
  const lk = clamp((looks.score - 0.5) * 2.4);
  // Mess out front counts against; a lot with flowers and trees and paving is worth a word.
  const outside = clamp(clamp((looks.outside - 0.85) * 3, -1, 0.3) + (looks.outside > 0.85 ? looks.curb * 1.2 : 0), -1, 0.9);
  const staff = p.servedBy === 'staff' ? 0.5 + 0.4 * (p.servedSkill ?? 0.5) : p.servedBy === 'owner' ? 0.45 : p.servedBy === 'kiosk' ? (p.ctype === 'loyalist' ? -0.3 : 0) : gaveUp ? -0.5 : 0;
  const parking = p.carId !== null && p.carId !== undefined ? (state.today.complaints.lotFull > 0 ? -0.4 : 0.3) : 0;
  const fresh = basket.some((b) => productDef(b.productId).category === 'produce') ? 0.55 : 0;
  const stocked = new Set<string>();
  for (const f of state.shop.fixtures) for (const s of f.slots) if (s.productId && s.qty > 0) stocked.add(s.productId);
  const range = clamp((stocked.size - 12) / 12);
  const scores: Record<Topic, number> = { wait, stock, price, clean, looks: lk, outside, staff, parking, fresh, range };
  const overall = 0.54 + 0.16 * wait + 0.15 * stock + 0.09 * price + 0.07 * clean + 0.15 * lk + 0.06 * outside + 0.04 * staff + 0.03 * parking + 0.03 * fresh + 0.04 * range + r.normal(0, 0.07);
  return { scores, overall: clamp(overall, 0, 1), served };
}

export function starsFor(overall: number): number { return overall >= 0.8 ? 5 : overall >= 0.67 ? 4 : overall >= 0.53 ? 3 : overall >= 0.38 ? 2 : 1; }

// ---- Words.
const FEMALE = ['Maria', 'Sophie', 'Priya', 'Hannah', 'Chloe', 'Aisha', 'Emma', 'Grace', 'Lucy', 'Olivia', 'Zara', 'Megan', 'Fatima', 'Ellie', 'Rosa', 'Jess', 'Anna', 'Nadia', 'Katie', 'Mei', 'Laura', 'Amira', 'Beth', 'Sara'];
const MALE = ['Tom', 'James', 'Ali', 'Daniel', 'Sam', 'Raj', 'Luke', 'Ben', 'Omar', 'Jack', 'Chris', 'Dev', 'Marco', 'Liam', 'Kofi', 'Ryan', 'Adam', 'Leo', 'Pete', 'Hassan', 'Joe', 'Mark', 'Kenji', 'Will'];
const SURNAMES = ['Garcia', 'Hughes', 'Sharma', 'Okafor', 'Taylor', 'Nguyen', 'Murphy', 'Kowalski', 'Patel', 'Evans', 'Rossi', 'Khan', 'Bennett', 'Silva', 'Walsh', 'Mensah', 'Clarke', 'Novak', 'Ahmed', 'Fraser', 'Lopez', 'Wright', 'Chen', 'Doyle', 'Brooks', 'Ward'];

const OPEN: Record<number, string[]> = {
  5: ['Lovely little shop!', 'Our new favourite local.', 'Brilliant corner shop.', "Can't fault it.", 'An absolute gem.', 'Five stars from me.', 'Such a nice shop to have on the corner.', 'Great shop, great people.'],
  4: ['Really nice shop.', 'Good local shop.', 'Handy and pleasant.', 'Solid little grocer.', 'Nice place, mostly great.', 'Pleasant visit.'],
  3: ["It's alright.", 'Decent enough.', 'Mixed visit.', 'OK for a quick shop.', 'Not bad, not amazing.'],
  2: ['Bit disappointing.', 'Not great today.', 'Expected better.', 'Meh.'],
  1: ['Avoid.', 'Really poor.', "Won't be going back.", 'Worst shop on the crossroads.', 'Shocking.'],
};
const CLOSE: Record<number, string[]> = {
  5: ['Will definitely be back!', 'Highly recommend.', 'Keep it up!', '😊', '👍', 'Love it.'],
  4: ['Will be back.', 'Recommend.', 'Worth a visit.'],
  3: ['Could be better.', 'Room to improve.'],
  2: ['Sort it out.', 'Hope it improves.'],
  1: ['Never again.', 'Save yourself the trip.'],
};
const SAY: Record<Topic, { good: string[]; bad: string[] }> = {
  wait: { good: ['In and out in five minutes.', 'No queue at the till at all.', 'Quick at the checkout.', 'Barely waited to pay.'], bad: ['Waited ages at the till.', 'The queue barely moved.', 'Only one till open and a long line.', 'Slow, slow, slow at the checkout.'] },
  stock: { good: ['Found everything on my list.', 'Had everything I needed, even {p}.', 'Shelves well stocked.'], bad: ['No {m} again!', 'Half my list was out of stock.', "Couldn't find any {m}.", 'Gaps on the shelves everywhere.'] },
  price: { good: ['Prices are really fair.', 'Cheaper than {rival} for {p}.', 'Good value, especially the {p}.', 'Great prices for a local shop.'], bad: ['{x} at {price}?! Daylight robbery.', 'A bit pricey.', 'Way dearer than {rival}.', 'Prices seem to go up every week.'] },
  clean: { good: ['Spotless inside.', 'Clean and tidy.', 'Floors gleaming.'], bad: ['Floor was sticky.', "Someone's mess was still on the floor.", 'Could do with a mop.'] },
  looks: { good: ['Really bright and welcoming inside.', 'Love the plants and the signs, feels like a proper little market.', 'Beautifully laid out.', 'The {colour} shopfront is so cheerful.', 'Lovely displays.'], bad: ['Feels a bit bare inside.', 'Looks like a warehouse, no character.', 'Crammed in, hard to get round with a basket.', 'Shelves half empty, looks a bit sad.', 'Messy and tired looking.'] },
  outside: { good: ['Lovely flower beds out front.', 'Pretty outside: trees, benches, the lot.', 'Nice place to sit outside with a coffee.'], bad: ['Litter all over the pavement outside.', 'Teenagers smoking right by the door.', 'Dog mess by the entrance. Gross.'] },
  staff: { good: ['{name} on the till was lovely.', 'Staff are so friendly.', 'The owner was really helpful.', 'Friendly service.'], bad: ['Nobody on the tills.', 'Staff seemed rushed off their feet.', "Didn't like the self-checkout."] },
  parking: { good: ['Easy parking.', 'Plenty of spaces out front.'], bad: ['Car park was full, had to circle round.', 'Nowhere to park.'] },
  fresh: { good: ['Fruit and veg really fresh.', 'The {p} was lovely and fresh.'], bad: [] },
  range: { good: ['Great range for a small shop.', 'Lots of choice.'], bad: ['Not much choice.', 'Small range.'] },
};
const COLOUR_NAMES: Record<string, string> = { green: 'green', berry: 'pink', tangerine: 'orange', plum: 'purple', teal: 'teal', cocoa: 'brown' };

function fill(text: string, ctx: Record<string, string>): string { return text.replace(/\{(\w+)\}/g, (_, k: string) => ctx[k] ?? ''); }

/** Something nice about the lot, about what is actually out there. */
function outsideGood(state: GameState, r: Rng): string {
  const has = (t: string) => state.shop.fixtures.some((f) => f.type === t);
  const laid = Object.values(state.shop.lotTiles ?? {});
  const lines = [
    ...(has('flowerBed') || has('planter') ? ['Lovely flowers out front.', 'The flower beds outside are gorgeous.'] : []),
    ...(has('tree') ? ['Nice trees round the car park, very green.'] : []),
    ...(has('parkBench') ? ['Benches outside to sit and have a snack.'] : []),
    ...(has('bikeRack') ? ['Somewhere to lock the bike, finally.'] : []),
    ...(laid.includes('brick') || laid.includes('paving') ? ['Smart paving out front.'] : []),
  ];
  return lines.length ? r.pick(lines) : 'Looks lovely from the street.';
}

/** The sentence for the shop's worst-looking part. */
function looksBad(looks: Looks): string {
  const parts: [number, string][] = [[looks.decor + 0.15, 'Feels a bit bare inside.'], [looks.space, 'Crammed in, hard to get round with a basket.'], [looks.shelves, 'Shelves half empty, looks a bit sad.'], [looks.tidy, 'Messy and tired looking.']];
  if (looks.decor < 0.1 && looks.shelves > 0.6) parts.push([0.05, 'Looks like a warehouse, no character.']);
  return parts.sort((a, b) => a[0] - b[0])[0]![1];
}

function write(state: GameState, p: Person, v: Visit, stars: number, looks: Looks, r: Rng): { text: string; topics: Review['topics'] } {
  // What stood out: the strongest feelings, good or bad, matching the stars' mood.
  const ranked = (Object.entries(v.scores) as [Topic, number][])
    .filter(([t, s]) => Math.abs(s) > 0.25 && (s > 0 ? SAY[t].good.length : SAY[t].bad.length) > 0)
    // A tidy frontage is only worth a word when something has been planted or laid out there.
    .filter(([t, s]) => t !== 'outside' || s < 0 || looks.curb > 0.08)
    .filter(([, s]) => (stars >= 4 ? s > -0.6 : stars <= 2 ? s < 0.6 : true))
    .sort((a, b) => Math.abs(b[1]) * (0.7 + r.next() * 0.6) - Math.abs(a[1]) * (0.7 + r.next() * 0.6));
  const n = Math.min(ranked.length, r.chance(0.3) ? 1 : r.chance(0.6) ? 2 : 3);
  const topics = ranked.slice(0, n).map(([topic, s]) => ({ topic, good: s > 0 }));
  if (r.chance(0.16)) return { text: '', topics };
  const basket = p.basket ?? [];
  const bought = basket.length ? productDef(r.pick(basket).productId).name.toLowerCase() : 'bread';
  const missedId = p.missedIds?.length ? r.pick(p.missedIds) : null;
  const priceyId = p.priceyIds?.length ? r.pick(p.priceyIds) : basket.length ? r.pick(basket).productId : null;
  const rivals = state.rivals.filter((x) => x.open);
  const staff = state.people.find((x) => x.kind === 'staff' && x.role === 'cashier' && x.name);
  const ctx: Record<string, string> = {
    p: bought, m: missedId ? productDef(missedId).name.toLowerCase() : 'milk',
    x: priceyId ? productDef(priceyId).name : 'Milk', price: priceyId ? formatMoney(effectivePrice(state, priceyId)) : '',
    rival: rivals.length ? r.pick(rivals).name : 'the big shops', name: staff?.name?.split(' ')[0] ?? 'The lady',
    colour: COLOUR_NAMES[state.shop.scheme] ?? 'bright',
  };
  const lines: string[] = [];
  if (r.chance(0.8)) lines.push(r.pick(OPEN[stars]!));
  for (const { topic, good } of topics) {
    let s = topic === 'looks' && !good ? looksBad(looks) : r.pick(good ? SAY[topic].good : SAY[topic].bad);
    if (topic === 'wait' && !good && v.scores.wait <= -1) s = 'Stood in the queue for ages and gave up. Left my basket.';
    if (topic === 'outside' && !good) s = (state.life?.hangouts ?? []).some((h) => h.mine) && r.chance(0.6) ? 'Teenagers smoking right by the door.' : (state.life?.litter ?? []).some((l) => l.kind === 'poop' && onFrontage(state, l)) ? 'Dog mess by the entrance. Gross.' : 'Litter all over the pavement outside.';
    if (topic === 'outside' && good) s = outsideGood(state, r);
    if (topic === 'staff' && good && p.servedBy === 'owner') s = 'The owner served me and was really helpful.';
    if (topic === 'price' && good && !rivals.length && s.includes('{rival}')) s = 'Prices are really fair.';
    lines.push(fill(s, ctx));
  }
  const now = weatherAt(state.sky ?? 'fair', state.seed, state.day, state.time / DAY_SECONDS);
  if (now.rain > 0.4 && r.chance(0.3)) lines.push(stars >= 4 ? 'Got soaked on the way but worth it.' : 'Soaked through and then this.');
  if (r.chance(0.55)) lines.push(r.pick(CLOSE[stars]!));
  let text = lines.join(' ');
  // Not everyone writes neatly.
  if (r.chance(0.18)) text = text.toLowerCase().replace(/\.$/, '');
  else if (r.chance(0.12) && stars === 5) text = text.replace(/[.!]*$/, '!!');
  return { text, topics };
}

function photosFor(p: Person, v: Visit, stars: number, topics: Review['topics'], id: number, t: number, r: Rng): ReviewPhoto[] {
  if (!r.chance(0.26 + (stars === 5 || stars === 1 ? 0.14 : 0))) return [];
  const n = r.chance(0.6) ? 1 : r.chance(0.75) ? 2 : 3;
  const has = (t: Topic) => topics.some((x) => x.topic === t);
  const products = (p.basket ?? []).map((b) => b.productId).slice(0, 4);
  const options: [PhotoKind, number][] = [
    ['haul', products.length ? 3 : 0], ['selfie', products.length && v.served ? 2 : 0],
    ['aisle', 2 + (has('looks') || has('stock') ? 2 : 0)], ['outside', 1.5 + (has('outside') ? 3 : 0) + (has('looks') ? 1 : 0)],
  ];
  const out: ReviewPhoto[] = [];
  for (let i = 0; i < n; i++) {
    const total = options.reduce((a, o) => a + o[1], 0);
    let x = r.next() * total, kind: PhotoKind = 'aisle';
    for (const [k, w] of options) { if (x < w) { kind = k; break; } x -= w; }
    // A second photo is of something else.
    const o = options.find((q) => q[0] === kind)!; o[1] *= 0.3;
    out.push({ id: `${id}-${i}`, kind, seed: r.int(1, 1e6), t, products: kind === 'haul' || kind === 'selfie' ? products : undefined });
  }
  return out;
}

/** Someone leaving the shop: maybe they will write a review when they get home. */
export function noteVisit(state: GameState, p: Person, happy: boolean): void {
  if (p.kind !== 'customer' || p.rivalId || state.phase === 'picking' || state.phase === 'setup') return;
  // Never got going (came to a closed shop): nothing to say.
  if (!happy && !(p.basket?.length) && !(p.missed ?? 0) && !(p.priceyIds?.length)) return;
  const l = listingOf(state);
  withRng(state, 'reviews', (r) => {
    const looks = looksOf(state);
    const v = judge(state, p, happy, looks, r);
    const stars = starsFor(v.overall);
    const chance = v.served ? 0.045 + (stars === 5 ? 0.05 : 0) + (stars <= 2 ? 0.08 : 0) : 0.1;
    if (!r.chance(chance) || l.pending.length > 8) return;
    const female = p.look.model % 2 === 0;
    const author = `${r.pick(female ? FEMALE : MALE)} ${r.pick(SURNAMES)}`;
    const guide = r.chance(0.25);
    const id = l.nextId++;
    const t = Math.min(1, state.time / DAY_SECONDS);
    const { text, topics } = write(state, p, v, stars, looks, r);
    const photos = photosFor(p, v, stars, topics, id, t, r);
    l.pending.push({
      id, day: state.day, t, author, guide,
      authorReviews: guide ? r.int(18, 340) : r.int(1, 14), authorPhotos: guide ? r.int(20, 900) : photos.length ? r.int(photos.length, 30) : r.int(0, 6),
      look: { ...p.look }, ctype: p.ctype, stars, text, topics, photos, likes: 0,
      postTick: state.tick + Math.round(r.range(20, 200) / TICK),
    });
  });
}

function post(state: GameState, rv: Pending): void {
  const l = listingOf(state);
  const { postTick: _postTick, ...review } = rv;
  void _postTick;
  review.day = state.day;
  review.t = Math.min(1, state.time / DAY_SECONDS);
  l.reviews.unshift(review);
  if (l.reviews.length > KEEP) l.reviews.length = KEEP;
  l.count++; l.starSum += review.stars; l.stars[review.stars - 1]!++;
}

/** Post the reviews whose writers have got home. */
export function tickReviews(state: GameState): void {
  const l = state.listing;
  if (!l || !l.pending.length) return;
  const due = l.pending.filter((x) => x.postTick <= state.tick);
  if (!due.length) return;
  l.pending = l.pending.filter((x) => x.postTick > state.tick);
  for (const rv of due) post(state, rv);
}

/** At night: the rest are posted, and readers find the useful ones helpful. */
export function reviewsNight(state: GameState): void {
  const l = state.listing;
  if (!l) return;
  for (const rv of l.pending) post(state, rv);
  l.pending = [];
  withRng(state, 'reviews', (r) => {
    for (const rv of l.reviews.slice(0, 40)) {
      const pull = (rv.text.length > 80 ? 0.25 : 0.08) + (rv.photos.length ? 0.15 : 0) + (rv.stars <= 2 ? 0.1 : 0);
      if (r.chance(pull)) rv.likes += 1;
    }
  });
}

/** The listing's pull on reputation (0..1), once there are enough reviews to read; null before. */
export function ratingPull(state: GameState): number | null {
  const l = state.listing;
  return l && l.count >= 5 ? (l.starSum / l.count - 1) / 4 : null;
}

/** The owner answers a review (once; it can be edited). */
export function replyToReview(state: GameState, reviewId: number, text: string): boolean {
  const rv = state.listing?.reviews.find((x) => x.id === reviewId);
  const t = text.trim().slice(0, 600);
  if (!rv || !t) return false;
  // Answering an unhappy customer politely, the first time, earns a little goodwill.
  if (!rv.reply && rv.stars <= 3) state.shop.reputation = Math.min(1, state.shop.reputation + 0.004);
  rv.reply = { day: state.day, text: t };
  return true;
}
