/**
 * The one command layer: every player, rival and manager action is a Command applied here.
 * Commands are plain data, so they can be recorded for replays and driven by tests.
 */
import { pickUpLitter, moveAlong } from './life';
import { replyToReview } from './reviews';
import type { GameState, Rot, FixtureType, FloorStyle, WallStyle, LotSurface, SavedOrder } from './types';
import { saveOrder, editSavedOrder, deleteSavedOrder, placeSaved } from './savedOrders';
import { placeOrder, openTomorrow } from './economy';
import { scanItem, pickCarryTask, completeTutorial, ownerAt, ownerWalkTo, ownerPickUp, ownerPutBack, ownerStock, getsTo } from './people';
import { fixtureBackWorld } from './grid';
import { makeShop, makeOwner } from './newGame';
import { PLOTS, FIXTURES, PALLET_UNITS, RACK_STANDS, storageCap, VERTICAL, storeysOf } from './layout';
import { productDef } from './products';
import { cue, popup, withRng } from './state';
import { fixtureCentre } from './grid';
import { takeLoan, repayLoan } from './money';
import { hire, fire, giveRaise, setShift } from './staff';
import { canPlace, expandShop, expandLot, moveFixture, setFloor, paintFloor, buyTile, sellTile, paintWall, removalShuts } from './build';
import { addPanel, removePanel, canTakeAway, ceilFloorsOpened, rideOn, startRide, repathAfterBuild, keepFinishes } from './storeys';
import { pave, paintBay, eraseBay } from './lot';
import { startFlyers, toggleBillboard, setPromotion, setAd, bookOpeningEvent } from './marketing';
import { openFranchise, closeFranchise, replaceManager } from './franchise';
import { schemeById } from './schemes';
import { seatRivals, buyCorner } from './rivals';
import type { Promotion, AdTemplate } from './types';
import { dollars } from './money';

export type Command =
  | { type: 'choosePlot'; plotId: string; name: string; scheme?: string }
  | { type: 'setScheme'; scheme: string }
  | { type: 'scan'; registerId?: number }
  | { type: 'moveDir'; x: number; z: number }
  | { type: 'walkTo'; x: number; z: number }
  | { type: 'openShop' }
  | { type: 'pickUp'; productId?: string }
  | { type: 'putBack' }
  | { type: 'stockFixture'; fixtureId: number }
  | { type: 'setTimeScale'; scale: number }
  /** In person: scan only if you are already at the till (no walking for you). */
  | { type: 'scanHere'; registerId: number }
  | { type: 'carry'; fixtureId: number }
  | { type: 'setPrice'; productId: string; price: number }
  | { type: 'placeOrder'; supplierId: string; lines: { productId: string; qty: number }[] }
  | { type: 'openTomorrow' }
  | { type: 'skipTutorial' }
  /** Design the manager: character, height and colours (null puts a colour back to the character's own). */
  | { type: 'designManager'; look: { model?: number; height?: number; skin?: string | null; hair?: string | null; top?: string | null; bottom?: string | null } }
  | { type: 'placeFixture'; fixtureType: FixtureType; x: number; z: number; rot: Rot }
  | { type: 'removeFixture'; fixtureId: number }
  | { type: 'moveFixture'; fixtureId: number; x: number; z: number; rot: Rot }
  | { type: 'expandShop'; sizeId: string }
  | { type: 'expandLot' }
  | { type: 'flyers'; areaId: string }
  | { type: 'billboard'; siteId: string }
  | { type: 'promotion'; promo: Promotion | null }
  | { type: 'ad'; ad: AdTemplate | null }
  | { type: 'outsideSign'; on: boolean }
  | { type: 'openFranchise'; siteId: string; managerId: number }
  | { type: 'closeFranchise'; franchiseId: number }
  | { type: 'replaceManager'; franchiseId: number; managerId: number }
  | { type: 'buyCorner'; rivalId: string; managerId: number }
  | { type: 'openingEvent' }
  | { type: 'signStyle'; style: 'classic' | 'lit' }
  | { type: 'setFloor'; style: FloorStyle }
  /** One tile: lay a finish on it, or buy it to grow the shop. */
  | { type: 'paintFloor'; x: number; z: number; style: FloorStyle }
  | { type: 'buyTile'; x: number; z: number }
  | { type: 'sellTile'; x: number; z: number }
  /** A ceiling panel over a tile of floor (z on that floor's region), or taken down and sold. */
  | { type: 'addPanel'; x: number; z: number }
  /** The manager rides the stairs, an escalator or a lift they stand at the foot (or the top) of. */
  | { type: 'ride'; fixtureId: number }
  | { type: 'removePanel'; x: number; z: number }
  /** One stretch of outer wall (a key from wallKey) given a finish. */
  | { type: 'paintWall'; key: string; style: WallStyle }
  /** One tile of the lot laid with a surface (null: back to grass). */
  | { type: 'pave'; x: number; z: number; surface: LotSurface | null }
  /** One parking bay (a slot id from baySlots) painted, or painted out. */
  | { type: 'paintBay'; slot: number }
  | { type: 'eraseBay'; slot: number }
  /** Saved orders: keep this order to place again, set when the manager places it, place it now, delete it. */
  | { type: 'saveOrder'; name: string; supplierId: string; lines: { productId: string; qty: number }[] }
  | { type: 'editSavedOrder'; id: number; patch: Partial<Pick<SavedOrder, 'name' | 'when' | 'minCash' | 'supplierId'>> }
  | { type: 'placeSavedOrder'; id: number }
  | { type: 'deleteSavedOrder'; id: number }
  | { type: 'ackChampion' }
  | { type: 'takeLoan'; offerId: string }
  | { type: 'repayLoan'; loanId: number; amount: number }
  | { type: 'hire'; candidateId: number }
  | { type: 'fire'; staffId: number }
  | { type: 'raise'; staffId: number }
  | { type: 'setShift'; staffId: number; shift: 'full' | 'morning' | 'evening' }
  | { type: 'setRules'; rules: Partial<GameState['rules']> }
  | { type: 'ackBadge'; card: string }
  | { type: 'clean'; litterId: number }
  | { type: 'cleanTown'; litterId: number }
  | { type: 'moveAlong'; hangoutId: number }
  | { type: 'replyReview'; reviewId: number; text: string }
  | { type: 'cheat'; cash: number };

export interface CommandResult { ok: boolean; message?: string }

/** The sound a command makes when it works and has not already made its own. */
const COMMAND_CUES: Partial<Record<Command['type'], string>> = {
  removeFixture: 'sell', moveFixture: 'place', setPrice: 'tick', flyers: 'paper', billboard: 'build', promotion: 'order', ad: 'order',
  outsideSign: 'build', signStyle: 'build', closeFranchise: 'thud', replaceManager: 'hire', takeLoan: 'coin', repayLoan: 'coin', hire: 'hire', fire: 'thud',
  setShift: 'tick', raise: 'coin', setRules: 'tick', openTomorrow: 'open', choosePlot: 'reward', setScheme: 'tick',
};

/** Characters the manager can be: the twelve townsfolk, six women (even) and six men (odd). */
export const MANAGER_MODELS = 12;
/** Who you are until you design your own: the first of the women. */
export const MANAGER_DEFAULT_MODEL = 0;

/**
 * Commands that change the building: after each, new floor comes bare and floor out of use keeps its finish
 * (keepFinishes), and anyone whose way it took away goes another (repathAfterBuild).
 */
const REBUILDS = new Set<Command['type']>(['placeFixture', 'removeFixture', 'moveFixture', 'expandShop', 'buyTile', 'sellTile', 'addPanel', 'removePanel']);

export function applyCommand(state: GameState, cmd: Command): CommandResult {
  const before = state.sounds.length, was = REBUILDS.has(cmd.type) ? storeysOf(state.shop) : null;
  const res = apply(state, cmd);
  const c = COMMAND_CUES[cmd.type];
  if (res.ok && c && state.sounds.length === before) cue(state, c);
  if (res.ok && was) { keepFinishes(state.shop, was); repathAfterBuild(state); }
  return res;
}

function apply(state: GameState, cmd: Command): CommandResult {
  switch (cmd.type) {
    case 'setScheme': {
      // Before the doors first open: the picker previews it, and you can still change your mind while setting up.
      if (state.phase !== 'picking' && state.phase !== 'setup') return { ok: false, message: 'The paint is dry: colours are chosen before opening.' };
      state.shop.scheme = schemeById(cmd.scheme).id;
      return { ok: true };
    }
    case 'choosePlot': {
      if (state.phase !== 'picking') return { ok: false, message: 'Already open.' };
      const plot = PLOTS.find((p) => p.id === cmd.plotId);
      if (!plot) return { ok: false, message: 'No such plot.' };
      const name = cmd.name.trim().slice(0, 18) || 'Shelf Made';
      state.shop = makeShop(plot.id, name, cmd.scheme);
      seatRivals(state);
      state.cars = state.cars.filter((c) => c.state === 'passing');
      state.people = state.people.filter((p) => p.kind === 'walker' && !p.rivalId);
      state.people.push(withRng(state, 'looks', (r) => makeOwner(state.nextId++, state.shop, r)));
      state.phase = 'setup';
      state.time = 0;
      return { ok: true };
    }
    case 'openShop': {
      if (state.phase !== 'setup') return { ok: false, message: 'Already open.' };
      if (!state.shop.fixtures.some((f) => f.type === 'register' || f.type === 'kiosk')) return { ok: false, message: 'Place a checkout counter first: shoppers need somewhere to pay.' };
      if (!state.shop.fixtures.some((f) => f.slots.some((sl) => sl.productId && sl.qty > 0))) return { ok: false, message: 'Stock a shelf first: there is nothing to buy yet.' };
      state.phase = 'open';
      state.time = 0;
      cue(state, 'open');
      completeTutorial(state, 'open');
      return { ok: true };
    }
    case 'pickUp': { const err = ownerPickUp(state, cmd.productId); return err ? { ok: false, message: err } : { ok: true }; }
    case 'putBack': { const err = ownerPutBack(state); return err ? { ok: false, message: err } : { ok: true }; }
    case 'stockFixture': { const err = ownerStock(state, cmd.fixtureId); return err ? { ok: false, message: err } : { ok: true }; }
    case 'setTimeScale': { state.timeScale = [1, 2, 4].includes(cmd.scale) ? cmd.scale : 1; return { ok: true }; }
    case 'scanHere': {
      const reg = state.shop.fixtures.find((f) => f.id === cmd.registerId && f.type === 'register');
      if (!reg) return { ok: false };
      if (!ownerAt(state, reg)) return { ok: false, message: 'Step behind the counter to scan.' };
      return scanItem(state, reg) ? { ok: true } : { ok: false, message: 'Nobody waiting to pay.' };
    }
    case 'moveDir': {
      const o = state.people.find((p) => p.kind === 'owner');
      if (!o) return { ok: false };
      const l = Math.hypot(cmd.x, cmd.z);
      o.moveDir = l > 0.01 ? { x: cmd.x / l, z: cmd.z / l } : null;
      // Let go: stop (on a ride, at its end: the keys took over from any walk clicked for beyond it).
      if (!o.moveDir && o.state !== 'carrying' && o.state !== 'pickBox' && o.state !== 'stocking' && o.state !== 'toStock') { o.state = 'idle'; o.anim = o.carrying ? 'carry' : 'idle'; o.path = o.path.slice(0, o.pathIdx + (o.climb !== undefined ? 1 : 0)); }
      return { ok: true };
    }
    case 'walkTo': {
      return ownerWalkTo(state, { x: cmd.x, z: cmd.z }) ? { ok: true } : { ok: false, message: "You can't get there." };
    }
    case 'scan': {
      const tills = state.shop.fixtures.filter((f) => f.type === 'register');
      const reg = cmd.registerId !== undefined ? tills.find((f) => f.id === cmd.registerId) : (tills.find((f) => f.serving && ownerAt(state, f)) ?? tills.find((f) => f.serving) ?? tills[0]);
      if (!reg) return { ok: false, message: 'Build a checkout counter first.' };
      // You scan in person: walk round behind the counter first.
      if (!ownerAt(state, reg)) {
        ownerWalkTo(state, fixtureBackWorld(state.shop, reg));
        return { ok: false, message: 'Walking to the counter.' };
      }
      return scanItem(state, reg) ? { ok: true } : { ok: false, message: 'Nobody waiting to pay.' };
    }
    case 'carry': {
      const f = state.shop.fixtures.find((x) => x.id === cmd.fixtureId);
      if (!f) return { ok: false, message: 'No such fixture.' };
      const owner = state.people.find((p) => p.kind === 'owner');
      if (!owner) return { ok: false, message: 'Nobody to carry.' };
      if (owner.task && owner.state !== 'idle' && owner.state !== 'walking') return { ok: false, message: 'Already carrying something.' };
      // A shelf an older save left cut off: nobody walks there (the manager is left as they were).
      if (!getsTo(state, f)) return { ok: false, message: "You can't get there." };
      if (owner.carrying) {
        owner.task = { type: 'carry', fixtureId: f.id, productId: owner.carrying.productId, qty: owner.carrying.qty };
        owner.moveDir = null; owner.state = 'idle';
        return { ok: true };
      }
      const task = pickCarryTask(state, f);
      if (!task) {
        const full = f.slots.every((s) => s.productId && s.qty >= FIXTURES[f.type].capacity);
        return { ok: false, message: full ? 'That one is full.' : 'No boxes for it on the pallet. Order stock first.' };
      }
      owner.task = { type: 'carry', fixtureId: f.id, productId: task.productId, qty: task.qty };
      owner.moveDir = null;
      if (owner.state === 'idle' || owner.state === 'toRegister' || owner.state === 'walking') owner.state = 'idle';
      cue(state, 'click');
      return { ok: true };
    }
    case 'setPrice': {
      const def = productDef(cmd.productId);
      const price = Math.max(0.1, Math.min(def.basePrice * 3, Math.round(cmd.price * 20) / 20));
      state.prices[cmd.productId] = price;
      completeTutorial(state, 'price');
      return { ok: true };
    }
    case 'placeOrder': {
      const res = placeOrder(state, cmd.supplierId, cmd.lines);
      if (typeof res === 'string') return { ok: false, message: res };
      completeTutorial(state, 'order');
      return { ok: true };
    }
    case 'openTomorrow': {
      if (state.phase !== 'night') return { ok: false, message: 'Not night yet.' };
      openTomorrow(state);
      completeTutorial(state, 'openTomorrow');
      return { ok: true };
    }
    case 'skipTutorial': {
      state.tutorial.enabled = false; state.tutorial.done = true;
      return { ok: true };
    }
    case 'designManager': {
      const o = state.people.find((p) => p.kind === 'owner');
      if (!o) return { ok: false, message: 'No manager.' };
      const l = cmd.look, look = { ...o.look };
      if (l.model !== undefined) { if (!Number.isInteger(l.model) || l.model < 0 || l.model > MANAGER_MODELS - 1) return { ok: false, message: 'No such character.' }; look.model = l.model; }
      if (l.height !== undefined) look.height = Math.max(0.92, Math.min(1.12, l.height));
      for (const k of ['skin', 'hair', 'top', 'bottom'] as const) {
        const v = l[k];
        if (v === undefined) continue;
        if (v === null) delete look[k];
        else if (/^#[0-9a-f]{6}$/i.test(v)) look[k] = v.toUpperCase();
        else return { ok: false, message: 'Not a colour.' };
      }
      o.look = look;
      return { ok: true };
    }
    case 'placeFixture': {
      const def = FIXTURES[cmd.fixtureType];
      const check = canPlace(state, cmd.fixtureType, cmd.x, cmd.z, cmd.rot);
      if (!check.ok) return { ok: false, message: check.reason };
      // The price, and a ceiling over a floor it opens.
      state.cash -= check.price;
      const fx = { id: state.nextId++, type: cmd.fixtureType, x: cmd.x, z: cmd.z, rot: cmd.rot, slots: Array.from({ length: def.slots }, () => ({ productId: null, qty: 0 })) } as GameState['shop']['fixtures'][number];
      if (fx.type === 'register' || fx.type === 'kiosk') { fx.queue = []; fx.serving = null; fx.scanned = 0; fx.staffId = null; }
      if (fx.type === 'bikeRack') fx.bikes = Array.from({ length: RACK_STANDS }, () => null);
      const opened = VERTICAL.has(fx.type) ? [...storeysOf(state.shop).built] : null;
      state.shop.fixtures.push(fx);
      state.shop.layoutVersion++;
      if (opened) ceilFloorsOpened(state.shop, opened);
      popup(state, fixtureCentre(state.shop, fx), dollars(-check.price), 'bad', 1.2);
      cue(state, 'place');
      if (fx.type === 'register' || fx.type === 'kiosk') completeTutorial(state, 'counter');
      if (FIXTURES[fx.type].slots > 0) completeTutorial(state, 'shelf');
      return { ok: true };
    }
    case 'removeFixture': {
      const i = state.shop.fixtures.findIndex((f) => f.id === cmd.fixtureId);
      if (i < 0) return { ok: false, message: 'No such fixture.' };
      const f = state.shop.fixtures[i]!;
      if (f.type === 'register' && state.shop.fixtures.filter((x) => x.type === 'register').length === 1) return { ok: false, message: 'You need one register.' };
      if ((f.type === 'register' || f.type === 'kiosk') && (f.serving || (f.queue?.length ?? 0) > 0)) return { ok: false, message: 'Wait until the line is served.' };
      if (f.bikes?.some((b) => b !== null)) return { ok: false, message: 'Bikes are locked to it: wait till they ride off.' };
      { const why = canTakeAway(state, f.id) ?? removalShuts(state, f.id); if (why) return { ok: false, message: `${why}.` }; }
      if (f.type === 'pallet') { const units = state.shop.storage.reduce((a, e) => a + e.qty, 0); if (units > storageCap(state.shop) - PALLET_UNITS) return { ok: false, message: 'Shelve some boxes first: they would have nowhere to go.' }; }
      const refund = Math.round(FIXTURES[f.type].price * 0.6);
      for (const s of f.slots) if (s.productId && s.qty > 0) state.shop.storage.push({ productId: s.productId, qty: s.qty, day: state.day });
      state.shop.fixtures.splice(i, 1);
      state.shop.layoutVersion++;
      state.cash += refund;
      return { ok: true };
    }
    case 'moveFixture': {
      const cash = state.cash, err = moveFixture(state, cmd.fixtureId, cmd.x, cmd.z, cmd.rot);
      if (err) return { ok: false, message: err };
      // Put down as a new one is (a ceiling over a floor it opens is paid for).
      const f = state.shop.fixtures.find((x) => x.id === cmd.fixtureId)!;
      if (state.cash < cash) popup(state, fixtureCentre(state.shop, f), dollars(state.cash - cash), 'bad', 1.2);
      cue(state, 'place');
      return { ok: true };
    }
    case 'expandShop': { const err = expandShop(state, cmd.sizeId); if (!err) cue(state, 'build'); return err ? { ok: false, message: err } : { ok: true }; }
    case 'expandLot': { const err = expandLot(state); if (!err) cue(state, 'build'); return err ? { ok: false, message: err } : { ok: true }; }
    case 'flyers': { const err = startFlyers(state, cmd.areaId); return err ? { ok: false, message: err } : { ok: true }; }
    case 'billboard': { const err = toggleBillboard(state, cmd.siteId); return err ? { ok: false, message: err } : { ok: true }; }
    case 'promotion': { const err = setPromotion(state, cmd.promo); return err ? { ok: false, message: err } : { ok: true }; }
    case 'ad': { const err = setAd(state, cmd.ad); return err ? { ok: false, message: err } : { ok: true }; }
    case 'outsideSign': { if (cmd.on && !state.marketing.outsideSign) { if (state.cash < 150) return { ok: false, message: 'Need $150.' }; state.cash -= 150; } state.marketing.outsideSign = cmd.on; state.shop.layoutVersion++; return { ok: true }; }
    case 'openFranchise': { const err = openFranchise(state, cmd.siteId, cmd.managerId); if (!err) cue(state, 'reward'); return err ? { ok: false, message: err } : { ok: true }; }
    case 'buyCorner': { const err = buyCorner(state, cmd.rivalId, cmd.managerId); return err ? { ok: false, message: err } : { ok: true }; }
    case 'openingEvent': { const err = bookOpeningEvent(state); return err ? { ok: false, message: err } : { ok: true }; }
    case 'setFloor': { const err = setFloor(state, cmd.style); if (!err) cue(state, 'build'); return err ? { ok: false, message: err } : { ok: true }; }
    case 'paintFloor': { const err = paintFloor(state, cmd.x, cmd.z, cmd.style); if (!err) cue(state, 'place'); return err ? { ok: false, message: err } : { ok: true }; }
    case 'buyTile': { const err = buyTile(state, cmd.x, cmd.z); if (!err) cue(state, 'build'); return err ? { ok: false, message: err } : { ok: true }; }
    case 'sellTile': { const err = sellTile(state, cmd.x, cmd.z); if (!err) cue(state, 'coin'); return err ? { ok: false, message: err } : { ok: true }; }
    case 'ride': {
      const o = state.people.find((p) => p.kind === 'owner');
      const w = o && o.climb === undefined ? rideOn(state, o, cmd.fixtureId) : null;
      if (!o || !w) return { ok: false, message: 'Walk up to it first.' };
      startRide(state, o, w); o.rideLock = { x: w.x, z: w.z }; o.moveDir = null;
      return { ok: true };
    }
    case 'addPanel': { const err = addPanel(state, cmd.x, cmd.z); if (!err) cue(state, 'place'); return err ? { ok: false, message: err } : { ok: true }; }
    case 'removePanel': { const err = removePanel(state, cmd.x, cmd.z); if (!err) cue(state, 'coin'); return err ? { ok: false, message: err } : { ok: true }; }
    case 'paintWall': { const err = paintWall(state, cmd.key, cmd.style); if (!err) cue(state, 'place'); return err ? { ok: false, message: err } : { ok: true }; }
    case 'pave': { const err = pave(state, cmd.x, cmd.z, cmd.surface); if (!err) cue(state, cmd.surface ? 'place' : 'coin'); return err ? { ok: false, message: err } : { ok: true }; }
    case 'paintBay': { const err = paintBay(state, cmd.slot); if (!err) cue(state, 'place'); return err ? { ok: false, message: err } : { ok: true }; }
    case 'saveOrder': { const err = saveOrder(state, cmd.name, cmd.supplierId, cmd.lines); return err ? { ok: false, message: err } : { ok: true }; }
    case 'editSavedOrder': { const err = editSavedOrder(state, cmd.id, cmd.patch); return err ? { ok: false, message: err } : { ok: true }; }
    case 'placeSavedOrder': { const err = placeSaved(state, cmd.id); if (!err) cue(state, 'order'); return err ? { ok: false, message: err } : { ok: true }; }
    case 'deleteSavedOrder': { const err = deleteSavedOrder(state, cmd.id); return err ? { ok: false, message: err } : { ok: true }; }
    case 'eraseBay': { const err = eraseBay(state, cmd.slot); if (!err) cue(state, 'coin'); return err ? { ok: false, message: err } : { ok: true }; }
    case 'signStyle': {
      if (cmd.style === 'lit' && !state.goals.unlocked.includes('signLit') && !state.sandbox) return { ok: false, message: 'Reach the Regulars goal to light the sign.' };
      state.shop.signStyle = cmd.style; state.shop.layoutVersion++;
      return { ok: true };
    }
    case 'ackChampion': { state.goals.championSeen = true; return { ok: true }; }
    case 'closeFranchise': { const err = closeFranchise(state, cmd.franchiseId); return err ? { ok: false, message: err } : { ok: true }; }
    case 'replaceManager': { const err = replaceManager(state, cmd.franchiseId, cmd.managerId); return err ? { ok: false, message: err } : { ok: true }; }
    case 'takeLoan': { const err = takeLoan(state, cmd.offerId); return err ? { ok: false, message: err } : { ok: true }; }
    case 'repayLoan': { const err = repayLoan(state, cmd.loanId, cmd.amount); return err ? { ok: false, message: err } : { ok: true }; }
    case 'hire': { const err = hire(state, cmd.candidateId); return err ? { ok: false, message: err } : { ok: true }; }
    case 'fire': { const err = fire(state, cmd.staffId); return err ? { ok: false, message: err } : { ok: true }; }
    case 'setShift': { const err = setShift(state, cmd.staffId, cmd.shift); return err ? { ok: false, message: err } : { ok: true }; }
    case 'raise': { const err = giveRaise(state, cmd.staffId); return err ? { ok: false, message: err } : { ok: true }; }
    case 'setRules': { state.rules = { ...state.rules, ...cmd.rules }; return { ok: true }; }
    case 'ackBadge': { state.unlocks.newBadges = state.unlocks.newBadges.filter((b) => b !== cmd.card); return { ok: true }; }
    case 'clean': {
      const i = state.shop.litter.findIndex((l) => l.id === cmd.litterId);
      if (i < 0) return { ok: false };
      state.shop.litter.splice(i, 1);
      state.shop.cleanliness = Math.min(1, state.shop.cleanliness + 0.08);
      cue(state, 'pick');
      return { ok: true };
    }
    case 'cleanTown': return pickUpLitter(state, cmd.litterId) ? { ok: true } : { ok: false };
    case 'moveAlong': return moveAlong(state, cmd.hangoutId) ? { ok: true } : { ok: false };
    case 'replyReview': return replyToReview(state, cmd.reviewId, cmd.text) ? { ok: true } : { ok: false, message: 'Nothing to reply to.' };
    case 'cheat': {
      if (!state.sandbox && !(globalThis as { __shelfTest?: boolean }).__shelfTest) return { ok: false };
      state.cash += cmd.cash;
      return { ok: true };
    }
  }
}
