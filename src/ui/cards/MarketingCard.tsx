import { useState } from 'react';
import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { FLYER_AREAS, BILLBOARD_SITES, AD_COST, adHeadline } from '@/sim/marketing';
import { TYPE_NAMES } from '@/sim/customers';
import { productDef } from '@/sim/products';
import type { CustomerType, AdTemplate } from '@/sim/types';
import { money } from '../useRuntime';

export function MarketingCard({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const s = runtime.state!;
  void snap.stateVersion;
  const m = s.marketing;
  const stocked = [...new Set(s.shop.fixtures.flatMap((f) => f.slots.map((sl) => sl.productId)).filter((x): x is string => !!x))];
  const [adKind, setAdKind] = useState<AdTemplate['kind']>('discount');
  const [adProduct, setAdProduct] = useState(stocked[0] ?? '');
  const [adTarget, setAdTarget] = useState<CustomerType>('bargain');
  const [promoProduct, setPromoProduct] = useState(stocked[0] ?? '');
  return (
    <>
      <h3>Awareness {Math.round(s.shop.awareness * 100)}%</h3>
      <div className="bar"><div style={{ width: `${Math.round(s.shop.awareness * 100)}%` }} /></div>
      <h3>Flyers (fade over 4 days)</h3>
      <div className="list">
        {FLYER_AREAS.map((a) => { const live = m.campaigns.find((c) => c.areaId === a.id); return (
          <div className="item" key={a.id}><div><div className="name">{a.name} <span className="tag">{a.km} km {a.dir}</span></div><div className="sub">{money(a.cost)} · {live ? `running, day ${s.day - live.startDay + 1} of 4` : 'not running'}</div></div><button className="btn small" disabled={!!live || s.cash < a.cost} onClick={() => runtime.dispatch({ type: 'flyers', areaId: a.id })}>Send</button></div>
        ); })}
      </div>
      <h3>Billboards (daily rent)</h3>
      <div className="list">
        {BILLBOARD_SITES.map((b) => { const on = m.billboards.includes(b.id); return (
          <div className="item" key={b.id}><div><div className="name">{b.name}</div><div className="sub">{money(b.rent)}/day{on ? ' · rented' : ''}</div></div><button className={`btn small${on ? ' danger' : ''}`} onClick={() => runtime.dispatch({ type: 'billboard', siteId: b.id })}>{on ? 'Stop' : 'Rent'}</button></div>
        ); })}
      </div>
      <h3>Outside sign</h3>
      <div className="item"><div><div className="name">Lit sign over the lot</div><div className="sub">{m.outsideSign ? 'Up. Everyone on the road sees you.' : `${money(150)} once. Raises awareness every day.`}</div></div>{!m.outsideSign && <button className="btn small" disabled={s.cash < 150} onClick={() => runtime.dispatch({ type: 'outsideSign', on: true })}>Buy</button>}</div>
      <h3>Ad ({money(AD_COST)}/day)</h3>
      {m.ad ? (
        <div className="item"><div><div className="name">"{adHeadline(m.ad)}"</div><div className="sub">Promise it and stock it, or reputation suffers.</div></div><button className="btn small danger" onClick={() => runtime.dispatch({ type: 'ad', ad: null })}>Stop</button></div>
      ) : (
        <>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <select value={adKind} onChange={(e) => setAdKind(e.target.value as AdTemplate['kind'])} aria-label="Ad type"><option value="product">Product</option><option value="discount">Discount</option><option value="target">Shopper type</option></select>
            {adKind !== 'target' && <select value={adProduct} onChange={(e) => setAdProduct(e.target.value)} aria-label="Product">{stocked.map((id) => <option key={id} value={id}>{productDef(id).name}</option>)}</select>}
            {adKind === 'target' && <select value={adTarget} onChange={(e) => setAdTarget(e.target.value as CustomerType)} aria-label="Target">{(Object.keys(TYPE_NAMES) as CustomerType[]).map((t) => <option key={t} value={t}>{TYPE_NAMES[t]}</option>)}</select>}
            <button className="btn small" onClick={() => runtime.dispatch({ type: 'ad', ad: adKind === 'target' ? { kind: 'target', target: adTarget } : adKind === 'discount' ? { kind: 'discount', productId: adProduct, percent: 10 } : { kind: 'product', productId: adProduct } })}>Run ad</button>
          </div>
          <p className="muted">Preview: "{adHeadline(adKind === 'target' ? { kind: 'target', target: adTarget } : adKind === 'discount' ? { kind: 'discount', productId: adProduct, percent: 10 } : { kind: 'product', productId: adProduct })}"</p>
        </>
      )}
      <h3>Promotion</h3>
      {m.promotion ? (
        <div className="item"><div><div className="name">{m.promotion.kind === 'lossLeader' ? 'Loss leader' : 'Buy two'}: {productDef(m.promotion.productId).name}</div><div className="sub">{m.promotion.kind === 'lossLeader' ? 'Sold at cost; pulls bargain hunters who buy other things too.' : 'Shoppers take two instead of one.'}</div></div><button className="btn small danger" onClick={() => runtime.dispatch({ type: 'promotion', promo: null })}>End</button></div>
      ) : (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <select value={promoProduct} onChange={(e) => setPromoProduct(e.target.value)} aria-label="Promotion product">{stocked.map((id) => <option key={id} value={id}>{productDef(id).name}</option>)}</select>
          <button className="btn small" onClick={() => runtime.dispatch({ type: 'promotion', promo: { kind: 'lossLeader', productId: promoProduct } })}>Loss leader</button>
          <button className="btn small ghost" onClick={() => runtime.dispatch({ type: 'promotion', promo: { kind: 'buyTwo', productId: promoProduct } })}>Buy two</button>
        </div>
      )}
      <p className="muted">Weather, holidays and the Saturday rush show up in the News on the Stats card.</p>
    </>
  );
}
