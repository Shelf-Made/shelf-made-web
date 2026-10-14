/**
 * Marketing and events: flyer campaigns by area that fade, billboards at fixed sites,
 * ad templates (with a penalty for ads you cannot honour), promotions, holidays, festivals,
 * weather and random events. Outside signs raise awareness.
 */
import type { GameState, Promotion, AdTemplate } from './types';
import { productDef } from './products';
import { withRng, cue } from './state';
import { PLOTS } from './layout';

export const FLYER_AREAS = PLOTS.map((p) => ({ id: p.id, name: p.name, cost: 60 + Math.round(p.traffic * 40), reach: 0.12 * p.traffic }));
export const BILLBOARD_SITES = [
  { id: 'highway', name: 'Highway exit', rent: 45, reach: 0.06 },
  { id: 'school', name: 'By the school', rent: 30, reach: 0.04 },
  { id: 'station', name: 'Bus station', rent: 35, reach: 0.05 },
];

export function startFlyers(state: GameState, areaId: string): string | null {
  const area = FLYER_AREAS.find((a) => a.id === areaId);
  if (!area) return 'No such area.';
  if (state.cash < area.cost) return `Need $${area.cost}.`;
  state.cash -= area.cost;
  state.marketing.campaigns.push({ id: state.nextId++, kind: 'flyers', areaId: area.id, startDay: state.day, strength: area.reach });
  state.shop.awareness = Math.min(1, state.shop.awareness + area.reach * 0.5);
  state.notices.push({ day: state.day, text: `Flyers out in ${area.name}. New faces for a few days, then it fades.`, kind: 'event' });
  cue(state, 'order');
  return null;
}

export function toggleBillboard(state: GameState, siteId: string): string | null {
  const site = BILLBOARD_SITES.find((b) => b.id === siteId);
  if (!site) return 'No such site.';
  const i = state.marketing.billboards.indexOf(site.id);
  if (i >= 0) { state.marketing.billboards.splice(i, 1); return null; }
  if (state.cash < site.rent) return `Need $${site.rent} for the first day.`;
  state.marketing.billboards.push(site.id);
  state.notices.push({ day: state.day, text: `Billboard rented at the ${site.name.toLowerCase()}: $${site.rent} a day.`, kind: 'event' });
  return null;
}

export function setPromotion(state: GameState, promo: Promotion | null): string | null {
  if (promo && !state.shop.fixtures.some((f) => f.slots.some((s) => s.productId === promo.productId))) return 'Put that product on a shelf first.';
  state.marketing.promotion = promo;
  if (promo) state.notices.push({ day: state.day, text: promo.kind === 'lossLeader' ? `${productDef(promo.productId).name} is a loss leader: sold at cost to pull people in.` : `Buy two ${productDef(promo.productId).name.toLowerCase()} deal is on.`, kind: 'event' });
  return null;
}

export function setAd(state: GameState, ad: AdTemplate | null): string | null {
  if (ad && ad.productId && !state.shop.fixtures.some((f) => f.slots.some((s) => s.productId === ad.productId))) return 'Advertise something you actually stock.';
  state.marketing.ad = ad;
  if (ad) state.notices.push({ day: state.day, text: `Ad running: "${adHeadline(ad)}". Costs $${AD_COST}/day; if shoppers cannot find what it promised, your reputation pays.`, kind: 'event' });
  return null;
}

export const AD_COST = 25;
export function adHeadline(ad: AdTemplate): string {
  const name = ad.productId ? productDef(ad.productId).name : 'everything';
  if (ad.kind === 'product') return `Fresh ${name.toLowerCase()} every day`;
  if (ad.kind === 'discount') return `${ad.percent ?? 10}% off ${name.toLowerCase()}`;
  return ad.target === 'bargain' ? 'Lowest prices on the street' : ad.target === 'convenience' ? 'In and out in two minutes' : ad.target === 'loyalist' ? 'Your brands, always in stock' : 'Treats by the till';
}

/** Price customers pay, after promotions. */
export function effectivePrice(state: GameState, productId: string): number {
  const def = productDef(productId);
  let price = state.prices[productId] ?? def.basePrice;
  const promo = state.marketing.promotion;
  if (promo && promo.productId === productId && promo.kind === 'lossLeader') price = Math.min(price, def.cost);
  const ad = state.marketing.ad;
  if (ad && ad.kind === 'discount' && (ad.productId === productId || !ad.productId)) price = price * (1 - (ad.percent ?? 10) / 100);
  return Math.round(price * 100) / 100;
}

/** Daily: campaigns fade, billboards bill, events roll, the ad is checked against the shelves. */
export function marketingDay(state: GameState): void {
  const m = state.marketing;
  m.campaigns = m.campaigns.filter((c) => state.day - c.startDay < 4);
  let aw = 0;
  for (const c of m.campaigns) aw += c.strength * (1 - (state.day - c.startDay) / 4);
  for (const id of m.billboards) { const site = BILLBOARD_SITES.find((b) => b.id === id); if (site) { aw += site.reach; state.cash -= site.rent; state.today.other += site.rent; } }
  if (m.ad) { state.cash -= AD_COST; state.today.other += AD_COST; aw += 0.03; }
  if (m.outsideSign) aw += 0.02;
  state.shop.awareness = Math.min(1, state.shop.awareness + aw);
  // Dishonoured ads: the advertised product is not on a shelf.
  if (m.ad && m.ad.productId && !state.shop.fixtures.some((f) => f.slots.some((s) => s.productId === m.ad!.productId && s.qty > 0))) {
    state.shop.reputation = Math.max(0, state.shop.reputation - 0.04);
    state.notices.push({ day: state.day, text: `Your ad promised ${productDef(m.ad.productId).name.toLowerCase()} and the shelf was empty. Reputation took a hit.`, kind: 'event' });
  }
  rollEvent(state);
}

const WEATHER = [
  { text: 'Sunshine: a lovely day, more people walking.', mul: 1.1 },
  { text: 'Heavy rain: fewer walkers, more drivers.', mul: 0.85 },
  { text: 'Heatwave: drinks and ice cream fly.', mul: 1.15 },
  { text: 'Grey and cold: soup weather.', mul: 0.95 },
];

function rollEvent(state: GameState): void {
  withRng(state, 'events', (r) => {
    let mul = 1;
    const dayOfWeek = state.day % 7;
    if (dayOfWeek === 6) { mul *= 1.25; state.notices.push({ day: state.day, text: 'Saturday: the whole town shops today.', kind: 'event' }); }
    if (state.day % 10 === 0) { mul *= 1.45; state.notices.push({ day: state.day, text: 'Festival day! Stalls on the main road and crowds everywhere.', kind: 'event' }); }
    if (state.day === 14 || state.day === 28) { mul *= 1.35; state.notices.push({ day: state.day, text: 'Holiday weekend: stock up before everyone else does.', kind: 'event' }); }
    const w = r.pick(WEATHER);
    if (r.chance(0.45)) { mul *= w.mul; state.notices.push({ day: state.day, text: w.text, kind: 'event' }); }
    if (r.chance(0.1)) {
      const ev = r.pick([
        { text: 'Road works on the main road: half the traffic is diverted.', mul: 0.7 },
        { text: 'A food blogger mentioned the shop. Everyone wants a look.', mul: 1.3, rep: 0.03 },
        { text: 'Power cut last night: the fridges warmed up and some chilled stock spoiled.', mul: 1, spoil: true },
        { text: 'The school is on a trip today: the afternoon rush is quiet.', mul: 0.85 },
      ]);
      state.notices.push({ day: state.day, text: ev.text, kind: 'event' });
      mul *= ev.mul;
      if (ev.rep) state.shop.reputation = Math.min(1, state.shop.reputation + ev.rep);
      if (ev.spoil) for (const f of state.shop.fixtures) for (const s of f.slots) if (s.productId && productDef(s.productId).chilled) s.qty = Math.floor(s.qty * 0.5);
    }
    state.eventDemand = Math.round(mul * 100) / 100;
  });
}

export function makeMarketing(): GameState['marketing'] { return { campaigns: [], billboards: [], promotion: null, ad: null, outsideSign: false }; }
