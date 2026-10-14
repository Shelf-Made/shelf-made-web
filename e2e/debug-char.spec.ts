import { test } from '@playwright/test';
import { ready, hooks, settle } from './helpers';

test('vanish probe', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: /new game/i }).click();
  await page.getByRole('button', { name: /^start$/i }).click();
  await settle(page, 500);
  await page.getByRole('button', { name: /main street/i }).click();
  await page.getByPlaceholder(/shop name/i).fill('Corner Fresh');
  await page.getByRole('button', { name: /open the shop/i }).click();
  await settle(page, 300);
  await hooks(page, 'setSpeed', 0);
  await hooks(page, 'advanceNoScan', 75);
  await hooks(page, 'advanceScan', 200, 2.0);
  const count = () => page.evaluate(() => {
    const s = (window as unknown as { __shelf: { state: () => { people: { id: number; kind: string; state: string; x: number; z: number; carId?: number | null; path: unknown[]; pathIdx: number }[]; today: { customers: number; served: number } } } }).__shelf.state();
    return s.people.filter((p) => p.kind === 'customer').map((p) => `${p.id}:${p.state}@${p.x.toFixed(1)},${p.z.toFixed(1)}/${p.pathIdx}/${p.path.length}`).join(' ');
  });
  await hooks(page, 'crowd', 10);
  console.log('t0', await count());
  for (let i = 1; i <= 6; i++) { await hooks(page, 'advanceScan', 3, 5); console.log(`t${i * 3}`, await count()); }
});
