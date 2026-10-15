import { useState } from 'react';
import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { FIXTURES, LOT_EXPANSION_COST, CORNERS, FLOORS, PALLET_UNITS, floorTileCount, tilePrice, MAX_FLOOR } from '@/sim/layout';
import type { BuildCategory, FixtureType } from '@/sim/types';
import { schemeById } from '@/sim/schemes';
import { money } from '../useRuntime';
import { StoresSection } from './StoresSection';
import { forSale, CORNER_PRICE } from '@/sim/rivals';
import { managerCandidates } from '@/sim/franchise';

type Tab = BuildCategory | 'floors' | 'shop';
const TABS: { id: Tab; label: string }[] = [
  { id: 'checkout', label: 'Tills' }, { id: 'shelves', label: 'Shelves' }, { id: 'furniture', label: 'Furniture' }, { id: 'decor', label: 'Decor' },
  { id: 'walls', label: 'Walls' }, { id: 'lights', label: 'Lights' }, { id: 'floors', label: 'Floors' }, { id: 'shop', label: 'Shop' },
];
/** A word on what each piece is for (the tile's tooltip). */
const NOTES: Partial<Record<FixtureType, string>> = {
  register: 'Where shoppers pay. You need one to open', kiosk: 'Shoppers scan their own: no cashier', rack: 'Snacks and sweets by the till',
  pallet: `Room for ${PALLET_UNITS} more units of deliveries`, shelf: '4 slots, both sides', endcap: 'Impulse buys sell here', produce: 'Fruit and veg', fridge: '4 chilled slots', freezer: '2 big slots of dairy and meat',
  bench: 'A seat by the door', sofa: 'A comfier seat', cafe: 'A table and two chairs', desk: 'Questions answered here', basketStack: 'Baskets by the door',
  trolleys: 'Trolleys for big shops', bin: 'Keeps the floor cleaner', speaker: 'Music in the aisles', screen: 'Shows your offers', bookcase: 'Magazines and papers',
  plant: 'Shoppers like plants', flowers: 'Pots of herbs and flowers', sign: 'Shoppers find things faster', rug: 'Walk on it', doormat: 'Just inside the door',
  window: 'In a side or back wall, one tile at a time', wall: 'Divide the floor', wallWindow: 'A wall you can see through', doorway: 'A wall you can walk through', railing: 'A low divider', gate: 'A railing you can walk through',
  floorLamp: 'Warm light after dark', wallLight: 'On an outside wall', pendant: 'Hangs over the aisle', neon: 'On an outside wall, always lit',
};

/** The swatch for a floor finish: two tiles of its colours. */
function floorSwatch(id: string, light: string): string {
  const c: Record<string, [string, string]> = { lino: ['#FFF3DC', '#F3DEC0'], concrete: ['#C4C0B8', '#BBB6AD'], checker: ['#FFFFFF', '#38383D'], colour: ['#FFFFFF', light], stone: ['#F4F7FA', '#E4E6EA'], wood: ['#D9A066', '#B8824C'] };
  const [a, b] = c[id] ?? ['#ddd', '#ccc'];
  return id === 'wood' ? `repeating-linear-gradient(0deg, ${a} 0 8px, ${b} 8px 9px, #C99A62 9px 17px, ${b} 17px 18px)` : `conic-gradient(${a} 0 25%, ${b} 0 50%, ${a} 0 75%, ${b} 0)`;
}

export function BuildCard({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const s = runtime.state!;
  const b = snap.build;
  const selected = b.selectedId !== null ? s.shop.fixtures.find((f) => f.id === b.selectedId) : null;
  const [tab, setTabState] = useState<Tab>(() => (runtime.buildTab as Tab | null) ?? (b.placing ? FIXTURES[b.placing].category : s.shop.fixtures.some((f) => f.type === 'register') ? 'shelves' : 'checkout'));
  const setTab = (t: Tab) => { runtime.rememberBuildTab(t); setTabState(t); };
  const thumbs = runtime.renderer?.fixtureThumbs ?? {};
  const items = (Object.keys(FIXTURES) as FixtureType[]).filter((t) => FIXTURES[t].category === tab);
  const floor = s.shop.floorStyle ?? 'lino';
  return (
    <>
      {b.tool ? (
        <div className="item" style={{ background: b.valid ? '#e9f7f0' : '#fde3dd' }}>
          <div>
            <div className="name">{b.tool.kind === 'grow' ? 'Adding floor' : `Laying ${FLOORS.find((x) => x.id === (b.tool as { style: string }).style)?.name.toLowerCase()}`}</div>
            <div className="sub">{b.reason || (b.tool.kind === 'grow' ? 'Click a marked tile next to the shop' : 'Click a tile of floor')}{b.price ? ` · ${money(b.price)} a tile` : ''}</div>
          </div>
          <div className="row"><button className="btn small ghost" onClick={() => runtime.stopPlacing()}>Done</button></div>
        </div>
      ) : (b.placing || selected) ? (
        <div className="item" style={{ background: b.valid ? '#e9f7f0' : '#fde3dd' }}>
          <div>
            <div className="name">{b.placing ? FIXTURES[b.placing].name : `Moving ${FIXTURES[selected!.type].name}`}</div>
            <div className="sub">{b.reason || 'Point at a floor tile'}{b.price ? ` · ${money(b.price)}` : ''} · R turns</div>
          </div>
          <div className="row">
            <button className="btn small ghost" onClick={() => runtime.rotateGhost()}>Rotate</button>
            {selected && <button className="btn small ghost" onClick={() => runtime.copySelected()}>Copy</button>}
            {selected && <button className="btn small danger" onClick={() => runtime.sellSelected()}>Sell</button>}
            <button className="btn small ghost" onClick={() => { runtime.stopPlacing(); runtime.closeCard(); }}>Done</button>
          </div>
        </div>
      ) : null}
      <div className="row between build-tools">
        <span className="row"><button className="btn small ghost" disabled={!b.canUndo} onClick={() => runtime.undo()} title="Ctrl+Z">Undo</button><button className="btn small ghost" disabled={!b.canRedo} onClick={() => runtime.redo()} title="Ctrl+Y">Redo</button></span>
        <label className="row overlay-pick"><span className="muted">View</span>
          <select value={b.overlay} onChange={(e) => runtime.setOverlay(e.target.value as typeof b.overlay)}>
            <option value="none">Normal</option><option value="heat">Heat map</option><option value="exposure">Exposure</option><option value="paths">Paths</option>
          </select>
        </label>
      </div>
      <nav className="build-tabs" role="tablist" aria-label="What to build">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </nav>
      {items.length > 0 && (
        <div className="build-grid">
          {items.map((type) => {
            const def = FIXTURES[type];
            return (
              <button key={type} className={`build-tile${b.placing === type ? ' on' : ''}`} disabled={s.cash < def.price} onClick={() => runtime.startPlacing(type)} title={NOTES[type]}>
                {thumbs[type] ? <img src={thumbs[type]} alt="" /> : <span className="pic" />}
                <b>{def.name}</b>
                <span>{money(def.price)}{def.upkeep ? <small> +{money(def.upkeep)}/day</small> : null}</span>
              </button>
            );
          })}
        </div>
      )}
      {tab === 'floors' && (
        <div className="list">
          {FLOORS.map((fl) => {
            const on = b.tool?.kind === 'floor' && b.tool.style === fl.id;
            return (
              <div className="item" key={fl.id}>
                <span className="swatch big" style={{ background: floorSwatch(fl.id, schemeById(s.shop.scheme).light) }} aria-hidden="true" />
                <div style={{ flex: 1 }}><div className="name">{fl.name}</div><div className="sub">{fl.perTile ? `${money(fl.perTile)} a tile` : 'Free'}{fl.id === floor && !s.shop.tileStyles ? ' · down now' : ''}</div></div>
                <button className={`btn small${on ? ' ghost' : ''}`} disabled={s.cash < fl.perTile} onClick={() => (on ? runtime.stopPlacing() : runtime.startTool({ kind: 'floor', style: fl.id }))}>{on ? 'Done' : 'Lay'}</button>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'shop' && (
        <>
          <h3>Floor</h3>
          {(() => {
            const n = floorTileCount(s.shop), max = (MAX_FLOOR.x1 - MAX_FLOOR.x0) * (MAX_FLOOR.z1 - MAX_FLOOR.z0), price = tilePrice(s.shop), on = b.tool?.kind === 'grow';
            return (
              <div className="item">
                <div><div className="name">{n} tiles</div><div className="sub">{n < max ? `Next tile ${money(price)} · room for ${max - n} more` : 'As big as the plot allows'}</div></div>
                {n < max && <button className={`btn small${on ? ' ghost' : ''}`} disabled={!on && s.cash < price} onClick={() => (on ? runtime.stopPlacing() : runtime.startTool({ kind: 'grow' }))}>{on ? 'Done' : 'Add tiles'}</button>}
              </div>
            );
          })()}
          <div className="item">
            <div><div className="name">Bigger car park</div><div className="sub">{s.shop.lotRows > 1 ? `${s.shop.bays.length} bays` : `Twice the bays · ${money(LOT_EXPANSION_COST)}`}</div></div>
            {s.shop.lotRows === 1 && <button className="btn small" disabled={s.cash < LOT_EXPANSION_COST} onClick={() => runtime.dispatch({ type: 'expandLot' })}>Expand</button>}
          </div>
          <h3>Sign letters</h3>
          <div className="item">
            <div><div className="name">{s.shop.signStyle === 'lit' ? 'Lit letters' : 'Painted letters'}</div><div className="sub">{s.goals.unlocked.includes('signLit') || s.sandbox ? 'Lit letters glow after dark' : 'Unlocks with the Regulars goal'}</div></div>
            {(s.goals.unlocked.includes('signLit') || s.sandbox) && <button className="btn small ghost" onClick={() => runtime.dispatch({ type: 'signStyle', style: s.shop.signStyle === 'lit' ? 'classic' : 'lit' })}>{s.shop.signStyle === 'lit' ? 'Paint' : 'Light up'}</button>}
          </div>
          <CornerForSale runtime={runtime} />
          <StoresSection runtime={runtime} snap={snap} />
        </>
      )}
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
