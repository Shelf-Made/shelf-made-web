/**
 * The one command layer: every player, rival and manager action is a Command applied here.
 * Commands are plain data, so they can be recorded for replays and driven by tests.
 */
import type { GameState, Rot, FixtureType } from './types';
import { placeOrder, openTomorrow } from './economy';
import { scanItem, pickCarryTask, completeTutorial } from './people';
import { makeShop, makeOwner } from './newGame';
import { PLOTS, FIXTURES } from './layout';
import { productDef } from './products';
import { cue, popup, withRng } from './state';
import { fixtureCentre } from './grid';
import { takeLoan, repayLoan } from './money';
import { hire, fire, giveRaise } from './staff';
import { canPlace, expandShop, expandLot, moveFixture } from './build';
import { startFlyers, toggleBillboard, setPromotion, setAd } from './marketing';
import { openFranchise, closeFranchise, replaceManager } from './franchise';
import type { Promotion, AdTemplate } from './types';

export type Command =
  | { type: 'choosePlot'; plotId: string; name: string }
  | { type: 'scan'; registerId?: number }
  | { type: 'carry'; fixtureId: number }
  | { type: 'setPrice'; productId: string; price: number }
  | { type: 'placeOrder'; supplierId: string; lines: { productId: string; qty: number }[] }
  | { type: 'openTomorrow' }
  | { type: 'skipTutorial' }
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
  | { type: 'openFranchise'; plotId: string; managerId: number }
  | { type: 'closeFranchise'; franchiseId: number }
  | { type: 'replaceManager'; franchiseId: number; managerId: number }
  | { type: 'takeLoan'; offerId: string }
  | { type: 'repayLoan'; loanId: number; amount: number }
  | { type: 'hire'; candidateId: number }
  | { type: 'fire'; staffId: number }
  | { type: 'raise'; staffId: number }
  | { type: 'setRules'; rules: Partial<GameState['rules']> }
  | { type: 'ackBadge'; card: string }
  | { type: 'clean'; litterId: number }
  | { type: 'cheat'; cash: number };

export interface CommandResult { ok: boolean; message?: string }

export function applyCommand(state: GameState, cmd: Command): CommandResult {
  switch (cmd.type) {
    case 'choosePlot': {
      if (state.phase !== 'picking') return { ok: false, message: 'Already open.' };
      const plot = PLOTS.find((p) => p.id === cmd.plotId);
      if (!plot) return { ok: false, message: 'No such plot.' };
      const name = cmd.name.trim().slice(0, 18) || 'Shelf Made';
      state.shop = makeShop(plot.id, name);
      state.people = state.people.filter((p) => p.kind !== 'owner');
      state.people.push(withRng(state, 'looks', (r) => makeOwner(state.nextId++, state.shop, r)));
      state.phase = 'open';
      state.time = 0;
      cue(state, 'open');
      return { ok: true };
    }
    case 'scan': {
      const reg = cmd.registerId !== undefined ? state.shop.fixtures.find((f) => f.id === cmd.registerId) : state.shop.fixtures.find((f) => f.type === 'register' && f.serving);
      if (!reg) return { ok: false, message: 'Nobody at the register.' };
      return scanItem(state, reg) ? { ok: true } : { ok: false, message: 'Nobody at the register.' };
    }
    case 'carry': {
      const f = state.shop.fixtures.find((x) => x.id === cmd.fixtureId);
      if (!f) return { ok: false, message: 'No such fixture.' };
      const owner = state.people.find((p) => p.kind === 'owner');
      if (!owner) return { ok: false, message: 'Nobody to carry.' };
      if (owner.task) return { ok: false, message: 'Already carrying something.' };
      const task = pickCarryTask(state, f);
      if (!task) {
        const full = f.slots.every((s) => s.productId && s.qty >= FIXTURES[f.type].capacity);
        return { ok: false, message: full ? 'That one is full.' : 'Nothing in the storeroom for it. Order stock first.' };
      }
      owner.task = { type: 'carry', fixtureId: f.id, productId: task.productId, qty: task.qty };
      if (owner.state === 'idle' || owner.state === 'toRegister') owner.state = 'idle';
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
    case 'placeFixture': {
      const def = FIXTURES[cmd.fixtureType];
      const check = canPlace(state, cmd.fixtureType, cmd.x, cmd.z, cmd.rot);
      if (!check.ok) return { ok: false, message: check.reason };
      state.cash -= def.price;
      const fx = { id: state.nextId++, type: cmd.fixtureType, x: cmd.x, z: cmd.z, rot: cmd.rot, slots: Array.from({ length: def.slots }, () => ({ productId: null, qty: 0 })) } as GameState['shop']['fixtures'][number];
      if (fx.type === 'register' || fx.type === 'kiosk') { fx.queue = []; fx.serving = null; fx.scanned = 0; fx.staffId = null; }
      state.shop.fixtures.push(fx);
      state.shop.layoutVersion++;
      popup(state, fixtureCentre(state.shop, fx), `-$${def.price}`, 'bad', 1.2);
      cue(state, 'build');
      return { ok: true };
    }
    case 'removeFixture': {
      const i = state.shop.fixtures.findIndex((f) => f.id === cmd.fixtureId);
      if (i < 0) return { ok: false, message: 'No such fixture.' };
      const f = state.shop.fixtures[i]!;
      if (f.type === 'register' && state.shop.fixtures.filter((x) => x.type === 'register').length === 1) return { ok: false, message: 'You need one register.' };
      if ((f.type === 'register' || f.type === 'kiosk') && (f.serving || (f.queue?.length ?? 0) > 0)) return { ok: false, message: 'Wait until the line is served.' };
      const refund = Math.round(FIXTURES[f.type].price * 0.6);
      for (const s of f.slots) if (s.productId && s.qty > 0) state.shop.storage.push({ productId: s.productId, qty: s.qty, day: state.day });
      state.shop.fixtures.splice(i, 1);
      state.shop.layoutVersion++;
      state.cash += refund;
      return { ok: true };
    }
    case 'moveFixture': { const err = moveFixture(state, cmd.fixtureId, cmd.x, cmd.z, cmd.rot); return err ? { ok: false, message: err } : { ok: true }; }
    case 'expandShop': { const err = expandShop(state, cmd.sizeId); if (!err) cue(state, 'build'); return err ? { ok: false, message: err } : { ok: true }; }
    case 'expandLot': { const err = expandLot(state); if (!err) cue(state, 'build'); return err ? { ok: false, message: err } : { ok: true }; }
    case 'flyers': { const err = startFlyers(state, cmd.areaId); return err ? { ok: false, message: err } : { ok: true }; }
    case 'billboard': { const err = toggleBillboard(state, cmd.siteId); return err ? { ok: false, message: err } : { ok: true }; }
    case 'promotion': { const err = setPromotion(state, cmd.promo); return err ? { ok: false, message: err } : { ok: true }; }
    case 'ad': { const err = setAd(state, cmd.ad); return err ? { ok: false, message: err } : { ok: true }; }
    case 'outsideSign': { if (cmd.on && !state.marketing.outsideSign) { if (state.cash < 150) return { ok: false, message: 'Need $150.' }; state.cash -= 150; } state.marketing.outsideSign = cmd.on; state.shop.layoutVersion++; return { ok: true }; }
    case 'openFranchise': { const err = openFranchise(state, cmd.plotId, cmd.managerId); if (!err) cue(state, 'reward'); return err ? { ok: false, message: err } : { ok: true }; }
    case 'closeFranchise': { const err = closeFranchise(state, cmd.franchiseId); return err ? { ok: false, message: err } : { ok: true }; }
    case 'replaceManager': { const err = replaceManager(state, cmd.franchiseId, cmd.managerId); return err ? { ok: false, message: err } : { ok: true }; }
    case 'takeLoan': { const err = takeLoan(state, cmd.offerId); return err ? { ok: false, message: err } : { ok: true }; }
    case 'repayLoan': { const err = repayLoan(state, cmd.loanId, cmd.amount); return err ? { ok: false, message: err } : { ok: true }; }
    case 'hire': { const err = hire(state, cmd.candidateId); return err ? { ok: false, message: err } : { ok: true }; }
    case 'fire': { const err = fire(state, cmd.staffId); return err ? { ok: false, message: err } : { ok: true }; }
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
    case 'cheat': {
      if (!state.sandbox && !(globalThis as { __shelfTest?: boolean }).__shelfTest) return { ok: false };
      state.cash += cmd.cash;
      return { ok: true };
    }
  }
}
