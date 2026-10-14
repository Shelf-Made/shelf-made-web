import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { FIXTURES, SHOP_SIZES, LOT_EXPANSION_COST } from '@/sim/layout';
import type { FixtureType } from '@/sim/types';
import { money } from '../useRuntime';
import { StoresSection } from './StoresSection';

const CATALOG: { type: FixtureType; blurb: string }[] = [
  { type: 'shelf', blurb: '6 slots of dry goods and drinks.' },
  { type: 'fridge', blurb: '4 chilled slots; glows at night; costs power.' },
  { type: 'freezer', blurb: 'Ice cream and meat, 2 big slots.' },
  { type: 'produce', blurb: 'Fruit and veg crate, looks fresh by the door.' },
  { type: 'endcap', blurb: 'Aisle end: impulse buys sell here.' },
  { type: 'rack', blurb: 'Checkout rack for snacks and sweets.' },
  { type: 'register', blurb: 'A second till for a second cashier.' },
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
            <div className="sub">{b.reason || 'Point at a tile in the shop'}{b.price ? ` · ${money(b.price)}` : ''} · R rotates · Esc cancels</div>
          </div>
          <div className="row">
            <button className="btn small ghost" onClick={() => runtime.rotateGhost()}>Rotate</button>
            {selected && <button className="btn small ghost" onClick={() => runtime.copySelected()}>Copy</button>}
            {selected && <button className="btn small danger" onClick={() => runtime.sellSelected()}>Sell</button>}
            <button className="btn small ghost" onClick={() => { runtime.stopPlacing(); runtime.closeCard(); }}>Done</button>
          </div>
        </div>
      ) : <p className="muted">Pick something below, then click a tile. Click a fixture on the floor to move, copy or sell it.</p>}
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
      <StoresSection runtime={runtime} snap={snap} />
      <p className="muted">Layout matters: shoppers walk less with short aisles, end caps near the door sell impulse items, and crowded corners cost happiness.</p>
    </>
  );
}
