import { useMemo, useState } from 'react';
import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { PRODUCTS, CATEGORY_NAMES, productDef, type Category } from '@/sim/products';
import { SUPPLIERS, unitCost } from '@/sim/economy';
import { FIXTURES } from '@/sim/layout';
import { money } from '../useRuntime';

export function StockCard({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const s = runtime.state!;
  void snap.stateVersion;
  const [supplierId, setSupplierId] = useState('local');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [cat, setCat] = useState<Category | 'all'>('all');
  const sup = SUPPLIERS.find((x) => x.id === supplierId)!;
  const lines = Object.entries(qty).filter(([, q]) => q > 0).map(([productId, q]) => ({ productId, qty: q }));
  const total = lines.reduce((a, l) => a + l.qty * unitCost(l.productId, supplierId), 0);
  const onShelf = useMemo(() => {
    const m = new Map<string, { qty: number; cap: number }>();
    for (const f of s.shop.fixtures) for (const sl of f.slots) if (sl.productId) { const e = m.get(sl.productId) ?? { qty: 0, cap: 0 }; e.qty += sl.qty; e.cap += FIXTURES[f.type].capacity; m.set(sl.productId, e); }
    return m;
  }, [s.shop.fixtures, snap.stateVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const inStore = (id: string) => s.shop.storage.filter((e) => e.productId === id).reduce((a, e) => a + e.qty, 0);
  const storageUnits = s.shop.storage.reduce((a, e) => a + e.qty, 0);
  const pending = s.orders.filter((o) => o.state !== 'delivered');
  const visible = PRODUCTS.filter((p) => cat === 'all' ? (onShelf.has(p.id) || inStore(p.id) > 0 || (qty[p.id] ?? 0) > 0 || p.demand >= 1.2) : p.category === cat);

  return (
    <>
      <div className="row between"><h3>On the delivery pallet</h3><span className="tag">{storageUnits} / {s.shop.storageCapacity} units</span></div>
      <p className="muted">Boxes wait on the pallet by the back door. Walk over, press E to pick one up, then look at a shelf and press E to stock it.</p>
      {pending.length > 0 && (
        <div className="list">
          {pending.map((o) => <div className="item" key={o.id}><div><div className="name">Truck from {SUPPLIERS.find((x) => x.id === o.supplierId)?.name}</div><div className="sub">{o.lines.reduce((a, l) => a + l.qty, 0)} units · {money(o.total)}</div></div><span className="tag good">{o.state === 'arriving' ? 'At the back door' : `${Math.ceil(o.eta / 60)} h`}</span></div>)}
        </div>
      )}
      <div className="row between"><h3>Order stock</h3>
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="Supplier">{SUPPLIERS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      </div>
      <p className="muted">{sup.blurb}</p>
      <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
        <button className={`btn small ${cat === 'all' ? '' : 'ghost'}`} onClick={() => setCat('all')}>Popular</button>
        {(Object.keys(CATEGORY_NAMES) as Category[]).map((c) => <button key={c} className={`btn small ${cat === c ? '' : 'ghost'}`} onClick={() => setCat(c)}>{CATEGORY_NAMES[c]}</button>)}
      </div>
      <div className="list">
        {visible.map((p) => {
          const shelf = onShelf.get(p.id);
          return (
            <div className="item" key={p.id}>
              <div>
                <div className="name"><span className="swatch" style={{ background: p.color }} />{p.name} {p.chilled && <span className="tag cold">cold</span>}</div>
                <div className="sub">{money(unitCost(p.id, supplierId))} each · sells {money(s.prices[p.id] ?? p.basePrice)} · {shelf ? `${shelf.qty}/${shelf.cap} on shelf` : 'not on a shelf'}{inStore(p.id) ? ` · ${inStore(p.id)} in back` : ''}</div>
              </div>
              <div className="stepper">
                <button onClick={() => setQty({ ...qty, [p.id]: Math.max(0, (qty[p.id] ?? 0) - 6) })} aria-label={`Fewer ${p.name}`}>−</button>
                <span className="val">{qty[p.id] ?? 0}</span>
                <button onClick={() => setQty({ ...qty, [p.id]: (qty[p.id] ?? 0) + 6 })} aria-label={`More ${p.name}`}>+</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="row between">
        <b>Total {money(total)}</b>
        <button className="btn" disabled={lines.length === 0} onClick={() => { const r = runtime.dispatch({ type: 'placeOrder', supplierId, lines }); if (r.ok) { setQty({}); runtime.showToast('Order placed. The truck is on its way.'); } }}>Place order</button>
      </div>
      {total > s.cash && <p className="muted">You have {money(s.cash)}.</p>}
      <p className="muted">{productDef('milk').chilled ? 'Chilled goods need a fridge on the floor.' : ''}</p>
    </>
  );
}
