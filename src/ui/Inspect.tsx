import { useEffect, useRef } from 'react';
import type { GameRuntime, Snapshot } from '@/app/GameRuntime';
import type { CustomerType } from '@/sim/types';
import type { Mood } from '@/sim/inspect';
import { TYPE_COLOURS } from '@/render/People';
import { money } from './useRuntime';

/**
 * Each shopper type has its own shape as well as its own colour (a tag, a clock, a heart, a star),
 * so the icon reads the same without colour.
 */
export function TypeIcon({ type }: { type: CustomerType }) {
  const c = TYPE_COLOURS[type];
  return (
    <svg className={`type-icon t-${type}`} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill={c} />
      {type === 'bargain' && <><path d="M6 7h7l5 5-6 6-6-6z" fill="#fff" /><circle cx="9" cy="10" r="1.4" fill={c} /></>}
      {type === 'convenience' && <><circle cx="12" cy="12" r="6.5" fill="#fff" /><path d="M12 8.2V12l2.8 1.8" stroke={c} strokeWidth="1.8" fill="none" strokeLinecap="round" /></>}
      {type === 'loyalist' && <path d="M12 18.2 6.6 13a3.3 3.3 0 0 1 4.7-4.7l.7.7.7-.7a3.3 3.3 0 0 1 4.7 4.7z" fill="#fff" />}
      {type === 'impulse' && <path d="m12 5.5 1.9 4 4.3.5-3.2 2.9.9 4.3-3.9-2.2-3.9 2.2.9-4.3L5.8 10l4.3-.5z" fill="#fff" />}
    </svg>
  );
}

const MOOD_WORDS: Record<Mood, string> = { happy: 'Happy', ok: 'Fine', annoyed: 'Annoyed' };
const MOOD_COLOURS: Record<Mood, string> = { happy: '#3FA87A', ok: '#D9A066', annoyed: '#E8573F' };

/** A face: a smile, a straight mouth or a frown with cross brows (the shape says it, not just the colour). */
export function MoodFace({ mood }: { mood: Mood }) {
  return (
    <svg className={`mood-face m-${mood}`} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill={MOOD_COLOURS[mood]} />
      <circle cx="8.5" cy="10" r="1.5" fill="#fff" /><circle cx="15.5" cy="10" r="1.5" fill="#fff" />
      {mood === 'happy' && <path d="M7.5 14a5 5 0 0 0 9 0" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />}
      {mood === 'ok' && <path d="M8 15.5h8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />}
      {mood === 'annoyed' && <><path d="M7.5 17a5 5 0 0 1 9 0" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" /><path d="M6.5 6.8 10 8.2M17.5 6.8 14 8.2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /></>}
    </svg>
  );
}

const LIST_MARKS = { found: '✓', missed: '✗', todo: '•' } as const;
const LIST_WORDS = { found: 'found', missed: 'not found', todo: 'still to find' } as const;

/**
 * The inspect panel: who the clicked person is, how they feel, their list, basket and patience, and
 * why they chose the store they did. It sits beside them, moved every frame without re-rendering;
 * on a phone it docks at the bottom instead. Esc (or ×) closes it; Follow keeps the camera on them.
 */
export function InspectPanel({ runtime, snap }: { runtime: GameRuntime; snap: Snapshot }) {
  const ref = useRef<HTMLDivElement>(null);
  const info = snap.inspect;
  const id = info?.id ?? null;

  useEffect(() => {
    if (id === null) return;
    let raf = 0;
    const proj = { x: 0, y: 0, visible: false };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = ref.current, s = runtime.state, r = runtime.renderer;
      if (!el || !s || !r) return;
      if (window.innerWidth <= 640) { el.classList.add('docked'); el.style.left = ''; el.style.top = ''; return; }
      el.classList.remove('docked');
      // Out of sight (on a floor lifted off): left where it was, faded.
      const a = r.personAnchor(s, id);
      if (!a) { el.classList.add('offscreen'); return; }
      r.project(a.x, a.y, a.z, proj);
      const w = el.offsetWidth, h = el.offsetHeight, W = window.innerWidth, H = window.innerHeight;
      // Beside the person, on whichever side has room, never under the top bar or the tool shelf.
      let x = proj.x + 34;
      if (x + w > W - 12) x = proj.x - 34 - w;
      x = Math.max(12, Math.min(W - w - 12, x));
      const y = Math.max(76, Math.min(H - h - 130, proj.y - h * 0.35));
      el.style.left = `${Math.round(x)}px`; el.style.top = `${Math.round(y)}px`;
      el.classList.toggle('offscreen', !proj.visible);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [runtime, id]);

  if (!info) return null;
  const st = info.staff;
  const sub = st ? st.roleName : info.typeName ?? (info.kind === 'walker' ? 'Passing by' : 'Shopper');
  return (
    <div ref={ref} className={`inspect k-${info.kind}`} role="dialog" aria-label={`About ${info.name}`} data-testid="inspect">
      <div className="inspect-head">
        {info.type ? <TypeIcon type={info.type} /> : <span className="type-icon staff" aria-hidden="true">{st ? '★' : '·'}</span>}
        <div className="who">
          <b className="name">{info.name}</b>
          <span className="sub">{sub}</span>
        </div>
        <button className="x" onClick={() => runtime.selectPerson(null)} aria-label="Close">×</button>
      </div>
      <div className="inspect-mood"><MoodFace mood={info.mood} /><span className="mood-word">{MOOD_WORDS[info.mood]}</span><span className="doing">{info.doing}</span></div>

      {info.list && info.list.length > 0 && (
        <ul className="inspect-list" aria-label="Shopping list">
          {info.list.map((it, i) => (
            <li key={`${it.name}-${i}`} className={it.state}><span className="mark" aria-hidden="true">{LIST_MARKS[it.state]}</span><span>{it.name}</span><span className="sr-only">: {LIST_WORDS[it.state]}</span></li>
          ))}
        </ul>
      )}
      {info.budget !== undefined && info.budget > 0 && (
        <div className="inspect-row">
          <span>Basket</span>
          <span className="meter" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.round(((info.basket ?? 0) / info.budget) * 100))}%` }} /></span>
          <b>{money(info.basket ?? 0)} of {money(info.budget)}</b>
        </div>
      )}
      {info.patience !== undefined && (
        <div className="inspect-row">
          <span>Patience</span>
          <span className={`meter patience${info.patience < 0.3 ? ' low' : ''}`} role="progressbar" aria-label="Patience" aria-valuenow={Math.round(info.patience * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.round(info.patience * 100)}%` }} /></span>
        </div>
      )}
      {info.why && info.why.length > 0 && (
        <div className="inspect-why">
          <div className="why-label">{info.whyLabel}</div>
          <ul>{info.why.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {st && (
        <>
          <div className="inspect-row"><span>Skill</span><span className="meter" role="progressbar" aria-label="Skill" aria-valuenow={Math.round(st.skill * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.round(st.skill * 100)}%` }} /></span></div>
          <div className="inspect-row"><span>Morale</span><span className={`meter${st.morale < 0.4 ? ' low' : ''}`} role="progressbar" aria-label="Morale" aria-valuenow={Math.round(st.morale * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.round(st.morale * 100)}%` }} /></span></div>
          <div className="inspect-row"><span>Wage</span><b>{money(st.wage)} a day</b></div>
        </>
      )}
      <div className="inspect-foot">
        {info.following
          ? <button className="btn small ghost" onClick={() => runtime.stopFollow()}>Stop following</button>
          : <button className="btn small" onClick={() => runtime.followSelected()}>Follow</button>}
        {st && snap.unlocks.staff && <button className="btn small ghost" onClick={() => { runtime.selectPerson(null); runtime.openCard('staff'); }}>Staff card</button>}
        {info.moveAlong !== undefined && <button className="btn small ghost" onClick={() => { runtime.dispatch({ type: 'moveAlong', hangoutId: info.moveAlong! }); runtime.selectPerson(null); }}>Ask them to move along</button>}
      </div>
    </div>
  );
}
