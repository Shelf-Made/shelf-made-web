import { useEffect, useState } from 'react';
import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { FIXTURES, VARIANTS, CORNERS, FLOORS, WALLS, SURFACES, BAY_PRICE, LOT_MAX, PALLET_UNITS, STORE_RACK_UNITS, RACK_STANDS, floorTileCount, MAX_FLOOR, MAX_LEVELS, FLOOR_NAMES, storeysOf, panelsOver } from '@/sim/layout';
import { PANEL_PRICE } from '@/sim/storeys';
import { bayReachable, truckStop } from '@/sim/drive';
import { tileCost, grownCeilings, openEdges, wallUpPrice } from '@/sim/build';
import type { BuildCategory, FixtureType } from '@/sim/types';
import { schemeById } from '@/sim/schemes';
import { money } from '../useRuntime';
import { StoresSection } from './StoresSection';
import { forSale, CORNER_PRICE } from '@/sim/rivals';
import { managerCandidates } from '@/sim/franchise';
import { FURNITURE_USE } from '@/sim/furniture';
import { looksOf } from '@/sim/reviews';
import { SIGN_TIERS, SLOGAN_MAX, LOADING_BAY_PRICE, CHARGE_FEE, BUS_PULL, BAY_ETA, signTier, signPrice } from '@/sim/frontage';

type Tab = BuildCategory | 'floors' | 'shop';
const TABS: { id: Tab; label: string }[] = [
  { id: 'checkout', label: 'Tills' }, { id: 'shelves', label: 'Shelves' }, { id: 'furniture', label: 'Furniture' }, { id: 'decor', label: 'Decor' },
  { id: 'walls', label: 'Walls' }, { id: 'lights', label: 'Lights' }, { id: 'security', label: 'Security' }, { id: 'floors', label: 'Floors' }, { id: 'storeys', label: 'Upstairs' }, { id: 'outside', label: 'Outside' }, { id: 'shop', label: 'Shop' },
];
/** A word on what each piece is for (the tile's tooltip). */
const NOTES: Partial<Record<FixtureType, string>> = {
  register: 'Where shoppers pay. You need one to open', kiosk: 'Shoppers scan their own: no cashier', rack: 'Snacks and sweets by the till',
  pallet: `Room for ${PALLET_UNITS} more units of deliveries`, storeRack: `Two tiles of racking: room for ${STORE_RACK_UNITS} more units`, shelf: '4 slots, both sides', endcap: 'Impulse buys sell here', produce: 'Fruit and veg', fridge: '4 chilled slots', freezer: '2 big slots of dairy and meat',
  bench: 'A seat by the door', sofa: 'A comfier seat', cafe: 'A table and two chairs', desk: 'Questions answered here', basketStack: 'Baskets by the door',
  trolleys: 'Trolleys for big shops', bin: 'Keeps the floor cleaner', speaker: 'Music in the aisles', screen: 'Shows your offers', bookcase: 'Magazines and papers',
  plant: 'Shoppers like plants', flowers: 'Pots of herbs and flowers', sign: 'Shoppers find things faster', rug: 'Walk on it', doormat: 'Just inside the door',
  wall: 'On an edge of a tile: round the shop, or across it. R turns it to another side', wallWindow: 'A wall you can see through: daylight in a side or back wall',
  doorway: 'A wall you can walk through', railing: 'A low divider on an edge of a tile', gate: 'A railing you can walk through',
  floorLamp: 'Warm light after dark', wallLight: 'Hangs on a wall', pendant: 'Hangs over the aisle', neon: 'Hangs on a wall, always lit',
  flowerBed: 'Brightens the frontage', planter: 'A tub of greenery', tree: 'Shade and green round the car park', parkBench: 'Somewhere to sit outside',
  parkingBay: 'A place for one car, laid anywhere with its tarmac: the open end needs tarmac from the road',
  bikeRack: `Shoppers ride in and lock up (${RACK_STANDS} bikes); brings in a few more`, billboard: `Your own board: no rent, seen from Main Road (up to ${LOT_MAX.billboard})`,
  stairs: 'Opens the floor above: shoppers climb up to what is on its shelves', escalator: 'Carries shoppers up without the climb: more of them go up',
  elevator: 'A lift to the floor above: one tile, doors on both floors',
  iceChest: 'Frozen goods and ice cream: 4 big wells', coolProduce: 'All the fruit and veg, the chilled ones too: 3 big slots', wallShelf: 'Two small boards on a wall',
  glassCase: 'Beauty, gadgets, clothes and toys behind glass', displayTable: 'Two tiles of table for toys, gadgets, home and books', bakeryCase: 'Donuts, croissants, muffins, pies and baguettes under glass',
  clothesRail: 'Clothes on a rail, folded ones underneath', queueRail: 'Belt posts: the queue beside them keeps a straight, calmer line', vending: 'Drinks and snacks: shoppers pay at the machine, no till needed',
  camera: 'On a wall, watching the floor in front of it: fewer shoplifters, and one more of your staff gives chase when one runs past it',
  dome: 'On the ceiling, watching all round it (over a shelf too)',
  smartCam: 'Watches all round, further, and freezes a running thief for a moment',
  tagGate: 'Just inside the door: beeps at a thief running out, and stops most of them', tallWall: 'Twice as tall, for a double-height space (no ceiling panel over it)',
  fountain: 'Two tiers of stone and a pool: the frontage at its finest', statue: 'On a plinth by the car park (two kinds)', lampPost: 'Lights the lot after dark',
  bollard: 'A pair of posts to line a path', balloons: 'A bunch on a string: it looks like a party', hedge: 'Tile by tile: a row makes one hedge',
  evCharger: `Electric cars parked within reach plug in: ${money(CHARGE_FEE)} a charge, and a few more drivers come`,
  busStop: `Your own stop on the bus route, by the sidewalk: ${Math.round((BUS_PULL - 1) * 100)}% more shoppers, and the rush-hour crowd gets off at your door`,
};

/** The paint's colour (any at all) and the eyedropper, to take one off a tile or wall you point at next. */
function PaintPicker({ runtime, kind }: { runtime: GameRuntime; kind: 'floor' | 'wall' }) {
  return (
    <span className="row paint-pick">
      <input type="color" value={runtime.paintColour} onChange={(e) => runtime.setPaintColour(e.target.value)} aria-label="Paint colour" title="Any colour you like" />
      <button className={`btn small ghost eyedrop${runtime.eyedropper ? ' on' : ''}`} onClick={() => { if (!runtime.eyedropper) runtime.startTool({ kind, style: 'paint' }); runtime.setEyedropper(!runtime.eyedropper); }} title="Eyedropper: click a tile or wall to take its colour" aria-label="Eyedropper" aria-pressed={runtime.eyedropper}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4.5l5 5M17 7l2.5-2.5a1.8 1.8 0 00-2.5-2.5L14.5 4.5M16 8.5L7 17.5 4 20l2.5-3 9-9" /></svg>
      </button>
    </span>
  );
}

/** Choose a picture for the picture floor: shrunk to a small square (it is kept in the save), then laid tile by tile. */
function PhotoPicker({ runtime, has }: { runtime: GameRuntime; has: boolean }) {
  const pick = (file: File | undefined) => {
    if (!file) return;
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d')!, side = Math.min(img.width, img.height);
      g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 128, 128);
      URL.revokeObjectURL(url);
      const r = runtime.dispatch({ type: 'setFloorImage', dataUrl: c.toDataURL('image/jpeg', 0.82) });
      if (r.ok) { runtime.showToast('Picture ready: lay it on any tiles.', 1800); runtime.startTool({ kind: 'floor', style: 'photo' }); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); runtime.showToast("That file isn't a picture.", 1800); };
    img.src = url;
  };
  return (
    <label className="btn small ghost photo-pick" title="Any picture of your own, as floor tiles">
      {has ? 'Change' : 'Choose'}
      <input type="file" accept="image/*" onChange={(e) => pick(e.target.files?.[0])} style={{ display: 'none' }} />
    </label>
  );
}

/** What placing one more of a piece adds to how the shop looks (or its frontage), while it still counts. */
function looksGain(s: NonNullable<GameRuntime['state']>, t: FixtureType): string | null {
  const def = FIXTURES[t], have = s.shop.fixtures.filter((f) => f.type === t).length;
  if (!def.looks && !def.curb) return null;
  if (have >= (def.looksCap ?? 1)) return 'Enough of these for looks already: more add nothing';
  // Decor and kerb appeal top out at 100%: once there, more of anything adds nothing.
  const l = looksOf(s), gain = def.looks ? Math.min(def.looks, 1 - l.decor) : Math.min(def.curb!, 1 - l.curb);
  if (gain < 0.005) return def.looks ? 'Decor is full already: more add nothing' : 'Kerb appeal is full already: more add nothing';
  return `+${Math.round(gain * 100)}% ${def.looks ? 'looks' : 'kerb appeal'} (${have + 1} of ${def.looksCap ?? 1} count)`;
}

/** What a piece is for: what the furniture does, or the note above. */
const noteFor = (t: FixtureType): string | undefined => FURNITURE_USE[t] ?? NOTES[t];

/** The swatch for a surface on the lot. */
function surfaceSwatch(id: string | null): string {
  switch (id) {
    case 'asphalt': return '#6E717C';
    case 'concrete': return 'linear-gradient(90deg, #C4C0B8 0 47%, #A39E95 47% 53%, #BBB6AD 53%)';
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
    case 'marble': return 'linear-gradient(0deg, #9AA0A8 0 10%, #F4F7FA 10%), linear-gradient(120deg, transparent 45%, #D8D8DC 46% 48%, transparent 49%)';
    case 'paint': return 'conic-gradient(#E8573F, #FFC044, #3FA87A, #4F8FE0, #9B6FE0, #E8573F)';
    default: return 'linear-gradient(0deg, #D8DADF 0 10%, #FFF3DC 10%)';
  }
}

/** The swatch for a floor finish: two tiles of its colours (carpet is laid in the shop's dark shade). */
function floorSwatch(id: string, sc: { dark: string; light: string }): string {
  const c: Record<string, [string, string]> = { lino: ['#FFF3DC', '#F3DEC0'], concrete: ['#C4C0B8', '#BBB6AD'], checker: ['#FFFFFF', '#38383D'], colour: ['#FFFFFF', sc.light], stone: ['#F4F7FA', '#E4E6EA'], wood: ['#D9A066', '#B8824C'],
    parquet: ['#C8925A', '#A87B45'], carpet: [sc.dark, sc.dark], terracotta: ['#C8693A', '#BF6235'], marble: ['#F4F7FA', '#E9DCC4'] };
  if (id === 'paint') return 'conic-gradient(#E8573F, #FFC044, #3FA87A, #4F8FE0, #9B6FE0, #E8573F)';
  if (id === 'photo') return 'linear-gradient(135deg, #A9D8F5 0 40%, #7CC26B 40% 60%, #3FA87A 60%)';
  const [a, b] = c[id] ?? ['#ddd', '#ccc'];
  if (id === 'parquet') return `repeating-linear-gradient(45deg, ${a} 0 6px, ${b} 6px 7px), repeating-linear-gradient(-45deg, ${a} 0 6px, ${b} 6px 7px)`;
  if (id === 'carpet') return `radial-gradient(${b} 1px, ${a} 1.5px) 0 0 / 4px 4px`;
  return id === 'wood' ? `repeating-linear-gradient(0deg, ${a} 0 8px, ${b} 8px 9px, #C99A62 9px 17px, ${b} 17px 18px)` : `conic-gradient(${a} 0 25%, ${b} 0 50%, ${a} 0 75%, ${b} 0)`;
}

export function BuildCard({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const s = runtime.state!;
  const b = snap.build;
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const gain = b.placing ? looksGain(s, b.placing) : null;
  const selected = b.selectedId !== null ? s.shop.fixtures.find((f) => f.id === b.selectedId) : null;
  const [tab, setTabState] = useState<Tab>(() => (runtime.buildTab as Tab | null) ?? (b.placing ? FIXTURES[b.placing].category : s.shop.fixtures.some((f) => f.type === 'register') ? 'shelves' : 'checkout'));
  // The Security tab shows what the cameras see while you place them (and stops when you leave it).
  const setTab = (t: Tab) => {
    runtime.rememberBuildTab(t); setTabState(t);
    if (t === 'security' && b.overlay === 'none') runtime.setOverlay('security');
    else if (t !== 'security' && b.overlay === 'security') runtime.setOverlay('none');
  };
  // (Opened again on the Security tab, as it was left: the cameras' view comes back on with it.)
  useEffect(() => { if (tab === 'security' && b.overlay === 'none') runtime.setOverlay('security'); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const thumbs = runtime.renderer?.fixtureThumbs ?? {};
  const items = (Object.keys(FIXTURES) as FixtureType[]).filter((t) => FIXTURES[t].category === tab && !FIXTURES[t].unlisted);
  const floor = s.shop.floorStyle ?? 'lino';
  const top = storeysOf(s.shop).top;
  return (
    <>
      {b.tool ? (
        <div className="item" style={{ background: b.valid ? '#e9f7f0' : '#fde3dd' }}>
          <div>
            <div className="name">{b.tool.kind === 'pave' ? (b.tool.surface ? `Laying ${SURFACES.find((x) => x.id === (b.tool as { surface: string }).surface)?.name.toLowerCase()}` : 'Back to grass') : b.tool.kind === 'grow' ? 'Adding floor' : b.tool.kind === 'sell' ? 'Selling floor' : b.tool.kind === 'push' ? 'Pushing a wall out' : b.tool.kind === 'pull' ? 'Pulling a wall in' : b.tool.kind === 'panel' ? 'Putting up ceiling panels' : b.tool.kind === 'unpanel' ? 'Taking down ceiling panels' : b.tool.kind === 'wall' ? `Walls: ${WALLS.find((x) => x.id === (b.tool as { style: string }).style)?.name.toLowerCase()}` : `Laying ${FLOORS.find((x) => x.id === (b.tool as { style: string }).style)?.name.toLowerCase()}`}</div>
            <div className="sub">{b.reason || (b.tool.kind === 'grow' ? 'Click a marked tile next to the shop' : b.tool.kind === 'wall' ? 'Click a stretch of wall' : b.tool.kind === 'push' || b.tool.kind === 'pull' ? 'Point at a wall round the shop' : b.tool.kind === 'pave' ? 'Click a tile of the lot' : 'Click a tile of floor')}{b.price > 0 ? ` · ${money(b.price)}` : b.price < 0 ? ` · ${money(-b.price)} back` : ''}</div>
            {/* (Not on a touch screen, where one finger dragging moves the view: it is a tap a tile there.) */}
            {b.tool.kind !== 'push' && b.tool.kind !== 'pull' && !runtime.eyedropper && !coarse && <div className="sub muted">Drag along a row to do a line of them at once</div>}
            {/* (Floor comes and goes without walls: where that leaves the shop open, said while it happens.) */}
            {(b.tool.kind === 'grow' || b.tool.kind === 'sell') && (() => {
              const n = openEdges(s.shop).length;
              return n ? <div className="sub need">Open to the outside on {n === 1 ? '1 edge' : `${n} edges`}: shoppers can walk in there. Walls tab to close it up</div> : null;
            })()}
          </div>
          <div className="row"><button className="btn small ghost" onClick={() => runtime.stopPlacing()}>Done</button></div>
        </div>
      ) : (b.placing || selected) ? (
        <div className="item" style={{ background: b.valid ? '#e9f7f0' : '#fde3dd' }}>
          <div>
            <div className="name">{b.placing ? FIXTURES[b.placing].name : `Moving ${FIXTURES[selected!.type].name}`}</div>
            {noteFor(b.placing ?? selected!.type) && <div className="sub">{noteFor(b.placing ?? selected!.type)}</div>}
            <div className="sub">{b.reason || (FIXTURES[b.placing ?? selected!.type].outdoor ? 'Point at the grass outside' : 'Point at a floor tile')}{b.price ? ` · ${money(b.price)}` : ''} · R turns</div>
            {gain && <div className="sub gain">{gain}</div>}
            {b.placing && VARIANTS[b.placing] && (
              <div className="row variant-pick" role="group" aria-label="Which look">
                <button className="btn small ghost" onClick={() => runtime.cycleVariant(-1)} aria-label="Previous look" title="[ or ,">‹</button>
                <span className="v-name">{VARIANTS[b.placing]![b.variant] ?? VARIANTS[b.placing]![0]}</span>
                <button className="btn small ghost" onClick={() => runtime.cycleVariant(1)} aria-label="Next look" title="] or .">›</button>
              </div>
            )}
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
        <span className="row"><button className="btn small ghost" disabled={!b.canUndo} onClick={() => runtime.undo()} title="Ctrl+Z">Undo</button><button className="btn small ghost" disabled={!b.canRedo} onClick={() => runtime.redo()} title="Ctrl+Y">Redo</button>
          <button className={`btn small ghost${snap.topView ? ' on' : ''}`} aria-pressed={snap.topView} onClick={() => runtime.setTopView(!snap.topView)} title="Look straight down on the floor you are building">Top view</button></span>
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
              <div className="item swatched">
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
          <p className="muted">Every wall is a piece: it stands on an edge of a tile, round the shop or across it. Point at a tile and press R to turn it to another side; drag along a row to put up a line. Click one to move, turn or sell it. The doors move too.</p>
          {(() => {
            // Where the floor meets the outside with no wall: shoppers (and shoplifters) can walk in and out there.
            const open = openEdges(s.shop).length, cost = wallUpPrice(s.shop);
            return open > 0 ? (
              <div className="item swatched open-edges">
                <div style={{ flex: 1 }}>
                  <div className="name">{open === 1 ? '1 edge open to the outside' : `${open} edges open to the outside`}</div>
                  <div className="sub">Shoppers, and shoplifters, can walk in and out there. Put walls up, or wall every gap at once ({money(cost)}, glass along the front).</div>
                </div>
                <button className="btn small" disabled={s.cash < cost} onClick={() => runtime.wallUpGaps()}>Wall up the gaps</button>
              </div>
            ) : null;
          })()}
          <h3>Move a whole wall</h3>
          <p className="muted">Point at a wall round the shop: push it out a row (the floor beyond it bought, the walls either side stretched to meet it), or pull it in (the row behind it sold back).</p>
          <div className="row wall-move">
            <button className={`btn small${b.tool?.kind === 'push' ? ' ghost' : ''}`} onClick={() => (b.tool?.kind === 'push' ? runtime.stopPlacing() : runtime.startTool({ kind: 'push' }))}>{b.tool?.kind === 'push' ? 'Done' : 'Push a wall out'}</button>
            <button className={`btn small ghost`} onClick={() => (b.tool?.kind === 'pull' ? runtime.stopPlacing() : runtime.startTool({ kind: 'pull' }))}>{b.tool?.kind === 'pull' ? 'Done' : 'Pull a wall in'}</button>
          </div>
          <h3>Finish</h3>
          <div className="list">
            {WALLS.map((w) => {
              const on = b.tool?.kind === 'wall' && b.tool.style === w.id;
              return (
                <div className="item swatched" key={w.id}>
                  <span className="swatch big" style={{ background: wallSwatch(w.id, schemeById(s.shop.scheme)) }} aria-hidden="true" />
                  <div style={{ flex: 1 }}><div className="name">{w.name}</div><div className="sub">{w.perSeg ? `${money(w.perSeg)} a stretch` : 'Comes with the shop · puts back a finish'}</div></div>
                  {w.id === 'paint' && <PaintPicker runtime={runtime} kind="wall" />}
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
              <div className="item swatched" key={fl.id}>
                <span className="swatch big" style={{ background: floorSwatch(fl.id, schemeById(s.shop.scheme)) }} aria-hidden="true" />
                <div style={{ flex: 1 }}><div className="name">{fl.name}</div><div className="sub">{fl.perTile ? `${money(fl.perTile)} a tile` : 'Comes with the shop · puts back a finish'}{fl.id === floor && !s.shop.tileStyles ? ' · down now' : ''}</div></div>
                {fl.id === 'paint' && <PaintPicker runtime={runtime} kind="floor" />}
                {fl.id === 'photo' && <PhotoPicker runtime={runtime} has={!!s.shop.floorImage} />}
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
            const pieces = s.shop.fixtures.filter((f) => f.type === 'parkingBay'), n = pieces.length;
            const stranded = pieces.filter((f) => !bayReachable(s.shop, f)).length, on = b.placing === 'parkingBay';
            return (
              <div className="item swatched">
                <span className="swatch big" style={{ background: 'repeating-linear-gradient(90deg, #6E717C 0 14px, #F2F2F2 14px 16px)' }} aria-hidden="true" />
                <div style={{ flex: 1 }}>
                  <div className="name">{n === 1 ? '1 bay' : `${n} bays`}</div>
                  <div className="sub">Put a bay anywhere on the lot ({money(BAY_PRICE)}, and its tarmac). Cars come in where tarmac meets the sidewalk and drive on tarmac to a bay&apos;s open end.</div>
                  {stranded > 0 && <div className="sub need">{stranded === 1 ? '1 bay has' : `${stranded} bays have`} no tarmac from the road to its open end: no car can get there</div>}
                </div>
                <button className={`btn small${on ? ' ghost' : ''}`} disabled={!on && s.cash < BAY_PRICE} onClick={() => (on ? runtime.stopPlacing() : runtime.startPlacing('parkingBay'))}>{on ? 'Done' : 'Place a bay'}</button>
              </div>
            );
          })()}
          {(() => {
            const truck = !!truckStop(s.shop);
            return (
              <div className="item swatched">
                <span className="swatch big" style={{ background: truck ? '#6E717C' : '#7CC26B' }} aria-hidden="true" />
                <div style={{ flex: 1 }}>
                  <div className="name">{truck ? 'Deliveries come to the back door' : 'Deliveries are unloaded at the kerb'}</div>
                  <div className={truck ? 'sub' : 'sub need'}>{truck ? 'The truck drives round on the tarmac: keep a way through for it.' : 'Lay tarmac from the road round to the back door and the truck drives up to it.'}</div>
                </div>
              </div>
            );
          })()}
          <h3>Surfaces</h3>
          <div className="list">
            {[...SURFACES, { id: null, name: 'Grass', perTile: 0 }].map((sf) => {
              const note = sf.id === 'asphalt' ? 'cars drive on it' : sf.id === 'concrete' ? 'plain and cheap' : 'smartens up the frontage';
              const on = b.tool?.kind === 'pave' && b.tool.surface === sf.id;
              return (
                <div className="item swatched" key={sf.id ?? 'grass'}>
                  <span className="swatch big" style={{ background: surfaceSwatch(sf.id) }} aria-hidden="true" />
                  <div style={{ flex: 1 }}><div className="name">{sf.name}</div><div className="sub">{sf.perTile ? `${money(sf.perTile)} a tile · ${note}` : 'Digs up anything laid (the paths and car park too), for part of what it cost'}</div></div>
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
          <p className="muted">Push a wall out a whole row at a time (it moves out with the floor), or add or sell floor a tile at a time, up to {MAX_FLOOR.x1 - MAX_FLOOR.x0} × {MAX_FLOOR.z1 - MAX_FLOOR.z0} tiles on this plot. Tiles come and go without walls: put them up where you want them (Walls tab). Then build up: stairs open a floor above (Upstairs tab).</p>
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
          <ShopFront runtime={runtime} />
          <CornerForSale runtime={runtime} />
          <StoresSection runtime={runtime} snap={snap} />
        </>
      )}
    </>
  );
}

/**
 * The front of the shop: the sign (each one up gets the shop noticed by more of the people going past), a
 * slogan for the pylon, and a loading bay at the back door.
 */
function ShopFront({ runtime }: { runtime: GameRuntime }) {
  const s = runtime.state!;
  const tier = signTier(s.shop);
  const [slogan, setSlogan] = useState(s.shop.slogan ?? '');
  const save = () => { if ((s.shop.slogan ?? '') !== slogan.trim()) runtime.dispatch({ type: 'setSlogan', text: slogan }); };
  return (
    <>
      <h3>Shop sign</h3>
      <p className="muted">A brighter sign gets the shop noticed: more of the people going past come in.</p>
      {SIGN_TIERS.map((t, i) => {
        const price = signPrice(s, t.id), up = i === tier;
        return (
          <div className={`item${up ? ' current' : ''}`} key={t.id}>
            <div><div className="name">{t.name}{up && <span className="tag">Up now</span>}</div><div className="sub">{t.blurb}{t.id === 'lit' && !s.goals.unlocked.includes('signLit') && !s.sandbox && !s.shop.signBought ? ' Free with the Regulars goal.' : ''}</div></div>
            {!up && <button className={`btn small${price ? '' : ' ghost'}`} disabled={price > s.cash} onClick={() => runtime.dispatch({ type: 'signStyle', style: t.id })}>{price ? `Buy ${money(price)}` : 'Put up'}</button>}
          </div>
        );
      })}
      <div className="item slogan">
        <div style={{ flex: 1 }}>
          <div className="name">Slogan</div>
          <div className="sub">On a panel under the pylon's board{tier >= 3 ? ', running across the LED board' : ''}.</div>
          <input className="text-in" type="text" maxLength={SLOGAN_MAX} placeholder="Fresh every day" value={slogan} onChange={(e) => setSlogan(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') { save(); (e.target as HTMLInputElement).blur(); } e.stopPropagation(); }} aria-label="Shop slogan" />
        </div>
      </div>
      <h3>Loading bay</h3>
      <div className="item">
        <div><div className="name">{s.shop.loadingBay ? 'Loading bay built' : `Loading bay · ${money(LOADING_BAY_PRICE)}`}</div><div className="sub">A dock at the back door: trucks come {Math.round((1 - BAY_ETA) * 100)}% sooner and unload in half the time.</div></div>
        {!s.shop.loadingBay && <button className="btn small" disabled={s.cash < LOADING_BAY_PRICE} onClick={() => runtime.dispatch({ type: 'buyLoadingBay' })}>Build</button>}
      </div>
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
