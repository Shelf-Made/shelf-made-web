import { useEffect, useRef } from 'react';
import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { doorOutside } from '@/sim/people';

/**
 * World-anchored UI: floating "+$" popups and the guided tip bubble. Positions are updated
 * every frame straight on the DOM so nothing re-renders at 60 fps.
 */
export function Overlay({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  // Popups are plain DOM nodes in their own container, so React never reorders them (which would restart the tip's animation).
  const root = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const tip = snap.tip;

  useEffect(() => {
    let raf = 0;
    const nodes = new Map<number, HTMLDivElement>();
    const proj = { x: 0, y: 0, visible: false };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const s = runtime.state; const r = runtime.renderer; const host = root.current;
      if (!s || !r || !host) return;
      const seen = new Set<number>();
      for (const p of s.popups) {
        seen.add(p.id);
        let el = nodes.get(p.id);
        if (!el) {
          el = document.createElement('div');
          el.className = `popup ${p.kind}`;
          el.textContent = p.text;
          host.appendChild(el); nodes.set(p.id, el);
        }
        r.project(p.x, p.y, p.z, proj);
        el.style.display = proj.visible ? '' : 'none';
        el.style.left = `${proj.x}px`; el.style.top = `${proj.y}px`;
      }
      for (const [id, el] of nodes) if (!seen.has(id)) { el.remove(); nodes.delete(id); }
      // Tip anchor.
      const t = runtime.getSnapshot().tip;
      const tipEl = tipRef.current;
      if (t && tipEl) {
        let anchor: { x: number; y: number; z: number } | null = null;
        if (t.fixtureId !== undefined) anchor = runtime.fixtureAnchor(t.fixtureId);
        else if (t.anchor === 'door') { const d = doorOutside(s); anchor = { x: d.x, y: 1.2, z: d.z }; }
        if (anchor) {
          r.project(anchor.x, anchor.y, anchor.z, proj);
          // Sit beside the thing to click, on the side away from the shop, so the bubble never covers the floor.
          const right = anchor.x >= s.shop.originX;
          tipEl.classList.remove('docked');
          tipEl.classList.toggle('side-right', right);
          tipEl.classList.toggle('side-left', !right);
          const w = tipEl.offsetWidth || 280;
          const x = right ? proj.x + 46 : proj.x - 60 - w;
          tipEl.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x))}px`;
          tipEl.style.top = `${Math.max(70, proj.y - 70)}px`;
          tipEl.style.right = '';
        } else {
          // Docked beside a top-bar button.
          const btn = t.anchor.startsWith('button:') ? document.querySelector<HTMLElement>(`[data-card="${t.anchor.slice(7)}"]`) : null;
          tipEl.classList.add('docked');
          if (btn) { const b = btn.getBoundingClientRect(); tipEl.style.left = `${Math.min(window.innerWidth - 320, Math.max(8, b.left + b.width / 2 - 150))}px`; tipEl.style.top = `${b.bottom + 40}px`; }
          else { tipEl.style.left = '50%'; tipEl.style.top = '70%'; }
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); for (const el of nodes.values()) el.remove(); };
  }, [runtime]);

  return (
    <>
      <div ref={root} className="overlay popups" aria-hidden="true" />
      {tip && (
        <div ref={tipRef} className={`tip${tip.anchor.startsWith('button:') || tip.anchor === 'night' ? ' docked' : ''}`} key={tip.id} role="note" style={tip.anchor === 'night' ? { left: '50%', top: '38%', transform: 'translateX(-50%)' } : undefined}>
          {tip.text}
          <div className="skip"><button onClick={() => runtime.dispatch({ type: 'skipTutorial' })}>Skip tips</button></div>
          {(tip.anchor.startsWith('button:')) ? (
            <div className="arrow" style={{ bottom: 'auto', top: -34, transform: 'rotate(180deg)' }}><svg viewBox="0 0 24 24"><path d="M12 20l-8-9h5V3h6v8h5z" /></svg></div>
          ) : tip.anchor !== 'night' ? (
            <div className="arrow side"><svg viewBox="0 0 24 24"><path d="M12 20l-8-9h5V3h6v8h5z" /></svg></div>
          ) : null}
        </div>
      )}
      {snap.phase === 'open' && snap.day === 1 && !tip && !snap.toast && <div className="hint">Drag to pan · wheel to zoom · right-drag to rotate · F focuses the shop · Space scans</div>}
    </>
  );
}
