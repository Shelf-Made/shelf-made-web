import { useState } from 'react';
import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { FIXTURES, CORNERS, FLOORS, WALLS, SURFACES, BAY_PRICE, LOT_MAX, PALLET_UNITS, RACK_STANDS, floorTileCount, MAX_FLOOR, MAX_LEVELS, FLOOR_NAMES, lotLayout, storeysOf, panelsOver } from '@/sim/layout';
import { PANEL_PRICE } from '@/sim/storeys';
import { tileCost, grownCeilings } from '@/sim/build';
import type { BuildCategory, FixtureType } from '@/sim/types';
import { schemeById } from '@/sim/schemes';
import { money } from '../useRuntime';
import { StoresSection } from './StoresSection';
import { forSale, CORNER_PRICE } from '@/sim/rivals';
import { managerCandidates } from '@/sim/franchise';
import { FURNITURE_USE } from '@/sim/furniture';

type Tab = BuildCategory | 'floors' | 'shop';
const TABS: { id: Tab; label: string }[] = [
  { id: 'checkout', label: 'Tills' }, { id: 'shelves', label: 'Shelves' }, { id: 'furniture', label: 'Furniture' }, { id: 'decor', label: 'Decor' },
  { id: 'walls', label: 'Walls' }, { id: 'lights', label: 'Lights' }, { id: 'security', label: 'Security' }, { id: 'floors', label: 'Floors' }, { id: 'storeys', label: 'Upstairs' }, { id: 'outside', label: 'Outside' }, { id: 'shop', label: 'Shop' },
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
  flowerBed: 'Brightens the frontage', planter: 'A tub of greenery', tree: 'Shade and green round the car park', parkBench: 'Somewhere to sit outside',
  bikeRack: `Shoppers ride in and lock up (${RACK_STANDS} bikes); brings in a few more`, billboard: `Your own board: no rent, seen from Main Road (up to ${LOT_MAX.billboard})`,
  stairs: 'Opens the floor above: shoppers climb up to what is on its shelves', escalator: 'Carries shoppers up without the climb: more of them go up',
  elevator: 'A lift to the floor above: one tile, doors on both floors',
  camera: 'On a wall, watching the floor in front of it: fewer shoplifters, and every free hand sees one run',
  dome: 'On the ceiling, watching all round it (over a shelf too)',
  smartCam: 'Watches all round, further, and freezes a running thief for a moment',
  tagGate: 'Just inside the door: beeps at a thief running out, and stops most of them', tallWall: 'Twice as tall, for a double-height space (no ceiling panel over it)',
};

/** What a piece is for: what the furniture does, or the note above. */
const noteFor = (t: FixtureType): string | undefined => FURNITURE_USE[t] ?? NOTES[t];

/** The swatch for a surface on the lot. */
function surfaceSwatch(id: string | null): string {
  switch (id) {
    case 'asphalt': return '#6E717C';
    case 'paving': return 'conic-gradient(#D8DADF 0 25%, #C8CBD2 0 50%, #D8DADF 0 75%, #C8CBD2 0)';
    case 'brick': return 'repeating-linear-gradient(0deg, #B8573F 0 6px, #D8DADF 6px 7px)';
    case 'gravel': return 'radial-gradient(circle at 30% 40%, #B5A88A 0 2px, transparent 3px) 0 0 / 8px 8px, #CFC3A6';
    default: return '#7CC26B';
  }
}

/** The swatch for a wall finish: its bands, bottom to top. */
function wallSwatch(id: string, sc: { primary: string; light: string }): string {
  switch (id) {
    case 'bands': return `linear-gradient(0deg, #C48A52 0 10%, ${sc.primary} 10% 46%, #FFF3DC 46% 52%, ${sc.light} 52%)`;
    case 'tiles': return 'repeating-linear-gradient(0deg, #FFFFFF 0 7px, #D8DADF 7px 8px)';
    case 'wood': return 'linear-gradient(0deg, #A87B45 0 10%, #C99A62 10% 56%, #A87B45 56% 62%, #FFF3DC 62%)';
    case 'brick': return 'repeating-linear-gradient(0deg, #B8402E 0 6px, #D8DADF 6px 7px)';
    default: return 'linear-gradient(0deg, #D8DADF 0 10%, #FFF3DC 10%)';
  }
}

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
  // The Security tab shows what the cameras see while you place them (and stops when you leave it).
  const setTab = (t: Tab) => {
    runtime.rememberBuildTab(t); setTabState(t);
    if (t === 'security' && b.overlay === 'none') runtime.setOverlay('security');
    else if (t !== 'security' && b.overlay === 'security') runtime.setOverlay('none');
  };
  const thumbs = runtime.renderer?.fixtureThumbs ?? {};
  const items = (Object.keys(FIXTURES) as FixtureType[]).filter((t) => FIXTURES[t].category === tab);
  const floor = s.shop.floorStyle ?? 'lino';
  const top = storeysOf(s.shop).top;
  return (
    <>
      {b.tool ? (
        <div className="item" style={{ background: b.valid ? '#e9f7f0' : '#fde3dd' }}>
          <div>
            <div className="name">{b.tool.kind === 'pave' ? (b.tool.surface ? `Laying ${SURFACES.find((x) => x.id === (b.tool as { surface: string }).surface)?.name.toLowerCase()}` : 'Back to grass') : b.tool.kind === 'bay' ? 'Painting bays' : b.tool.kind === 'unbay' ? 'Painting out bays' : b.tool.kind === 'grow' ? 'Adding floor' : b.tool.kind === 'sell' ? 'Selling floor' : b.tool.kind === 'push' ? 'Pushing a wall out' : b.tool.kind === 'pull' ? 'Pulling a wall in' : b.tool.kind === 'panel' ? 'Putting up ceiling panels' : b.tool.kind === 'unpanel' ? 'Taking down ceiling panels' : b.tool.kind === 'wall' ? `Walls: ${WALLS.find((x) => x.id === (b.tool as { style: string }).style)?.name.toLowerCase()}` : `Laying ${FLOORS.find((x) => x.id === (b.tool as { style: string }).style)?.name.toLowerCase()}`}</div>
            <div className="sub">{b.reason || (b.tool.kind === 'grow' ? 'Click a marked tile next to the shop' : b.tool.kind === 'wall' ? 'Click a stretch of wall' : b.tool.kind === 'push' || b.tool.kind === 'pull' ? 'Point at an outer wall' : b.tool.kind === 'pave' ? 'Click a tile of the lot' : b.tool.kind === 'bay' || b.tool.kind === 'unbay' ? 'Click a bay beside the shop' : 'Click a tile of floor')}{b.price > 0 ? ` · ${money(b.price)}` : b.price < 0 ? ` · ${money(-b.price)} back` : ''}</div>
          </div>
          <div className="row"><button className="btn small ghost" onClick={() => runtime.stopPlacing()}>Done</button></div>
        </div>
      ) : (b.placing || selected) ? (
        <div className="item" style={{ background: b.valid ? '#e9f7f0' : '#fde3dd' }}>
          <div>
            <div className="name">{b.placing ? FIXTURES[b.placing].name : `Moving ${FIXTURES[selected!.type].name}`}</div>
            {noteFor(b.placing ?? selected!.type) && <div className="sub">{noteFor(b.placing ?? selected!.type)}</div>}
            <div className="sub">{b.reason || (FIXTURES[b.placing ?? selected!.type].outdoor ? 'Point at the grass outside' : 'Point at a floor tile')}{b.price ? ` · ${money(b.price)}` : ''} · R turns</div>
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
            <option value="none">Normal</option><option value="heat">Heat map</option><option value="exposure">Exposure</option><option value="paths">Paths</option><option value="security">Cameras</option>
          </select>
        </label>
      </div>
      {(top > 0 || tab === 'storeys') && (
        <div className="row floor-pick" role="group" aria-label="Which floor">
          <span className="muted">Floor</span>
          {FLOOR_NAMES.slice(0, top + 1).map((n, L) => <button key={n} className={`btn small${b.level === L ? '' : ' ghost'}`} aria-pressed={b.level === L} onClick={() => runtime.setBuildLevel(L)}>{n}</button>)}
        </div>
      )}
      <nav className="build-tabs" role="tablist" aria-label="What to build">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </nav>
      {items.length > 0 && (
        <div className="build-grid">
          {items.map((type) => {
            const def = FIXTURES[type];
            return (
              <button key={type} className={`build-tile${b.placing === type ? ' on' : ''}`} disabled={s.cash < def.price} onClick={() => runtime.startPlacing(type)} title={noteFor(type)}>
                {thumbs[type] ? <img src={thumbs[type]} alt="" /> : <span className="pic" />}
                <b>{def.name}</b>
                <span>{money(def.price)}{def.upkeep ? <small> +{money(def.upkeep)}/day</small> : null}</span>
              </button>
            );
          })}
        </div>
      )}
      {tab === 'storeys' && (
        <>
          <h3>Ceiling panels</h3>
          {(() => {
            const n = panelsOver(s.shop, b.level).size, tool = b.tool?.kind, last = b.level >= MAX_LEVELS - 1;
            return (
              <div className="item">
                <span className="swatch big" style={{ background: 'repeating-linear-gradient(90deg, #E4E6EA 0 13px, #B9BCC4 13px 15px)' }} aria-hidden="true" />
                <div style={{ flex: 1 }}>
                  <div className="name">{last ? 'The top floor' : `${n} over the ${FLOOR_NAMES[b.level]!.toLowerCase()} floor`}</div>
                  <div className="sub">{last ? `${MAX_LEVELS} floors is the most a shop can have` : `Each is the floor of the storey above. Take one down (${money(Math.round(PANEL_PRICE * 0.6))} back) for a double-height space: tall walls and high lights go there. ${money(PANEL_PRICE)} to put one up.`}</div>
                </div>
                {!last && (
                  <span className="row">
                    <button className={`btn small${tool === 'panel' ? ' ghost' : ''}`} disabled={tool !== 'panel' && s.cash < PANEL_PRICE} onClick={() => (tool === 'panel' ? runtime.stopPlacing() : runtime.startTool({ kind: 'panel' }))}>{tool === 'panel' ? 'Done' : 'Put up'}</button>
                    {n > 0 && <button className="btn small ghost" onClick={() => (tool === 'unpanel' ? runtime.stopPlacing() : runtime.startTool({ kind: 'unpanel' }))}>{tool === 'unpanel' ? 'Done' : 'Take down'}</button>}
                  </span>
                )}
              </div>
            );
          })()}
          <p className="muted">Stairs, an escalator or a lift open the floor above: shoppers go up for what is on the shelves there. A floor they open gets a ceiling ({money(PANEL_PRICE)} a tile) unless it has panels. Pick a floor above to build on it.</p>
        </>
      )}
      {tab === 'walls' && (
        <>
          <h3>Move a wall</h3>
          <p className="muted">Point at an outer wall: push it out a row to make the shop bigger, or pull it in to sell that row of floor back. Inside walls you put up sell from their own menu.</p>
          <div className="row wall-move">
            <button className={`btn small${b.tool?.kind === 'push' ? ' ghost' : ''}`} onClick={() => (b.tool?.kind === 'push' ? runtime.stopPlacing() : runtime.startTool({ kind: 'push' }))}>{b.tool?.kind === 'push' ? 'Done' : 'Push a wall out'}</button>
            <button className={`btn small ghost`} onClick={() => (b.tool?.kind === 'pull' ? runtime.stopPlacing() : runtime.startTool({ kind: 'pull' }))}>{b.tool?.kind === 'pull' ? 'Done' : 'Pull a wall in'}</button>
          </div>
          <h3>Finish</h3>
          <div className="list">
            {WALLS.map((w) => {
              const on = b.tool?.kind === 'wall' && b.tool.style === w.id;
              return (
                <div className="item" key={w.id}>
                  <span className="swatch big" style={{ background: wallSwatch(w.id, schemeById(s.shop.scheme)) }} aria-hidden="true" />
                  <div style={{ flex: 1 }}><div className="name">{w.name}</div><div className="sub">{w.perSeg ? `${money(w.perSeg)} a stretch` : 'Comes with the shop · puts back a finish'}</div></div>
                  <button className={`btn small${on ? ' ghost' : ''}`} disabled={s.cash < w.perSeg} onClick={() => (on ? runtime.stopPlacing() : runtime.startTool({ kind: 'wall', style: w.id }))}>{on ? 'Done' : w.perSeg ? 'Paint' : 'Strip'}</button>
                </div>
              );
            })}
          </div>
        </>
      )}
      {tab === 'floors' && (
        <div className="list">
          {FLOORS.map((fl) => {
            const on = b.tool?.kind === 'floor' && b.tool.style === fl.id;
            return (
              <div className="item" key={fl.id}>
                <span className="swatch big" style={{ background: floorSwatch(fl.id, schemeById(s.shop.scheme).light) }} aria-hidden="true" />
                <div style={{ flex: 1 }}><div className="name">{fl.name}</div><div className="sub">{fl.perTile ? `${money(fl.perTile)} a tile` : 'Comes with the shop · puts back a finish'}{fl.id === floor && !s.shop.tileStyles ? ' · down now' : ''}</div></div>
                <button className={`btn small${on ? ' ghost' : ''}`} disabled={s.cash < fl.perTile} onClick={() => (on ? runtime.stopPlacing() : runtime.startTool({ kind: 'floor', style: fl.id }))}>{on ? 'Done' : 'Lay'}</button>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'outside' && (
        <>
          <h3>Parking</h3>
          {(() => {
            const slots = lotLayout(s.shop).slots.length, n = s.shop.bays.length;
            const tool = b.tool?.kind;
            return (
              <div className="item">
                <span className="swatch big" style={{ background: 'repeating-linear-gradient(90deg, #6E717C 0 14px, #F2F2F2 14px 16px)' }} aria-hidden="true" />
                <div style={{ flex: 1 }}><div className="name">{n} of {slots} bays</div><div className="sub">{n < slots ? `${money(BAY_PRICE)} a bay · paint them one at a time` : 'As many as the car park takes'}</div></div>
                <span className="row">
                  {n < slots && <button className={`btn small${tool === 'bay' ? ' ghost' : ''}`} disabled={tool !== 'bay' && s.cash < BAY_PRICE} onClick={() => (tool === 'bay' ? runtime.stopPlacing() : runtime.startTool({ kind: 'bay' }))}>{tool === 'bay' ? 'Done' : 'Paint'}</button>}
                  {n > 0 && <button className="btn small ghost" onClick={() => (tool === 'unbay' ? runtime.stopPlacing() : runtime.startTool({ kind: 'unbay' }))}>{tool === 'unbay' ? 'Done' : 'Remove'}</button>}
                </span>
              </div>
            );
          })()}
          <h3>Surfaces</h3>
          <div className="list">
            {[...SURFACES, { id: null, name: 'Grass', perTile: 0 }].map((sf) => {
              const on = b.tool?.kind === 'pave' && b.tool.surface === sf.id;
              return (
                <div className="item" key={sf.id ?? 'grass'}>
                  <span className="swatch big" style={{ background: surfaceSwatch(sf.id) }} aria-hidden="true" />
                  <div style={{ flex: 1 }}><div className="name">{sf.name}</div><div className="sub">{sf.perTile ? `${money(sf.perTile)} a tile` : 'Takes up what was laid, for part of what it cost'}</div></div>
                  <button className={`btn small${on ? ' ghost' : ''}`} disabled={!on && s.cash < sf.perTile} onClick={() => (on ? runtime.stopPlacing() : runtime.startTool({ kind: 'pave', surface: sf.id as never }))}>{on ? 'Done' : sf.id ? 'Lay' : 'Dig up'}</button>
                </div>
              );
            })}
          </div>
        </>
      )}
      {tab === 'shop' && (
        <>
          <h3>Make the shop bigger</h3>
          <p className="muted">Push a wall out a whole row at a time, or add floor a tile at a time, up to {MAX_FLOOR.x1 - MAX_FLOOR.x0} × {MAX_FLOOR.z1 - MAX_FLOOR.z0} tiles on this plot. Then build up: stairs open a floor above (Upstairs tab).</p>
          {(() => {
            const n = floorTileCount(s.shop), max = (MAX_FLOOR.x1 - MAX_FLOOR.x0) * (MAX_FLOOR.z1 - MAX_FLOOR.z0), price = tileCost(s.shop), up = grownCeilings(s.shop).length, on = b.tool?.kind === 'grow';
            return (
              <div className="item">
                <div><div className="name">{n} tiles</div><div className="sub">{n < max ? `Next tile ${money(price)}${up ? ` with its panel${up > 1 ? 's' : ''} upstairs` : ''} · room for ${max - n} more` : 'As big as the plot allows'}</div></div>
                <span className="row">
                  {n < max && <button className={`btn small${b.tool?.kind === 'push' ? ' ghost' : ''}`} disabled={b.tool?.kind !== 'push' && s.cash < price} onClick={() => (b.tool?.kind === 'push' ? runtime.stopPlacing() : runtime.startTool({ kind: 'push' }))}>{b.tool?.kind === 'push' ? 'Done' : 'Push a wall'}</button>}
                  {n < max && <button className={`btn small${on ? ' ghost' : ''}`} disabled={!on && s.cash < price} onClick={() => (on ? runtime.stopPlacing() : runtime.startTool({ kind: 'grow' }))}>{on ? 'Done' : 'Add tiles'}</button>}
                  <button className={`btn small ghost`} onClick={() => (b.tool?.kind === 'sell' ? runtime.stopPlacing() : runtime.startTool({ kind: 'sell' }))}>{b.tool?.kind === 'sell' ? 'Done' : 'Sell tiles'}</button>
                </span>
              </div>
            );
          })()}
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
