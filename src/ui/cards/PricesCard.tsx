import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { PRODUCTS } from '@/sim/products';
import { money } from '../useRuntime';

export function PricesCard({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const s = runtime.state!;
  void snap.stateVersion;
  const stocked = new Set<string>();
  for (const f of s.shop.fixtures) for (const sl of f.slots) if (sl.productId) stocked.add(sl.productId);
  const inBack = new Set(s.shop.storage.map((e) => e.productId));
  const list = PRODUCTS.filter((p) => stocked.has(p.id) || inBack.has(p.id));
  const set = (id: string, price: number) => runtime.dispatch({ type: 'setPrice', productId: id, price });
  return (
    <>
      <p className="muted">Town average in grey. Bargain hunters notice anything over it; everyone leaves when it is far over.</p>
      <div className="list">
        {list.map((p) => {
          const price = s.prices[p.id] ?? p.basePrice;
          const r = price / p.basePrice;
          const tag = r > 1.35 ? <span className="tag bad">Pricey</span> : r > 1.1 ? <span className="tag">A bit high</span> : r < 0.9 ? <span className="tag good">Bargain</span> : <span className="tag good">Fair</span>;
          return (
            <div className="item" key={p.id}>
              <div>
                <div className="name"><span className="swatch" style={{ background: p.color }} />{p.name} {tag}</div>
                <div className="sub">avg {money(p.basePrice)} · cost {money(p.cost)} · margin {Math.round(((price - p.cost) / price) * 100)}%</div>
              </div>
              <div className="stepper">
                <button onClick={() => set(p.id, price - 0.1)} aria-label={`Lower ${p.name} price`}>−</button>
                <span className="val">{money(price)}</span>
                <button onClick={() => set(p.id, price + 0.1)} aria-label={`Raise ${p.name} price`}>+</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="row between">
        <button className="btn small ghost" onClick={() => list.forEach((p) => set(p.id, p.basePrice))}>Reset to average</button>
        <button className="btn small ghost" onClick={() => list.forEach((p) => set(p.id, Math.round(p.basePrice * 1.1 * 20) / 20))}>All +10%</button>
      </div>
    </>
  );
}
