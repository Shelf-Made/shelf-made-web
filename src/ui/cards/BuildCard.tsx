import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { FIXTURES, SHOP_SIZES, LOT_EXPANSION_COST, CORNERS } from '@/sim/layout';
import type { FixtureType } from '@/sim/types';
import { money } from '../useRuntime';
import { StoresSection } from './StoresSection';
import { forSale, CORNER_PRICE } from '@/sim/rivals';
import { managerCandidates } from '@/sim/franchise';

const CATALOG: { type: FixtureType; blurb: string }[] = [
  { type: 'register', blurb: 'Where shoppers pay. You need one to open; a second takes a second cashier.' },
  { type: 'shelf', blurb: '4 slots of dry goods and drinks, both sides.' },
  { type: 'fridge', blurb: '4 chilled slots for milk, cheese and cold drinks; costs power.' },
  { type: 'freezer', blurb: 'Tall glass fridge: 2 big slots of dairy and meat.' },
  { type: 'produce', blurb: 'Fruit and veg crates; looks fresh by the door.' },
  { type: 'endcap', blurb: 'Aisle end: impulse buys sell here.' },
  { type: 'rack', blurb: 'Checkout rack for snacks and sweets.' },
  { type: 'kiosk', blurb: 'Self-checkout: no cashier, slower shoppers.' },
  { type: 'sign', blurb: 'Aisle sign: shoppers find things faster.' },
  { type: 'plant', blurb: 'A plant. Shoppers like plants.' },
  { type: 'bench', blurb: 'A bench by the door for tired shoppers.' },
  { type: 'basketStack', blurb: 'More baskets so nobody juggles milk.' },
];

export function BuildCard({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const s = runtime.state!;
  const b = snap.build;
  const selected = b.selectedId !== null ? s.shop.fixtures.find((f) => f.id === b.selectedId) : null;
  const current = SHOP_SIZES.findIndex((z) => z.id === s.shop.sizeId);
  return (
    <>
      {(b.placing || selected) ? (
        <div className="item" style={{ background: b.valid ? '#e9f7f0' : '#fde3dd' }}>
          <div>
            <div className="name">{b.placing ? `Placing ${FIXTURES[b.placing].name}` : `Moving ${FIXTURES[selected!.type].name}`}</div>
            <div className="sub">{b.reason || 'Point at a floor tile'}{b.price ? ` · ${money(b.price)}` : ''} · R turns it · right-click cancels</div>
          </div>
          <div className="row">
            <button className="btn small ghost" onClick={() => runtime.rotateGhost()}>Rotate</button>
            {selected && <button className="btn small ghost" onClick={() => runtime.copySelected()}>Copy</button>}
            {selected && <button className="btn small danger" onClick={() => runtime.sellSelected()}>Sell</button>}
            <button className="btn small ghost" onClick={() => { runtime.stopPlacing(); runtime.closeCard(); }}>Done</button>
          </div>
        </div>
      ) : <p className="muted">Pick something below, then point at a floor tile and click to place it. With this card open, click a fixture to move, copy or sell it.</p>}
      <div className="row between">
        <span className="muted">Undo and redo: Ctrl+Z / Ctrl+Y</span>
        <span className="row"><button className="btn small ghost" disabled={!b.canUndo} onClick={() => runtime.undo()}>Undo</button><button className="btn small ghost" disabled={!b.canRedo} onClick={() => runtime.redo()}>Redo</button></span>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}><span className="muted">Overlay:</span>{(['none', 'heat', 'exposure', 'paths'] as const).map((k) => <button key={k} className={`btn small${b.overlay === k ? '' : ' ghost'}`} onClick={() => runtime.setOverlay(k)}>{k === 'none' ? 'Off' : k === 'heat' ? 'Heat map' : k === 'exposure' ? 'Exposure' : 'Paths'}</button>)}</div>
      <h3>Fixtures</h3>
      <div className="list">
        {CATALOG.map(({ type, blurb }) => (
          <div className="item" key={type}>
            <div><div className="name">{FIXTURES[type].name} <span className="tag">{money(FIXTURES[type].price)}</span>{FIXTURES[type].upkeep ? <span className="tag cold">{money(FIXTURES[type].upkeep)}/day power</span> : null}</div><div className="sub">{blurb}</div></div>
            <button className={`btn small${b.placing === type ? '' : ' ghost'}`} disabled={s.cash < FIXTURES[type].price} onClick={() => runtime.startPlacing(type)}>Place</button>
          </div>
        ))}
      </div>
      <h3>Grow the shop</h3>
      {SHOP_SIZES.map((z, i) => (
        <div className="item" key={z.id}>
          <div><div className="name">{z.name}{i === current ? ' (now)' : ''}</div><div className="sub">{i > current ? `${money(z.cost - SHOP_SIZES[current]!.cost)}, built overnight-fast: walls move right away` : i === current ? 'Your current size' : 'Smaller than now'}</div></div>
          {i > current && <button className="btn small" disabled={s.cash < z.cost - SHOP_SIZES[current]!.cost} onClick={() => runtime.dispatch({ type: 'expandShop', sizeId: z.id })}>Extend</button>}
        </div>
      ))}
      <div className="item">
        <div><div className="name">Bigger parking lot</div><div className="sub">{s.shop.lotRows > 1 ? `${s.shop.bays.length} bays already.` : `Doubles the bays for ${money(LOT_EXPANSION_COST)}. Full lots turn drivers away.`}</div></div>
        {s.shop.lotRows === 1 && <button className="btn small" disabled={s.cash < LOT_EXPANSION_COST} onClick={() => runtime.dispatch({ type: 'expandLot' })}>Expand</button>}
      </div>
      <CornerForSale runtime={runtime} />
      <h3>Sign letters</h3>
      <div className="item">
        <div><div className="name">{s.shop.signStyle === 'lit' ? 'Lit letters' : 'Painted letters'}</div><div className="sub">{s.goals.unlocked.includes('signLit') || s.sandbox ? 'Lit letters glow on the fascia and the pylon after dark.' : 'Lit letters unlock with the Regulars goal.'}</div></div>
        {(s.goals.unlocked.includes('signLit') || s.sandbox) && <button className="btn small ghost" onClick={() => runtime.dispatch({ type: 'signStyle', style: s.shop.signStyle === 'lit' ? 'classic' : 'lit' })}>{s.shop.signStyle === 'lit' ? 'Paint' : 'Light up'}</button>}
      </div>
      <StoresSection runtime={runtime} snap={snap} />
      <p className="muted">Layout matters: shoppers walk less with short aisles, end caps near the door sell impulse items, and crowded corners cost happiness.</p>
    </>
  );
}

/** A closed rival's corner, for sale as it stands: buy it and it trades as one of your branches. */
function CornerForSale({ runtime }: { runtime: GameRuntime }) {
  const s = runtime.state!;
  const r = forSale(s);
  const managers = managerCandidates(s);
  if (!r) return null;
  const price = CORNER_PRICE[r.kind];
  const left = 10 - (s.day - (r.closedDay ?? s.day));
  return (
    <>
      <h3>Corner for sale</h3>
      <div className="item">
        <div>
          <div className="name">The old {r.name} · {money(price)}</div>
          <div className="sub">The building as it stands, on the {CORNERS[r.corner].name}. It trades as your branch, run by a manager by your rules. {left > 0 ? `A challenger moves in within ${left} day${left === 1 ? '' : 's'} if nobody buys it.` : 'A challenger is about to move in.'}</div>
          {!managers.length && <div className="sub">No manager in today's pool: check the Staff card tomorrow.</div>}
        </div>
        <button className="btn small" disabled={!managers.length || s.cash < price} onClick={() => runtime.dispatch({ type: 'buyCorner', rivalId: r.id, managerId: managers[0]!.id })}>Buy</button>
      </div>
    </>
  );
}
