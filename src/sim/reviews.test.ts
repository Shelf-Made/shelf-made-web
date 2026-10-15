import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { tick, applyCommand, TICK, DAY_SECONDS, FIXTURES, type GameState } from './index';
import { looksOf, rating, listingOf, starsFor, reviewsNight } from './reviews';

/** One day of trade: the till scanned, the shelves kept full; `mess` leaves the floor dirty all day. */
function playDay(s: GameState, mess = false): void {
  const ticks = Math.ceil((DAY_SECONDS + 130) / TICK);
  for (let i = 0; i < ticks && s.phase !== 'night'; i++) {
    tick(s);
    if (i % 6 === 0) applyCommand(s, { type: 'scan' });
    if (i % 1200 === 0) for (const f of s.shop.fixtures) for (const sl of f.slots) if (sl.productId) sl.qty = FIXTURES[f.type].capacity;
    if (mess && i % 200 === 0) { s.shop.cleanliness = 0.3; if (s.shop.litter.length < 3) s.shop.litter.push({ id: 90000 + i, x: s.shop.originX, z: s.shop.originZ - 2 }); }
  }
}
function nextDay(s: GameState): void { s.tomorrow = null; applyCommand(s, { type: 'openTomorrow' }); }

/** A shop dressed up: plants, aisle signs, a bench and baskets by the door. */
function decorate(s: GameState): void {
  s.cash += 2000;
  const f = s.shop.floor;
  const spots: [string, number, number][] = [];
  for (let z = f.z0; z < f.z1; z++) for (let x = f.x0; x < f.x1; x++) spots.push(['', x, z]);
  let placed = 0;
  for (const t of ['plant', 'plant', 'plant', 'sign', 'sign', 'bench', 'basketStack', 'plant']) {
    for (const [, x, z] of spots) if (applyCommand(s, { type: 'placeFixture', fixtureType: t as 'plant', x, z, rot: 0 }).ok) { placed++; break; }
  }
  expect(placed).toBeGreaterThan(5);
}

describe('reviews', () => {
  it('rate how the shop looks: decor and a clean floor count, litter and empty shelves do not', () => {
    const s = openGame({ seed: 4, plotId: 'main', name: 'Looks' });
    const bare = looksOf(s).score;
    decorate(s);
    const dressed = looksOf(s);
    expect(dressed.decor).toBeGreaterThan(0.6);
    expect(dressed.score).toBeGreaterThan(bare + 0.15);
    s.shop.cleanliness = 0.3; s.shop.litter.push({ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 0 });
    for (const f of s.shop.fixtures) for (const sl of f.slots) sl.qty = 0;
    const neglected = looksOf(s);
    expect(neglected.tidy).toBeLessThan(0.1);
    expect(neglected.shelves).toBe(0);
    expect(neglected.score).toBeLessThan(dressed.score - 0.3);
  });

  it('come in from shoppers after their visit, with words and photos, and a dressed-up clean shop rates higher than a bare messy one', () => {
    const good = openGame({ seed: 12, plotId: 'main', name: 'Good Shop' });
    decorate(good);
    const bad = openGame({ seed: 12, plotId: 'main', name: 'Bad Shop' });
    for (let d = 0; d < 4; d++) { playDay(good); playDay(bad, true); nextDay(good); nextDay(bad); }
    const g = listingOf(good), b = listingOf(bad);
    expect(g.count).toBeGreaterThan(10);
    expect(b.count).toBeGreaterThan(7); // a messy shop sees fewer shoppers, so fewer reviews
    expect(g.stars.reduce((a, n) => a + n, 0)).toBe(g.count);
    expect(rating(good)).toBeGreaterThan(rating(bad) + 0.4);
    expect(rating(good)).toBeGreaterThanOrEqual(3.8);
    // Real sentences: nothing left unfilled, mostly with something to say, some with photos.
    const all = [...g.reviews, ...b.reviews];
    for (const rv of all) {
      expect(rv.text).not.toMatch(/\{|\}|undefined|NaN/);
      expect(rv.stars).toBeGreaterThanOrEqual(1); expect(rv.stars).toBeLessThanOrEqual(5);
      expect(rv.author).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
      for (const ph of rv.photos) { expect(['outside', 'aisle', 'haul', 'selfie']).toContain(ph.kind); if (ph.kind === 'haul' || ph.kind === 'selfie') expect(ph.products?.length).toBeGreaterThan(0); }
    }
    expect(all.filter((rv) => rv.text).length).toBeGreaterThan(all.length * 0.6);
    expect(all.some((rv) => rv.photos.length > 0)).toBe(true);
    // The messy shop's reviews say so.
    expect(b.reviews.some((rv) => rv.topics.some((t) => t.topic === 'clean' && !t.good))).toBe(true);
  });

  it('are written when the shopper gets home, and the last of the day go up at night', () => {
    const s = openGame({ seed: 21, plotId: 'main', name: 'Later' });
    let pendingSeen = false;
    const ticks = Math.ceil((DAY_SECONDS + 130) / TICK);
    for (let i = 0; i < ticks && s.phase !== 'night'; i++) {
      tick(s);
      if (i % 6 === 0) applyCommand(s, { type: 'scan' });
      if ((s.listing?.pending.length ?? 0) > 0) pendingSeen = true;
    }
    expect(pendingSeen).toBe(true);
    expect(s.listing!.pending.length).toBe(0);
    const n = s.listing!.count;
    reviewsNight(s);
    expect(s.listing!.count).toBe(n);
  });

  it('can be answered by the owner, and an answer to an unhappy customer wins a little goodwill', () => {
    const s = openGame({ seed: 8, plotId: 'main', name: 'Replies' });
    for (let d = 0; d < 3 && listingOf(s).reviews.filter((r) => r.stars <= 3).length === 0; d++) { playDay(s, true); nextDay(s); }
    const low = listingOf(s).reviews.find((r) => r.stars <= 3)!;
    expect(low).toBeDefined();
    const rep = s.shop.reputation;
    expect(applyCommand(s, { type: 'replyReview', reviewId: low.id, text: 'So sorry, we have fixed it.' }).ok).toBe(true);
    expect(low.reply?.text).toBe('So sorry, we have fixed it.');
    expect(s.shop.reputation).toBeGreaterThan(rep);
    // Once only: editing the reply does not count again.
    const after = s.shop.reputation;
    applyCommand(s, { type: 'replyReview', reviewId: low.id, text: 'Edited.' });
    expect(s.shop.reputation).toBe(after);
    expect(applyCommand(s, { type: 'replyReview', reviewId: 999999, text: 'x' }).ok).toBe(false);
  });

  it('turn a visit into stars', () => {
    expect([0.9, 0.7, 0.6, 0.4, 0.1].map(starsFor)).toEqual([5, 4, 3, 2, 1]);
  });
});
