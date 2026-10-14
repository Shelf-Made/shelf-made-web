/**
 * Marketing and events: flyer campaigns by area that fade, billboards at fixed sites,
 * ad templates (with a penalty for ads you cannot honour), promotions, holidays, festivals,
 * weather and random events. Outside signs raise awareness.
 */
import type { GameState, Promotion, AdTemplate, DayPlan } from './types';
import { productDef } from './products';
import { withRng, cue } from './state';
import { OFFMAP_SITES, BILLBOARDS } from './layout';
import { dollars } from './money';

/** Flyers go out in the neighbourhoods the roads lead to (each signposted at the edge of town). */
export const FLYER_AREAS = OFFMAP_SITES.map((p) => ({ id: p.id, name: p.name, dir: p.dir, km: p.km, cost: 60 + Math.round(p.traffic * 40), reach: 0.12 * p.traffic }));
export const BILLBOARD_SITES = BILLBOARDS;

export function startFlyers(state: GameState, areaId: string): string | null {
  const area = FLYER_AREAS.find((a) => a.id === areaId);
  if (!area) return 'No such area.';
  if (state.cash < area.cost) return `Need ${dollars(area.cost)}.`;
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
  if (state.cash < site.rent) return `Need ${dollars(site.rent)} for the first day.`;
  state.marketing.billboards.push(site.id);
  state.notices.push({ day: state.day, text: `Billboard rented at the ${site.name.toLowerCase()}: ${dollars(site.rent)} a day.`, kind: 'event' });
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
  if (ad) state.notices.push({ day: state.day, text: `Ad running: "${adHeadline(ad)}". Costs ${dollars(AD_COST)}/day; if shoppers cannot find what it promised, your reputation pays.`, kind: 'event' });
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

/** Daily: campaigns fade, billboards bill, the day's events (planned last night) land, the ad is checked against the shelves. */
export function marketingDay(state: GameState, plan: Pick<DayPlan, 'eventDemand' | 'notices' | 'event'>): void {
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
  applyEvents(state, plan);
}

const WEATHER = [
  { text: 'Sunshine: a lovely day, more people walking.', mul: 1.1 },
  { text: 'Heavy rain: fewer walkers, more drivers.', mul: 0.85 },
  { text: 'Heatwave: drinks and ice cream fly.', mul: 1.15 },
  { text: 'Grey and cold: soup weather.', mul: 0.95 },
];

/** An opening-day event (a goal reward): bunting up, a crowd in. */
export const OPENING_EVENT_COST = 120;
export const OPENING_EVENT_MUL = 1.3;

/**
 * Roll a day's events (the 'events' random stream, in the order the day always rolled it): the weekday,
 * festivals, holidays, the weather and the odd surprise. Rolled at close for tomorrow, so the night card
 * can say what is coming; applied when the day opens.
 */
export function planEvents(state: GameState, day: number): Pick<DayPlan, 'eventDemand' | 'weather' | 'festival' | 'event' | 'notices'> {
  return withRng(state, 'events', (r) => {
    let mul = 1;
    const notices: string[] = [];
    let festival: string | null = null;
    const dayOfWeek = day % 7;
    if (dayOfWeek === 6) { mul *= 1.25; notices.push('Saturday: the whole town shops today.'); festival = 'Saturday: the whole town shops.'; }
    if (day % 10 === 0) { mul *= 1.45; notices.push('Festival day! Stalls on the main road and crowds everywhere.'); festival = 'Festival day: stalls on Main Road and crowds everywhere.'; }
    if (day === 14 || day === 28) { mul *= 1.35; notices.push('Holiday weekend: stock up before everyone else does.'); festival = 'Holiday weekend: stock up before everyone else does.'; }
    const w = r.pick(WEATHER);
    let weather: string | null = null;
    if (r.chance(0.45)) { mul *= w.mul; notices.push(w.text); weather = w.text; }
    let event: DayPlan['event'] = null;
    if (r.chance(0.1)) {
      const ev = r.pick([
        { text: 'Road works on the main road: half the traffic is diverted.', mul: 0.7 },
        { text: 'A food blogger mentioned the shop. Everyone wants a look.', mul: 1.3, rep: 0.03 },
        { text: 'Power cut last night: the fridges warmed up and some chilled stock spoiled.', mul: 1, spoil: true },
        { text: 'The school is on a trip today: the afternoon rush is quiet.', mul: 0.85 },
      ]);
      mul *= ev.mul;
      event = { text: ev.text, rep: ev.rep, spoil: ev.spoil };
    }
    if (state.marketing.openingEventDay === day) mul *= OPENING_EVENT_MUL;
    return { eventDemand: Math.round(mul * 100) / 100, weather, festival, event, notices };
  });
}

function applyEvents(state: GameState, plan: Pick<DayPlan, 'eventDemand' | 'notices' | 'event'>): void {
  for (const text of plan.notices) state.notices.push({ day: state.day, text, kind: 'event' });
  if (plan.event) {
    state.notices.push({ day: state.day, text: plan.event.text, kind: 'event' });
    if (plan.event.rep) state.shop.reputation = Math.min(1, state.shop.reputation + plan.event.rep);
    if (plan.event.spoil) for (const f of state.shop.fixtures) for (const s of f.slots) if (s.productId && productDef(s.productId).chilled) s.qty = Math.floor(s.qty * 0.5);
  }
  if (state.marketing.openingEventDay === state.day) {
    state.shop.awareness = Math.min(1, state.shop.awareness + 0.05);
    state.notices.push({ day: state.day, text: 'Opening-day event: bunting is up and the town has come to see.', kind: 'event' });
  }
  state.eventDemand = plan.eventDemand;
}

/** Book an opening-day event for tomorrow (unlocked by a goal). */
export function bookOpeningEvent(state: GameState): string | null {
  if (!state.goals.unlocked.includes('openingEvent')) return 'Reach the Neighbourhood grocer goal to unlock events.';
  const day = state.day + 1;
  if (state.marketing.openingEventDay === day) return 'Already booked for tomorrow.';
  if (state.cash < OPENING_EVENT_COST) return `Need ${dollars(OPENING_EVENT_COST)}.`;
  state.cash -= OPENING_EVENT_COST; state.today.other += OPENING_EVENT_COST;
  state.marketing.openingEventDay = day;
  // Tonight's plan was rolled already: put the crowd into it.
  if (state.tomorrow && state.tomorrow.day === day) { state.tomorrow.eventDemand = Math.round(state.tomorrow.eventDemand * OPENING_EVENT_MUL * 100) / 100; state.tomorrow.rumours.push('Your opening-day event is tomorrow: bunting, balloons, and a crowd.'); }
  state.notices.push({ day: state.day, text: 'Opening-day event booked for tomorrow: bunting up, and a crowd in.', kind: 'event' });
  cue(state, 'order');
  return null;
}

export function makeMarketing(): GameState['marketing'] { return { campaigns: [], billboards: [], promotion: null, ad: null, outsideSign: false }; }
