import { useEffect, useRef } from 'react';
import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import { keyLabel } from '@/save/settings';
import { toWorld } from '@/sim/layout';

/**
 * Screen-space UI over the world: floating "+$" popups, the label over whatever Use (or a click)
 * would act on, the current tip, and a marker over the thing the tip is about.
 * Positions are written straight to the DOM every frame so nothing re-renders at 60 fps.
 */
export function Overlay({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  // Popups are plain DOM nodes in their own container, so React never reorders them.
  const root = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);
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
        // Only over what made it in sight: not from a floor lifted off, nor from under the boards of the floor in view.
        el.style.display = proj.visible && r.inSight(s, p.x, 0.5, p.z) ? '' : 'none';
        el.style.left = `${proj.x}px`; el.style.top = `${proj.y}px`;
      }
      for (const [id, el] of nodes) if (!seen.has(id)) { el.remove(); nodes.delete(id); }

      // The label over whatever Use (or a click) would act on.
      const a = runtime.aimInfo();
      const pr = promptRef.current;
      if (pr) {
        const key = a ? `${a.key}|${a.text}|${a.ok}` : '';
        if (key !== lastPrompt) {
          lastPrompt = key;
          pr.replaceChildren();
          if (a && a.text) {
            if (a.key) { const k = document.createElement('kbd'); k.textContent = a.key; pr.appendChild(k); }
            pr.appendChild(document.createTextNode(a.text));
          }
          pr.className = `aim-prompt${a?.ok ? ' ok' : ''}${a && a.text ? ' show' : ''}`;
        }
        if (a?.at) {
          r.project(a.at.x, a.at.y, a.at.z, proj);
          pr.style.left = `${proj.x}px`; pr.style.top = `${proj.y}px`;
          pr.style.display = proj.visible ? '' : 'none';
        } else pr.style.display = 'none';
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
      else if (t?.anchor === 'delivery') { const d = s.shop.delivery; const w = toWorld(s.shop, (d.x0 + d.x1) / 2, (d.z0 + d.z1) / 2); anchor = { x: w.x, y: 0.9, z: w.z }; }
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

  const fp = snap.playing && !snap.night && !snap.gameOver;
  const keys = snap.settings.keys;
  // The controls card waits until the tutorial is over: one thing on screen at a time.
  const showLookHint = fp && !snap.card && !snap.jobs && !(typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);
  return (
    <>
      <div ref={root} className="overlay popups" aria-hidden="true" />
      {fp && <div ref={promptRef} className="aim-prompt" aria-hidden="true" />}
      {fp && <div ref={markerRef} className="marker" aria-hidden="true" style={{ display: 'none' }}><span /></div>}
      {snap.jobs && tip && tip.anchor !== 'night' && <Coach runtime={runtime} jobs={snap.jobs} tip={tip} />}
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
          <span className="ctl"><span className="keys"><kbd>{keyLabel(keys.forward)}</kbd><kbd>{keyLabel(keys.left)}</kbd><kbd>{keyLabel(keys.back)}</kbd><kbd>{keyLabel(keys.right)}</kbd></span>Walk</span>
          <span className="ctl"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="6" /><path d="M12 3v6" /></svg>Click to walk or use · drag to look around</span>
          <span className="ctl"><kbd>{keyLabel(keys.interact)}</kbd>Use</span>
          <span className="ctl"><span className="keys"><kbd>{keyLabel(keys.turnLeft)}</kbd><kbd>{keyLabel(keys.turnRight)}</kbd></span>Turn · scroll to zoom</span>
          <span className="ctl"><kbd>{keyLabel(keys.firstPerson)}</kbd>{snap.firstPerson ? 'Back to the camera behind you' : 'Through your own eyes'}</span>
        </div>
      )}
    </>
  );
}

/**
 * The tutorial as a coach: one step at a time, a short title and one line, with how far along you are
 * as dots. The button it means pulses on the tool shelf.
 */
function Coach({ runtime, jobs, tip }: { runtime: GameRuntime; jobs: NonNullable<Snapshot['jobs']>; tip: NonNullable<Snapshot['tip']> }) {
  const i = Math.max(0, jobs.findIndex((j) => j.id === tip.id));
  return (
    <div className="tip coach" role="note" aria-label="What to do next">
      <div className="coach-top">
        <span className="step">Step {i + 1} of {jobs.length}</span>
        <span className="dots" aria-hidden="true">{jobs.map((j) => <i key={j.id} className={j.done ? 'done' : j.id === tip.id ? 'now' : ''} />)}</span>
      </div>
      <b className="coach-title" key={`t-${tip.id}`}>{jobs[i]?.title}</b>
      <div className="coach-text" key={tip.text}>{tip.text}</div>
      <button className="coach-skip" onClick={() => runtime.dispatch({ type: 'skipTutorial' })}>Skip tutorial</button>
    </div>
  );
}
