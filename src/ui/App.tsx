import { useEffect, useRef } from 'react';
import type { GameRuntime } from '@/app/GameRuntime';
import { InputController } from '@/app/Input';
import { useSnapshot } from './useRuntime';
import { Lobby } from './Lobby';
import { TopBar } from './TopBar';
import { Cards } from './cards/Cards';
import { NightCard } from './NightCard';
import { PlotPicker } from './PlotPicker';
import { Overlay } from './Overlay';
import { GameOverCard } from './GameOverCard';
import { Celebration, ChampionCard } from './Goals';
import { InspectPanel } from './Inspect';
import { FixtureMenu } from './FixtureMenu';

export function App({ runtime }: { runtime: GameRuntime }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snap = useSnapshot(runtime);

  useEffect(() => {
    const canvas = canvasRef.current!;
    void runtime.attach(canvas);
    const input = new InputController(runtime, canvas);
    input.attach();
    let raf = 0, last = performance.now();
    const loop = (t: number) => { raf = requestAnimationFrame(loop); input.update(Math.min(0.1, (t - last) / 1000)); last = t; };
    raf = requestAnimationFrame(loop);
    const onResize = () => runtime.renderer?.resize();
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); input.detach(); window.removeEventListener('resize', onResize); };
  }, [runtime]);

  useEffect(() => {
    document.documentElement.classList.toggle('large-ui', snap.settings.largeUI);
    document.documentElement.classList.toggle('colour-blind', snap.settings.colorBlind);
  }, [snap.settings.largeUI, snap.settings.colorBlind]);

  return (
    <div className="app">
      <canvas ref={canvasRef} className="world" aria-label="Shelf Made world" />
      {snap.screen === 'lobby' && <Lobby runtime={runtime} snap={snap} />}
      {snap.screen === 'game' && (
        <div className={`overlay${snap.goal && snap.phase !== 'picking' && !snap.jobs ? ' has-goal' : ''}`}>
          <TopBar runtime={runtime} snap={snap} />
          {snap.phase === 'picking' && <PlotPicker runtime={runtime} />}
          {snap.card && <Cards runtime={runtime} snap={snap} />}
          {snap.night && !snap.gameOver && <NightCard runtime={runtime} snap={snap} />}
          {snap.gameOver && <GameOverCard runtime={runtime} snap={snap} />}
          {snap.champion && !snap.gameOver && <ChampionCard runtime={runtime} />}
          <Celebration snap={snap} />
          <Overlay runtime={runtime} snap={snap} />
          {snap.inspect && !snap.night && <InspectPanel runtime={runtime} snap={snap} />}
          {snap.fixtureMenu && !snap.night && <FixtureMenu runtime={runtime} menu={snap.fixtureMenu} />}
          {snap.toast && <div className="toast" key={snap.toast.id} role="status">{snap.toast.text}</div>}
        </div>
      )}
    </div>
  );
}
