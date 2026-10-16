import { useMemo, useState } from 'react';
import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { PRODUCTS, CATEGORY_NAMES, productDef, type Category } from '@/sim/products';
import { SUPPLIERS, unitCost, deliveryStatus } from '@/sim/economy';
import { FIXTURES, storageCap } from '@/sim/layout';
import { money, ProductPic } from '../useRuntime';
import { savedOrderCost, ruleText, MAX_SAVED } from '@/sim/savedOrders';
import type { OrderRule, SavedOrder } from '@/sim/types';

export function StockCard({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const s = runtime.state!;
  void snap.stateVersion;
  const [supplierId, setSupplierId] = useState('local');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [saveName, setSaveName] = useState('');
  // Opened from a shelf: start at the products that go on it (a chiller's dairy, a stand's produce).
  const [cat, setCat] = useState<Category | 'all'>(() => {
    const t = runtime.takeStockFor();
    if (!t) return 'all';
    const def = FIXTURES[t];
    return def.accepts?.[0] ?? (def.chilled ? 'dairy' : 'all');
  });
  const lines = Object.entries(qty).filter(([, q]) => q > 0).map(([productId, q]) => ({ productId, qty: q }));
  const costWith = (sid: string) => Math.round(lines.reduce((a, l) => a + l.qty * unitCost(l.productId, sid, s), 0) * 100) / 100;
  const sup = SUPPLIERS.find((x) => x.id === supplierId)!;
  const total = costWith(supplierId);
  const short = lines.length > 0 && total < sup.minOrder;
  const onShelf = useMemo(() => {
    const m = new Map<string, { qty: number; cap: number }>();
    for (const f of s.shop.fixtures) for (const sl of f.slots) if (sl.productId) { const e = m.get(sl.productId) ?? { qty: 0, cap: 0 }; e.qty += sl.qty; e.cap += FIXTURES[f.type].capacity; m.set(sl.productId, e); }
    return m;
  }, [s.shop.fixtures, snap.stateVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const inStore = (id: string) => s.shop.storage.filter((e) => e.productId === id).reduce((a, e) => a + e.qty, 0);
  const storageUnits = s.shop.storage.reduce((a, e) => a + e.qty, 0);
  const pending = s.orders.filter((o) => o.state !== 'delivered');
  const visible = PRODUCTS.filter((p) => cat === 'all' ? (onShelf.has(p.id) || inStore(p.id) > 0 || (qty[p.id] ?? 0) > 0 || p.demand >= 1.2) : p.category === cat);
  const units = lines.reduce((a, l) => a + l.qty, 0);
  // In setup the trucks come at once (the clock stands still until you open).
  const etaOf = (sid: string) => s.phase === 'setup' ? Math.min(SUPPLIERS.find((x) => x.id === sid)!.etaSeconds, 20) : SUPPLIERS.find((x) => x.id === sid)!.etaSeconds;

  return (
    <div className="stock-layout">
      <section className="stock-goods">
        <div className="row cats" role="tablist" aria-label="Products">
          <button role="tab" aria-selected={cat === 'all'} className={`btn small ${cat === 'all' ? '' : 'ghost'}`} onClick={() => setCat('all')}>Popular</button>
          {(Object.keys(CATEGORY_NAMES) as Category[]).map((c) => <button key={c} role="tab" aria-selected={cat === c} className={`btn small ${cat === c ? '' : 'ghost'}`} onClick={() => setCat(c)}>{CATEGORY_NAMES[c]}</button>)}
        </div>
        <div className="list goods">
          {visible.map((p) => {
            const shelf = onShelf.get(p.id), n = qty[p.id] ?? 0;
            return (
              <div className={`item${n > 0 ? ' picked' : ''}`} key={p.id}>
                <div className="what">
                  <div className="name"><ProductPic runtime={runtime} id={p.id} color={p.color} /><span>{p.name}</span>{p.chilled && <span className="tag cold">fridge</span>}</div>
                  <div className="sub">{money(unitCost(p.id, supplierId, s))} each · sells {money(s.prices[p.id] ?? p.basePrice)}</div>
                  {(shelf || inStore(p.id) > 0) && <div className="sub">{shelf ? `${shelf.qty} on your shelves` : ''}{shelf && inStore(p.id) ? ' · ' : ''}{inStore(p.id) ? `${inStore(p.id)} on the pallet` : ''}</div>}
                </div>
                <div className="stepper">
                  <button onClick={() => setQty({ ...qty, [p.id]: Math.max(0, n - 6) })} aria-label={`Fewer ${p.name}`}>−</button>
                  <span className="val">{n}</span>
                  <button onClick={() => setQty({ ...qty, [p.id]: n + 6 })} aria-label={`More ${p.name}`}>+</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <aside className="stock-side">
        <h3>Who delivers</h3>
        <div className="suppliers" role="radiogroup" aria-label="Supplier">
          {SUPPLIERS.map((x) => {
            const look = SUPPLIER_LOOK[x.id] ?? { tagline: x.blurb, badge: '' };
            const cost = costWith(x.id), under = lines.length > 0 && cost < x.minOrder;
            return (
              <button key={x.id} role="radio" aria-checked={supplierId === x.id} className={`supplier s-${x.id}${supplierId === x.id ? ' on' : ''}`} onClick={() => setSupplierId(x.id)}>
                <span className="s-top"><b>{x.name}</b>{look.badge && <span className="s-badge">{look.badge}</span>}</span>
                <span className="s-line">{look.tagline}</span>
                <span className="s-chips">
                  <span className="chip">{x.priceMul < 1 ? `${Math.round((1 - x.priceMul) * 100)}% cheaper` : x.priceMul > 1 ? `${Math.round((x.priceMul - 1) * 100)}% dearer` : 'Usual prices'}</span>
                  <span className="chip">Here in {arrival(etaOf(x.id))}</span>
                  <span className="chip">{x.terms ? `Pay in ${x.terms} days` : 'Pay now'}</span>
                  {x.minOrder > 0 && <span className={`chip${under ? ' warn' : ''}`}>${x.minOrder} minimum</span>}
                </span>
                {lines.length > 0 && <span className="s-cost">This order: <b>{money(cost)}</b>{under ? ` · add ${money(x.minOrder - cost)} more` : ''}</span>}
              </button>
            );
          })}
        </div>
        <div className="basket">
          <div className="row between"><span>{units > 0 ? `${units} units` : 'Nothing picked yet'}</span><b className="total">Total {money(total)}</b></div>
          <button className="btn big" disabled={lines.length === 0 || short} onClick={() => { const r = runtime.dispatch({ type: 'placeOrder', supplierId, lines }); if (r.ok) { setQty({}); runtime.showToast('Order placed. The truck is on its way.'); } }}>Place order</button>
          {short && <p className="muted">{sup.name} takes orders of {money(sup.minOrder)} or more.</p>}
          {total > s.cash && !sup.terms && <p className="muted">You have {money(s.cash)}.</p>}
          {lines.length > 0 && (s.savedOrders?.length ?? 0) < MAX_SAVED && (
            <div className="row between save-order">
              <input type="text" value={saveName} maxLength={30} placeholder={`Order ${(s.savedOrders?.length ?? 0) + 1}`} onChange={(e) => setSaveName(e.target.value)} aria-label="Name for this order" />
              <button className="btn small ghost" onClick={() => { const r = runtime.dispatch({ type: 'saveOrder', name: saveName, supplierId, lines }); if (r.ok) { setSaveName(''); runtime.showToast('Saved: it is under Saved orders.'); } else if (r.message) runtime.showToast(r.message); }}>Save this order</button>
            </div>
          )}
        </div>
        <div className="row between"><h3>On the delivery pallet</h3><span className="tag">{storageUnits} / {storageCap(s.shop)} units</span></div>
        <p className="muted">Boxes wait on the pallet by the back door: F to pick one up, F at a shelf to stock it.</p>
        {pending.length > 0 && (
          <div className="list">
            {pending.map((o) => <div className="item" key={o.id}><div><div className="name">Truck from {SUPPLIERS.find((x) => x.id === o.supplierId)?.name}</div><div className="sub">{o.lines.reduce((a, l) => a + l.qty, 0)} units · {money(o.total)}</div></div>{(() => { const st = deliveryStatus(s, o); return <span className={`tag${st.here ? ' good' : ''}`}>{st.text}</span>; })()}</div>)}
          </div>
        )}
        <SavedOrders runtime={runtime} />
        <p className="muted">{productDef('milk').chilled ? 'Fridge goods need a chiller or tall fridge on the floor.' : ''}</p>
      </aside>
    </div>
  );
}

/** What each supplier is for, at a glance. */
const SUPPLIER_LOOK: Record<string, { tagline: string; badge: string }> = {
  local: { tagline: 'Everyday prices, no fuss', badge: 'All-rounder' },
  bulk: { tagline: 'Cheapest when you buy a lot', badge: 'Best in bulk' },
  express: { tagline: 'Fastest to your back door', badge: 'Fastest' },
};
/** Game seconds are game minutes: "40 min", "1½ hours", "3 hours". */
function arrival(secs: number): string {
  if (secs < 60) return `${Math.round(secs)} min`;
  const h = secs / 60, whole = Math.floor(h), half = h - whole >= 0.25 && h - whole < 0.75;
  return `${whole}${half ? '½' : ''} hour${h > 1.2 ? 's' : ''}`;
}

/** The conditions a manager can place a saved order on. */
const RULES: { kind: OrderRule['kind']; label: string }[] = [
  { kind: 'never', label: 'Only when I place it' }, { kind: 'daily', label: 'Every morning' }, { kind: 'everyDays', label: 'Every few days' },
  { kind: 'palletBelow', label: 'When the pallet runs low' }, { kind: 'productBelow', label: 'When a product runs low' },
];
function ruleOf(kind: OrderRule['kind'], o: SavedOrder): OrderRule {
  switch (kind) {
    case 'everyDays': return { kind, days: 3 };
    case 'palletBelow': return { kind, units: 30 };
    case 'productBelow': return { kind, productId: o.lines[0]!.productId, units: 10 };
    default: return { kind };
  }
}

/** Orders you saved: place one again, or tell the manager when to. */
function SavedOrders({ runtime }: { runtime: GameRuntime }) {
  const s = runtime.state!;
  const list = s.savedOrders ?? [];
  if (!list.length) return null;
  const manager = s.people.some((p) => p.kind === 'staff' && p.role === 'manager');
  const edit = (id: number, patch: Partial<Pick<SavedOrder, 'name' | 'when' | 'minCash'>>) => runtime.dispatch({ type: 'editSavedOrder', id, patch });
  return (
    <>
      <h3>Saved orders</h3>
      <p className="muted">{manager ? 'Your manager places each one when its condition comes true (once a day at most).' : 'Hire a manager (Staff) and they place these for you when you say.'}</p>
      <div className="list">
        {list.map((o) => {
          const r = o.when;
          return (
            <div className="item saved-order" key={o.id}>
              <div style={{ flex: 1 }}>
                <div className="name">{o.name}</div>
                <div className="sub">{o.lines.map((l) => `${l.qty} ${productDef(l.productId).name.toLowerCase()}`).join(', ')} · {money(savedOrderCost(s, o))}</div>
                <div className="row" style={{ flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  <select value={r.kind} aria-label={`When to place ${o.name}`} onChange={(e) => edit(o.id, { when: ruleOf(e.target.value as OrderRule['kind'], o) })}>
                    {RULES.map((x) => <option key={x.kind} value={x.kind}>{x.label}</option>)}
                  </select>
                  {r.kind === 'everyDays' && <label className="row">every <input type="number" min={2} max={14} value={r.days} onChange={(e) => edit(o.id, { when: { kind: 'everyDays', days: Math.max(2, Math.min(14, Number(e.target.value) || 2)) } })} /> days</label>}
                  {r.kind === 'palletBelow' && <label className="row">under <input type="number" min={0} value={r.units} onChange={(e) => edit(o.id, { when: { kind: 'palletBelow', units: Math.max(0, Number(e.target.value) || 0) } })} /> units</label>}
                  {r.kind === 'productBelow' && (
                    <>
                      <select value={r.productId} aria-label="Which product" onChange={(e) => edit(o.id, { when: { ...r, productId: e.target.value } })}>
                        {o.lines.map((l) => <option key={l.productId} value={l.productId}>{productDef(l.productId).name}</option>)}
                      </select>
                      <label className="row">under <input type="number" min={0} value={r.units} onChange={(e) => edit(o.id, { when: { ...r, units: Math.max(0, Number(e.target.value) || 0) } })} /></label>
                    </>
                  )}
                  {r.kind !== 'never' && <label className="row">keep {'$'}<input type="number" min={0} step={50} value={o.minCash} onChange={(e) => edit(o.id, { minCash: Number(e.target.value) || 0 })} /> in the till</label>}
                </div>
                <div className="sub">{ruleText(r)}{o.lastDay !== undefined ? ` · last placed day ${o.lastDay}` : ''}</div>
              </div>
              <span className="row" style={{ flexDirection: 'column', gap: 4 }}>
                <button className="btn small" disabled={s.cash < savedOrderCost(s, o)} onClick={() => { const res = runtime.dispatch({ type: 'placeSavedOrder', id: o.id }); runtime.showToast(res.ok ? 'Order placed. The truck is on its way.' : res.message ?? 'Could not place it.'); }}>Order now</button>
                <button className="btn small ghost" onClick={() => runtime.dispatch({ type: 'deleteSavedOrder', id: o.id })}>Delete</button>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
