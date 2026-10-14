import { test } from '@playwright/test';
import { ready, hooks, settle } from './helpers';

test('crowd probe', async ({ page }) => {
  await ready(page);
  await hooks(page, 'newGame', 3, 'main', 'Debug', { tutorial: false });
  await hooks(page, 'setSpeed', 0);
  await hooks(page, 'advanceScan', 200, 2);
  const count = () => page.evaluate(() => {
    const s = (window as unknown as { __shelf: { state: () => { people: { kind: string; state: string; x: number; z: number }[]; today: { customers: number; served: number; walkedOut: number; turnedAway: number }; stuckRescues: number } } }).__shelf.state();
    const by: Record<string, number> = {};
    for (const p of s.people) { const k = p.kind + ':' + p.state; by[k] = (by[k] ?? 0) + 1; }
    return { by, today: s.today, stuck: s.stuckRescues };
  });
  console.log('before', JSON.stringify(await count()));
  await hooks(page, 'crowd', 10);
  console.log('spawned', JSON.stringify(await count()));
  await hooks(page, 'advanceScan', 15, 5);
  console.log('t+15', JSON.stringify(await count()));
  await hooks(page, 'advanceScan', 25, 5);
  console.log('t+40', JSON.stringify(await count()));
  await settle(page, 100);
});
