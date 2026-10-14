import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/ui/App';
import { GameRuntime } from '@/app/GameRuntime';
import { installTestHooks } from '@/app/testHooks';
import '@/ui/styles.css';

const runtime = new GameRuntime();
installTestHooks(runtime);
// Every button in the interface answers the pointer: a soft tick on hover, a pop on press.
// The first press also wakes the audio (browsers need a gesture).
const buttonOf = (t: EventTarget | null) => (t instanceof Element ? t.closest('button, [role="button"], a.btn') : null);
let hovered: Element | null = null;
document.addEventListener('pointerover', (e) => { const b = buttonOf(e.target); if (b && b !== hovered && !(b as HTMLButtonElement).disabled && e.pointerType === 'mouse') runtime.audio.play('hover'); hovered = b; });
document.addEventListener('pointerdown', (e) => { runtime.audio.start(); const b = buttonOf(e.target); if (b && !(b as HTMLButtonElement).disabled) runtime.audio.play('tap'); }, true);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App runtime={runtime} />
  </StrictMode>,
);
