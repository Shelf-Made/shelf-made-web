/**
 * What the inspect panel says about a person: who they are, what kind of shopper, how they feel,
 * their list, basket and patience, and in plain words why they chose the store they did (from the
 * reasons stored on them when they set out). Pure: everything comes from the sim's state.
 */
import type { GameState, Person, CustomerType, StaffRole } from './types';
import { productDef } from './products';
import { reasonText, TYPE_NAMES, rivalShoppersByType } from './customers';
import { DAY_SECONDS } from './layout';
import { ROLE_NAMES } from './staff';

export type Mood = 'happy' | 'ok' | 'annoyed';

export interface InspectInfo {
  id: number;
  name: string;
  /** customer: in or on the way to the player's shop; shopper: bound for or back from a rival; staff; walker: passing by. */
  kind: 'customer' | 'shopper' | 'staff' | 'walker';
  type?: CustomerType;
  typeName?: string;
  mood: Mood;
  /** What they are doing, in a few words. */
  doing: string;
  list?: { name: string; state: 'found' | 'missed' | 'todo' }[];
  basket?: number;
  budget?: number;
  /** 0..1, for those waiting on something. */
  patience?: number;
  /** "Came here because…" / "Shopped at Cheapo because…", and the two reasons. */
  whyLabel?: string;
  why?: string[];
  staff?: { role: StaffRole; roleName: string; skill: number; morale: number; wage: number };
  /** Teenagers hanging about outside your shop: the group, so you can ask them to move along. */
  moveAlong?: number;
}

const FIRST = ['Ada', 'Ben', 'Cleo', 'Dev', 'Elsie', 'Femi', 'Gus', 'Hana', 'Ivo', 'Jo', 'Kit', 'Lena', 'Milo', 'Nia', 'Omar', 'Pip', 'Quinn', 'Rosa', 'Sam', 'Tess', 'Uma', 'Vic', 'Wren', 'Yara', 'Zak', 'Ines', 'Theo', 'Maud', 'Ravi', 'Lou'];
const LAST = ['Archer', 'Baker', 'Cole', 'Dunn', 'Ellis', 'Fox', 'Grant', 'Hale', 'Iqbal', 'Jones', 'Khan', 'Lowe', 'Moss', 'Nash', 'Okafor', 'Park', 'Reid', 'Shaw', 'Tran', 'Vance', 'Webb', 'Young'];

/** A name for anyone, the same every time (from their id; no random draws). */
export function personName(p: Person): string {
  if (p.name) return p.name;
  const h = (p.id * 2654435761) >>> 0;
  return `${FIRST[h % FIRST.length]} ${LAST[(h >>> 8) % LAST.length]}`;
}

/** How they feel: annoyed when kept waiting or let down, happy when it is going well. */
export function moodOf(p: Person): Mood {
  if (p.kind === 'staff') return (p.morale ?? 1) < 0.4 ? 'annoyed' : (p.morale ?? 1) > 0.75 ? 'happy' : 'ok';
  const left = p.maxPatience && p.patience !== undefined ? p.patience / p.maxPatience : 1;
  const missed = p.missed ?? 0;
  if (left < 0.3 || missed >= 2) return 'annoyed';
  if (left > 0.6 && missed === 0) return 'happy';
  return 'ok';
}

function doing(state: GameState, p: Person): string {
  // Town life first: what makes them more than a passer-by.
  if (p.life === 'driver') return 'Arguing about a bump';
  if (p.life === 'teen' && p.hangout !== undefined) {
    const h = state.life?.hangouts.find((x) => x.id === p.hangout);
    if (h && p.state === 'idle') return `Hanging about ${h.where}${p.smoking ? ', smoking' : ''}`;
    return 'Off to meet friends';
  }
  if (p.dogStop !== undefined) return 'Waiting for the dog';
  switch (p.state) {
    case 'driving': return 'Driving';
    case 'toDoor': case 'entering': return 'Heading in';
    case 'shopping': case 'browsing': return 'Shopping';
    case 'toQueue': case 'queued': return 'Waiting to pay';
    case 'paying': return 'Paying';
    case 'leaving': return p.paid || p.bags ? 'Heading home with the shopping' : 'Leaving';
    case 'toCar': return p.riding ? 'Cycling home' : p.carId !== null && p.carId !== undefined ? 'Walking to the car' : 'Walking home';
    case 'toRack': return 'Cycling over to the bike rack';
    case 'resting': return p.rest?.kind === 'desk' ? 'Asking at the help desk' : p.rest?.kind === 'cafe' ? 'Having a coffee' : 'Having a sit down';
    case 'toBike': return 'Back to the bike';
    case 'loading': return 'Loading the boot';
    case 'fleeing': return p.busted ? 'Caught shoplifting' : 'Making a run for it with the goods';
    case 'chasing': return 'Chasing a shoplifter';
    case 'inRival': return 'Inside';
    case 'walking': return p.riding ? 'Cycling over to the shop' : p.rivalId ? `On the way to ${state.rivals.find((r) => r.id === p.rivalId)?.name ?? 'the shops'}` : p.look.dog ? 'Walking the dog' : 'Out for a walk';
    default: return p.kind === 'staff' ? 'At work' : 'Standing about';
  }
}

export function inspectPerson(state: GameState, id: number): InspectInfo | null {
  const p = state.people.find((x) => x.id === id);
  if (!p || p.kind === 'owner') return null;
  const base = { id: p.id, name: personName(p), mood: moodOf(p), doing: doing(state, p) };
  if (p.kind === 'staff') {
    return { ...base, kind: 'staff', staff: { role: p.role!, roleName: ROLE_NAMES[p.role!], skill: Math.round((p.skill ?? 0.5) * 100) / 100, morale: Math.round((p.morale ?? 1) * 100) / 100, wage: p.wage ?? 0 } };
  }
  const type = p.ctype;
  const typeName = type ? TYPE_NAMES[type] : undefined;
  const drove = p.carId !== null && p.carId !== undefined;
  if (p.kind === 'customer') {
    const list = p.list ?? [];
    const idx = p.listIdx ?? 0;
    const got = new Set((p.basket ?? []).map((b) => b.productId));
    const item = list.find((it) => got.has(it.productId))?.productId ?? list[0]?.productId;
    return {
      ...base, kind: 'customer', type, typeName,
      list: list.map((it, i) => ({ name: productDef(it.productId).name, state: i >= idx ? 'todo' : got.has(it.productId) ? 'found' : 'missed' })),
      basket: Math.round((p.basket ?? []).reduce((a, b) => a + b.price * b.qty, 0) * 100) / 100,
      budget: Math.round((p.budget ?? 0) * 100) / 100,
      // To the percent, so the panel only redraws when the bar would move.
      patience: p.maxPatience && p.patience !== undefined ? Math.round(Math.max(0, Math.min(1, p.patience / p.maxPatience)) * 100) / 100 : undefined,
      whyLabel: 'Came here because…',
      why: (p.why ?? []).map((k) => reasonText(k, type ?? 'convenience', { item: k === 'price' && item ? productDef(item).name : undefined, drove })),
    };
  }
  if (p.rivalId) {
    const r = state.rivals.find((x) => x.id === p.rivalId);
    const name = r ? (r.boughtDay !== undefined ? state.franchises.find((f) => f.corner === r.corner)?.name ?? state.shop.name : r.name) : 'another store';
    return {
      ...base, kind: 'shopper', type, typeName,
      whyLabel: p.bags ? `Shopped at ${name} because…` : `Going to ${name} because…`,
      why: (p.why ?? []).map((k) => reasonText(k, type ?? 'convenience', { drove, rival: r?.boughtDay === undefined })),
    };
  }
  if (p.life === 'teen') {
    const h = state.life?.hangouts.find((x) => x.id === p.hangout);
    return { ...base, kind: 'walker', mood: 'ok', moveAlong: h && h.mine && p.state === 'idle' ? h.id : undefined };
  }
  return { ...base, kind: 'walker', mood: p.life === 'driver' ? 'annoyed' : base.mood };
}

/**
 * "Who shops where": today's shoppers so far, by type, at your shop and at each open rival. Yours are
 * counted as they set out; the rivals' are their day's trade scaled by how much of the day has gone.
 */
export function whoShopsWhere(state: GameState): { stores: { id: string; name: string; mine: boolean }[]; rows: { type: CustomerType; name: string; counts: number[] }[] } {
  const by = rivalShoppersByType(state);
  const open = state.rivals.filter((r) => r.open && by[r.id]);
  const frac = state.phase === 'night' ? 1 : Math.max(0, Math.min(1, state.time / DAY_SECONDS));
  const stores = [{ id: 'player', name: 'You', mine: true }, ...open.map((r) => ({ id: r.id, name: r.boughtDay !== undefined ? state.franchises.find((f) => f.corner === r.corner)?.name ?? r.name : r.name, mine: r.boughtDay !== undefined }))];
  const rows = (Object.keys(TYPE_NAMES) as CustomerType[]).map((t) => ({
    type: t, name: TYPE_NAMES[t],
    counts: [state.today.byType?.[t] ?? 0, ...open.map((r) => Math.round(by[r.id]![t] * frac))],
  }));
  return { stores, rows };
}
