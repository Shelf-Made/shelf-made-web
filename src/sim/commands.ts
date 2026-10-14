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
  | { type: 'takeLoan'; offerId: string }
  | { type: 'repayLoan'; loanId: number; amount: number }
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
      if (owner.task) return { ok: false, message: 'Already carrying.' };
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
      if (state.cash < def.price) return { ok: false, message: `Need $${def.price}.` };
      const inFloor = cmd.x >= state.shop.floor.x0 && cmd.x + 1 <= state.shop.floor.x1 && cmd.z >= state.shop.floor.z0 && cmd.z + 1 <= state.shop.floor.z1;
      if (!inFloor) return { ok: false, message: 'Must be inside the shop.' };
      if (state.shop.fixtures.some((f) => f.x === cmd.x && f.z === cmd.z)) return { ok: false, message: 'Something is already there.' };
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
      const refund = Math.round(FIXTURES[f.type].price * 0.6);
      for (const s of f.slots) if (s.productId && s.qty > 0) state.shop.storage.push({ productId: s.productId, qty: s.qty, day: state.day });
      state.shop.fixtures.splice(i, 1);
      state.shop.layoutVersion++;
      state.cash += refund;
      return { ok: true };
    }
    case 'takeLoan': { const err = takeLoan(state, cmd.offerId); return err ? { ok: false, message: err } : { ok: true }; }
    case 'repayLoan': { const err = repayLoan(state, cmd.loanId, cmd.amount); return err ? { ok: false, message: err } : { ok: true }; }
    case 'cheat': {
      if (!state.sandbox && !import.meta.env?.DEV) return { ok: false };
      state.cash += cmd.cash;
      return { ok: true };
    }
  }
}
