import { useEffect, useRef } from 'react';
import type { GameRuntime, Snapshot, StockFilter } from '@/app/GameRuntime';
import { FIXTURES } from '@/sim/layout';
import { productDef } from '@/sim/products';
import { keyLabel } from '@/save/settings';
import type { Fixture } from '@/sim/types';

const FILTERS: { id: StockFilter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'low', label: 'Low' }, { id: 'empty', label: 'Empty' }, { id: 'chilled', label: 'Fridges' }];

/** How full a shelf is (units on it, and what it holds). */
function fill(f: Fixture): { qty: number; cap: number } {
  const def = FIXTURES[f.type];
  return { qty: f.slots.reduce((a, s) => a + s.qty, 0), cap: def.slots * def.capacity };
}

/**
 * The stock tool: a bar across the top (what it does, Supply to fill every shelf, filters, a search for
 * a product) and a label over every shelf, red, yellow or green by how full it is. A click on a shelf (or
 * a drag along a row) fills it from the pallet.
 */
export function StockTool({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const host = useRef<HTMLDivElement>(null);
  const t = snap.stockTool;
  useEffect(() => {
    let raf = 0;
    const nodes = new Map<number, HTMLDivElement>();
    const proj = { x: 0, y: 0, visible: false };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const s = runtime.state, r = runtime.renderer, el = host.current;
      if (!s || !r || !el) return;
      const { filter, find } = runtime.getSnapshot().stockTool;
      const q = find.trim().toLowerCase();
      const seen = new Set<number>();
      for (const f of s.shop.fixtures) {
        if (!FIXTURES[f.type].slots) continue;
        const { qty, cap } = fill(f), k = cap ? qty / cap : 0;
        const match = q ? f.slots.some((sl) => sl.productId && productDef(sl.productId).name.toLowerCase().includes(q)) : true;
        const show = match && (filter === 'all' || (filter === 'low' && k < 0.4) || (filter === 'empty' && qty === 0) || (filter === 'chilled' && FIXTURES[f.type].chilled));
        const a = runtime.fixtureAnchor(f.id);
        if (!show || !a || !runtime.fixtureInSight(f.id)) continue;
        r.project(a.x, a.y + 0.15, a.z, proj);
        if (!proj.visible) continue;
        seen.add(f.id);
        let n = nodes.get(f.id);
        if (!n) { n = document.createElement('div'); n.className = 'stock-label'; n.innerHTML = '<b></b><i><u></u></i>'; el.appendChild(n); nodes.set(f.id, n); }
        const tone = qty === 0 ? 'empty' : k < 0.4 ? 'low' : k < 0.8 ? 'mid' : 'full';
        n.className = `stock-label ${tone}${q ? ' found' : ''}`;
        (n.firstChild as HTMLElement).textContent = `${qty}/${cap}`;
        ((n.lastChild as HTMLElement).firstChild as HTMLElement).style.width = `${Math.round(k * 100)}%`;
        n.style.transform = `translate(${Math.round(proj.x)}px, ${Math.round(proj.y)}px) translate(-50%, -100%)`;
      }
      for (const [id, n] of nodes) if (!seen.has(id)) { n.remove(); nodes.delete(id); }
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); for (const n of nodes.values()) n.remove(); };
  }, [runtime]);
  const units = runtime.state?.shop.storage.reduce((a, e) => a + e.qty, 0) ?? 0;
  // On a touch screen a drag pans the camera: a tap fills one shelf.
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return (
    <>
      <div ref={host} className="stock-labels" aria-hidden="true" />
      <div className="stock-bar" role="toolbar" aria-label="Stock tool" onPointerDown={(e) => e.stopPropagation()}>
        <div className="sb-head">
          <span className="sb-title">Stock tool <kbd>{keyLabel(snap.settings.keys.stockTool)}</kbd></span>
          <span className="sb-help">{touch ? 'Tap a shelf to fill it from the pallet.' : 'Click a shelf to fill it from the pallet, or drag along a row.'}</span>
          <span className="sb-help"><b>{units}</b> unit{units === 1 ? '' : 's'} on the pallet</span>
        </div>
        <div className="sb-row">
          <button className="btn small" onClick={() => runtime.supplyAll()} disabled={!units} title="Fill every shelf from the pallet, the emptiest first">Supply all</button>
          <div className="sb-filters" role="group" aria-label="Show">
            {FILTERS.map((f) => <button key={f.id} className={`sb-chip${t.filter === f.id ? ' on' : ''}`} aria-pressed={t.filter === f.id} onClick={() => runtime.setStockFilter(f.id)}>{f.label}</button>)}
          </div>
          <input className="sb-find" type="search" placeholder="Find a product" value={t.find} onChange={(e) => runtime.setStockFind(e.target.value)} aria-label="Find a product on the shelves" />
          <button className="btn small ghost" onClick={() => runtime.setStockTool(false)}>Done</button>
        </div>
      </div>
    </>
  );
}
