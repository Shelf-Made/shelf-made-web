import { useState } from 'react';
import type { GameRuntime } from '@/app/GameRuntime';
import { PLOTS } from '@/sim/layout';

export function PlotPicker({ runtime }: { runtime: GameRuntime }) {
  const [plot, setPlot] = useState(PLOTS[0]!.id);
  const [name, setName] = useState('');
  const pick = (id: string) => { setPlot(id); runtime.previewPlot(id); };
  return (
    <div className="centre" role="dialog" aria-label="Pick a plot">
      <h2>Pick your corner</h2>
      <p className="muted">One crossroads, four corners. Your rivals take the other three. Each corner faces different traffic and pays different rent.</p>
      <div className="plots" style={{ marginTop: 10 }}>
        {PLOTS.map((p) => (
          <button key={p.id} className={`plot${plot === p.id ? ' selected' : ''}`} onClick={() => pick(p.id)} onMouseEnter={() => runtime.previewPlot(p.id)} aria-pressed={plot === p.id}>
            <b>{p.name}</b>
            <small>{p.blurb}</small>
            <small><b>Rent ${p.rent}/day</b></small>
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <input type="text" placeholder="Shop name" maxLength={18} value={name} onChange={(e) => setName(e.target.value)} aria-label="Shop name" />
        <button className="btn big" onClick={() => runtime.dispatch({ type: 'choosePlot', plotId: plot, name: name.trim() || 'Corner Fresh' })}>Open the shop</button>
      </div>
    </div>
  );
}
