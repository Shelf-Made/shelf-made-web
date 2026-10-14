import { describe, it, expect } from 'vitest';
import { openGame } from './testUtil';
import { tick, applyCommand, TICK } from './index';
import { bagColour, shoppingBags, schemeById, RIVAL_SCHEMES, SHOP_SCHEMES, CHALLENGER_SCHEME } from './schemes';
import type { Person } from './types';

describe('shop colours and shopping bags', () => {
  it("a customer carries bags in the colour of the store they bought from, one to three by how much they bought", () => {
    const s = openGame({ seed: 21, plotId: 'main', name: 'Teal Shop', scheme: 'teal' });
    for (const r of s.rivals) r.open = true;
    let ours: Person | undefined, theirs: Person | undefined;
    for (let i = 0; i < 400 / TICK && (!ours || !theirs); i++) {
      tick(s); if (i % 6 === 0) applyCommand(s, { type: 'scan' });
      ours ??= s.people.find((p) => p.kind === 'customer' && p.paid && (p.basket?.length ?? 0) > 0);
      theirs ??= s.people.find((p) => p.rivalId && p.bags);
    }
    expect(ours, 'a paying customer of ours').toBeTruthy();
    expect(theirs, 'a rival shopper coming out with bags').toBeTruthy();
    expect(bagColour(s, ours!)).toBe(schemeById('teal').primary);
    const n = shoppingBags(ours!)!.n;
    expect(n).toBeGreaterThanOrEqual(1); expect(n).toBeLessThanOrEqual(3);
    const rival = s.rivals.find((r) => r.id === theirs!.rivalId)!;
    expect(bagColour(s, theirs!)).toBe(RIVAL_SCHEMES[rival.kind].primary);
    // Nobody who has not paid carries our bags.
    for (const p of s.people) if (p.kind === 'customer' && !p.paid) expect(shoppingBags(p)).toBeNull();
  });

  it('no player scheme can be mistaken for a rival (or a challenger) at a glance', () => {
    // A challenger that takes over a closed corner counts as a rival too.
    const rivals = [...Object.values(RIVAL_SCHEMES), CHALLENGER_SCHEME].map((r) => r.primary);
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    for (const sc of SHOP_SCHEMES) for (const r of rivals) {
      const [a, b] = [rgb(sc.primary), rgb(r)];
      expect(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!), `${sc.name} vs ${r}`).toBeGreaterThan(60);
    }
  });
});
