import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/ui/App';
import { GameRuntime } from '@/app/GameRuntime';
import { installTestHooks } from '@/app/testHooks';
import '@/ui/styles.css';

const runtime = new GameRuntime();
installTestHooks(runtime);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App runtime={runtime} />
  </StrictMode>,
);
