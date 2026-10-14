/**
 * Shop colour schemes: what colour a store is, everywhere it shows (awning, fascia, pylon, inside
 * walls, staff, bags). Plain data, so the sim can say which store a customer's bags come from and
 * the asset pipeline can bake every colour into the palette.
 */
import type { GameState, Person, RivalState } from './types';

export interface Scheme {
  id: string;
  name: string;
  /** The store's colour: awning stripes, fascia trim, the walls inside, bags. */
  primary: string;
  /** A shade darker: the plinth, staff aprons in shadow, the awning's valance. */
  dark: string;
  /** A pale tint: the upper band of the walls inside. */
  light: string;
  /** The awning's other stripe. */
  accent: string;
  /** Sign lettering sides and small highlights. */
  trim: string;
}

/** The player's choice, picked when naming the shop. Rivals' colours (yellow, deep green, blue) are left out on purpose. */
export const SHOP_SCHEMES: Scheme[] = [
  { id: 'green', name: 'Fresh green', primary: '#3FA87A', dark: '#2E8560', light: '#D8F0E3', accent: '#FFFFFF', trim: '#FFC044' },
  { id: 'berry', name: 'Berry', primary: '#C2417A', dark: '#962E5C', light: '#F6D9E6', accent: '#FFF3DC', trim: '#FFC044' },
  { id: 'tangerine', name: 'Tangerine', primary: '#F2702E', dark: '#C9541C', light: '#FFE0CC', accent: '#FFFFFF', trim: '#38383D' },
  { id: 'plum', name: 'Plum', primary: '#7E57C2', dark: '#5E3F99', light: '#E6DDF5', accent: '#FFFFFF', trim: '#FFC044' },
  { id: 'teal', name: 'Teal', primary: '#22A699', dark: '#18807A', light: '#D0F0EC', accent: '#FFFFFF', trim: '#FF8C42' },
  { id: 'cocoa', name: 'Cocoa', primary: '#8B5A3C', dark: '#6E4630', light: '#F1E2D3', accent: '#FFF3DC', trim: '#D9A066' },
];
export const DEFAULT_SCHEME = 'green';

/** Each rival's fixed colours: Cheapo yellow and red, Fresh & Fine deep green and cream, MegaMart blue and white. */
export const RIVAL_SCHEMES: Record<RivalState['kind'], Scheme> = {
  discount: { id: 'discount', name: 'Cheapo', primary: '#FFC044', dark: '#D99A2B', light: '#FFF0C8', accent: '#E8573F', trim: '#FFFFFF' },
  premium: { id: 'premium', name: 'Fresh & Fine', primary: '#2E6B4F', dark: '#22513B', light: '#DCEBE2', accent: '#FFF3DC', trim: '#D9A066' },
  chain: { id: 'chain', name: 'MegaMart', primary: '#3570BC', dark: '#285795', light: '#DCE7F5', accent: '#FFFFFF', trim: '#FFC044' },
};

/** A challenger that takes over an empty corner: sky blue, clear of every player scheme and the three rivals. */
export const CHALLENGER_SCHEME: Scheme = { id: 'challenger', name: 'Challenger', primary: '#29B6D8', dark: '#1E8FAB', light: '#D4F1F8', accent: '#FFFFFF', trim: '#38383D' };

/** A rival's colours: its own, a challenger's, or the player's once the player owns the corner. */
export function rivalScheme(state: GameState, r: RivalState): Scheme {
  if (r.boughtDay !== undefined) return shopScheme(state);
  return r.challenger ? CHALLENGER_SCHEME : RIVAL_SCHEMES[r.kind];
}

export function schemeById(id: string | undefined): Scheme { return SHOP_SCHEMES.find((s) => s.id === id) ?? SHOP_SCHEMES[0]!; }
export function shopScheme(state: GameState): Scheme { return schemeById(state.shop.scheme); }

/** A store's scheme: 'player' or a rival's id. */
export function storeScheme(state: GameState, store: string): Scheme {
  if (store === 'player') return shopScheme(state);
  const r = state.rivals.find((x) => x.id === store);
  return r ? rivalScheme(state, r) : shopScheme(state);
}

/**
 * The shopping bags a person carries, if any: whose store they came from and how many (one to
 * three by how much they bought). Rival shoppers carry their rival's bags home; our customers carry
 * ours on the way out, to their car or off down the street.
 */
export function shoppingBags(p: Person): { store: string; n: number } | null {
  if (p.rivalId && p.bags) return { store: p.rivalId, n: 1 + (p.id % 3 === 0 ? 2 : p.id % 2) };
  if (p.kind !== 'customer' || !p.paid) return null;
  const items = (p.basket ?? []).reduce((a, b) => a + b.qty, 0);
  if (items <= 0) return null;
  return { store: 'player', n: Math.max(1, Math.min(3, Math.ceil(items / 3))) };
}

/** The colour of a person's bags (null without bags). */
export function bagColour(state: GameState, p: Person): string | null {
  const b = shoppingBags(p);
  return b ? storeScheme(state, b.store).primary : null;
}

/** Every colour any scheme uses, for the palette. */
export function schemeColours(): string[] {
  const out = new Set<string>();
  for (const s of [...SHOP_SCHEMES, ...Object.values(RIVAL_SCHEMES), CHALLENGER_SCHEME]) for (const c of [s.primary, s.dark, s.light, s.accent, s.trim]) out.add(c.toUpperCase());
  return [...out];
}
