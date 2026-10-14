import { test, expect } from '@playwright/test';
import { ready, hooks, settle } from './helpers';
import { writeFileSync, mkdirSync } from 'node:fs';

interface Stats { fps: number; drawCalls: number; triangles: number; people: number }

async function measure(page: import('@playwright/test').Page, ms: number): Promise<Stats> {
  await settle(page, 400);
  const samples: Stats[] = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { samples.push(await hooks<Stats>(page, 'stats')); await settle(page, 250); }
  const avg = (k: keyof Stats) => samples.reduce((a, s) => a + s[k], 0) / samples.length;
  return { fps: avg('fps'), drawCalls: Math.max(...samples.map((s) => s.drawCalls)), triangles: Math.max(...samples.map((s) => s.triangles)), people: Math.max(...samples.map((s) => s.people)) };
}

test('performance budget', async ({ page }) => {
  await ready(page);
  await hooks(page, 'newGame', 11, 'main', 'Perf Mart', { tutorial: false });
  await hooks(page, 'quickSetup', true);
  for (const r of ['discount', 'premium', 'chain']) await hooks(page, 'rivalSale', r);
  // The default follow view: the manager behind the counter, the shelves, the door.
  await hooks(page, 'fp', 2.0, -1.5, 0, undefined, 12);
  const starter = await measure(page, 2500);
  await hooks(page, 'advanceNoScan', 300);
  await hooks(page, 'setSpeed', 4);
  const busy = await measure(page, 2500);
  // Someone clicked and followed: the outline is one more draw and the panel is DOM; nothing else changes.
  const who = await page.evaluate(() => {
    const h = (window as unknown as { __shelf: { state: () => { people: { id: number; kind: string; state: string }[] } } }).__shelf;
    return h.state().people.find((p) => p.kind === 'customer' && p.state !== 'driving')?.id ?? null;
  });
  expect(who).not.toBeNull();
  await hooks(page, 'selectPerson', who);
  await page.evaluate(() => (window as unknown as { __shelf: { runtime: { followSelected: () => void } } }).__shelf.runtime.followSelected());
  const selected = await measure(page, 2500);
  await page.keyboard.press('Escape');
  await hooks(page, 'setSpeed', 1);
  // One scroll step out (the lot and the road), then all the way out over the crossroads.
  await hooks(page, 'fp', 2.0, -1.5, 0, undefined, 20);
  const mid = await measure(page, 2500);
  await hooks(page, 'viewWorld', 0, 3, 0.3, 68, 0.9);
  const overview = await measure(page, 2500);
  const report = { measuredAt: new Date().toISOString(), note: 'Headless SwiftShader (software GL); fps here is far below a real GPU. Draw calls and triangles are the hard budget.', starter, busy, selected, mid, overview };
  mkdirSync('docs/screens', { recursive: true });
  writeFileSync('docs/screens/perf.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  for (const v of [starter, busy, selected, mid, overview]) {
    expect(v.drawCalls).toBeLessThan(250);
    expect(v.triangles).toBeLessThan(900_000);
  }
  expect(busy.people).toBeGreaterThan(5);
});
