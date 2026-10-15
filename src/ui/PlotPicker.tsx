import { useState } from 'react';
import type { GameRuntime } from '@/app/GameRuntime';
import { PLOTS } from '@/sim/layout';
import { SHOP_SCHEMES, DEFAULT_SCHEME } from '@/sim/schemes';

export function PlotPicker({ runtime }: { runtime: GameRuntime }) {
  const [plot, setPlot] = useState(PLOTS[0]!.id);
  const [name, setName] = useState('');
  const [scheme, setScheme] = useState(DEFAULT_SCHEME);
  const paint = (id: string) => { setScheme(id); runtime.dispatch({ type: 'setScheme', scheme: id }); };
  const pick = (id: string) => { setPlot(id); runtime.previewPlot(id); };
  return (
    <div className="centre" role="dialog" aria-label="Pick a plot">
      <h2>Pick your corner</h2>
      <p className="muted">Pick a corner. Rivals take the other three. Each has its own traffic and rent.</p>
      <div className="plots" style={{ marginTop: 10 }}>
        {PLOTS.map((p) => (
          <button key={p.id} className={`plot${plot === p.id ? ' selected' : ''}`} onClick={() => pick(p.id)} onMouseEnter={() => runtime.previewPlot(p.id)} aria-pressed={plot === p.id}>
            <b>{p.name}</b>
            <small>{p.blurb}</small>
            <small><b>Rent ${p.rent}/day</b></small>
          </button>
        ))}
      </div>
      <div className="schemes" role="radiogroup" aria-label="Shop colours">
        <span className="muted">Your colours</span>
        {SHOP_SCHEMES.map((sc) => (
          <button key={sc.id} role="radio" aria-checked={scheme === sc.id} aria-label={sc.name} title={sc.name} className={`swatch${scheme === sc.id ? ' selected' : ''}`} onClick={() => paint(sc.id)}
            style={{ background: `linear-gradient(135deg, ${sc.primary} 0 55%, ${sc.accent} 55% 70%, ${sc.trim} 70%)` }} />
        ))}
        <b className="scheme-name">{SHOP_SCHEMES.find((s) => s.id === scheme)?.name}</b>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <input type="text" placeholder="Shop name" maxLength={18} value={name} onChange={(e) => setName(e.target.value)} aria-label="Shop name" />
        <button className="btn big" onClick={() => runtime.dispatch({ type: 'choosePlot', plotId: plot, name: name.trim() || 'Corner Fresh', scheme })}>Open the shop</button>
      </div>
    </div>
  );
}
