import { useEffect, useRef, useState } from 'react';
import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { keyLabel } from '@/save/settings';

/**
 * Screen-space UI over the first-person view: floating "+$" popups, the crosshair with what
 * pressing E would do, the current tip, and a marker over the thing the tip is about.
 * Positions are written straight to the DOM every frame so nothing re-renders at 60 fps.
 */
export function Overlay({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  // Popups are plain DOM nodes in their own container, so React never reorders them.
  const root = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  const crossRef = useRef<HTMLDivElement>(null);
  const useRef_ = useRef<HTMLButtonElement>(null);
  const tip = snap.tip;

  useEffect(() => {
    let raf = 0;
    const nodes = new Map<number, HTMLDivElement>();
    const proj = { x: 0, y: 0, visible: false };
    let lastPrompt = '';
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

      // Crosshair prompt.
      const a = runtime.aimInfo();
      const pr = promptRef.current, cross = crossRef.current;
      if (pr && cross) {
        const key = a ? `${a.key}|${a.text}|${a.ok}` : '';
        if (key !== lastPrompt) {
          lastPrompt = key;
          pr.replaceChildren();
          if (a && a.text) {
            if (a.key) { const k = document.createElement('kbd'); k.textContent = a.key; pr.appendChild(k); }
            pr.appendChild(document.createTextNode(a.text));
          }
          pr.className = `aim-prompt${a?.ok ? ' ok' : ''}${a && a.text ? ' show' : ''}`;
          cross.classList.toggle('active', !!a?.ok);
        }
      }
      // The on-screen Use button mirrors the prompt, for mouse, touch and anyone who forgets the key.
      const u = useRef_.current;
      const ukey = a ? `${a.key}|${a.text}|${a.ok}` : '-';
      if (u && u.dataset.k !== ukey) {
        u.dataset.k = ukey;
        u.classList.toggle('ready', !!a?.ok);
        u.classList.toggle('show', !!a?.ok);
        const label = u.querySelector('.what'), k = u.querySelector('kbd');
        if (label) label.textContent = a?.text || 'Use';
        if (k) k.textContent = a?.key ?? '';
      }

      // Marker over the tip's target, pinned to the screen edge when it is off to the side.
      const t = runtime.getSnapshot().tip;
      const m = markerRef.current;
      if (!m) return;
      let anchor: { x: number; y: number; z: number } | null = null;
      if (t?.fixtureId !== undefined) anchor = runtime.fixtureAnchor(t.fixtureId);
      else if (t?.anchor === 'delivery') { const d = s.shop.delivery; anchor = { x: s.shop.originX + (d.x0 + d.x1) / 2, y: 0.9, z: s.shop.originZ + (d.z0 + d.z1) / 2 }; }
      if (!anchor) { m.style.display = 'none'; return; }
      r.project(anchor.x, anchor.y, anchor.z, proj);
      const w = window.innerWidth, h = window.innerHeight;
      let x = proj.x, y = proj.y;
      const behind = !proj.visible;
      if (behind) { x = w - x; y = h * 0.5; }
      const pad = 40;
      const off = behind || x < pad || x > w - pad || y < 80 || y > h - pad;
      x = Math.max(pad, Math.min(w - pad, x)); y = Math.max(90, Math.min(h - pad, y));
      m.style.display = '';
      m.style.left = `${x}px`; m.style.top = `${y}px`;
      m.classList.toggle('edge', off);
      m.classList.toggle('left', off && x <= pad + 1);
      m.classList.toggle('right', off && x >= w - pad - 1);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); for (const el of nodes.values()) el.remove(); };
  }, [runtime]);

  const fp = snap.firstPerson && !snap.night && !snap.gameOver;
  const keys = snap.settings.keys;
  const showLookHint = fp && !snap.locked && !snap.card && !(typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);
  return (
    <>
      <div ref={root} className="overlay popups" aria-hidden="true" />
      {fp && (
        <div className="crosshair-wrap" aria-hidden="true">
          <div ref={crossRef} className="crosshair" />
          <div ref={promptRef} className="aim-prompt" />
        </div>
      )}
      {fp && <div ref={markerRef} className="marker" aria-hidden="true" style={{ display: 'none' }}><span /></div>}
      {snap.jobs && tip && tip.anchor !== 'night' && <Jobs runtime={runtime} jobs={snap.jobs} tip={tip.text} current={tip.id} />}
      {!snap.jobs && tip && tip.anchor !== 'night' && (
        <div className="tip docked objective" key={tip.id} role="note"><div className="label">Next up</div>{tip.text}</div>
      )}
      {tip && tip.anchor === 'night' && (
        <div className="tip docked" key={tip.id} role="note" style={{ left: '50%', top: '30%', transform: 'translateX(-50%)' }}>{tip.text}</div>
      )}
      {fp && !snap.card && (
        <button ref={useRef_} className="use-btn" onClick={() => runtime.interact()} aria-label="Use">
          <kbd />
          <span className="what">Use</span>
        </button>
      )}
      {showLookHint && (
        <div className="look-hint" aria-label="Controls">
          <span className="ctl"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="6" /><path d="M12 3v6" /></svg>Click to look</span>
          <span className="ctl"><span className="keys"><kbd>{keyLabel(keys.forward)}</kbd><kbd>{keyLabel(keys.left)}</kbd><kbd>{keyLabel(keys.back)}</kbd><kbd>{keyLabel(keys.right)}</kbd></span>Walk</span>
          <span className="ctl"><kbd>{keyLabel(keys.interact)}</kbd>Use</span>
          <span className="ctl"><kbd>Esc</kbd>Free mouse</span>
        </div>
      )}
    </>
  );
}

const JOB_ICONS: Record<string, string> = { counter: 'build', shelf: 'build', order: 'stock', stock: 'stock', open: 'open', ringUp: 'scan', price: 'prices', openTomorrow: 'open' };

/** The first day as a checklist: done jobs ticked, the current one open with its how-to. */
function Jobs({ runtime, jobs, tip, current }: { runtime: GameRuntime; jobs: NonNullable<Snapshot['jobs']>; tip: string; current: string }) {
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 760);
  const done = jobs.filter((j) => j.done).length;
  return (
    <div className={`tip jobs${open ? '' : ' folded'}`} role="note" aria-label="Today's jobs">
      <button className="jobs-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="label">Today&apos;s jobs</span>
        <span className="count">{done}/{jobs.length}</span>
        <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      <div className="jobs-bar" aria-hidden="true"><div style={{ width: `${(done / jobs.length) * 100}%` }} /></div>
      {open && (
        <ol>
          {jobs.map((j) => (
            <li key={j.id} className={`${j.done ? 'done' : ''}${j.id === current ? ' now' : ''} j-${JOB_ICONS[j.id] ?? 'build'}`}>
              <span className="check" aria-hidden="true">{j.done ? '✓' : ''}</span>
              <span className="t">{j.title}{j.id === current && <small key={tip}>{tip}</small>}</span>
            </li>
          ))}
        </ol>
      )}
      {open && <div className="skip"><button onClick={() => runtime.dispatch({ type: 'skipTutorial' })}>I know what I&apos;m doing, hide this</button></div>}
    </div>
  );
}
