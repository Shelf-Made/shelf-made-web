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
  await hooks(page, 'focusStore');
  const starter = await measure(page, 2500);
  await hooks(page, 'advanceNoScan', 300);
  await hooks(page, 'setSpeed', 4);
  const busy = await measure(page, 2500);
  await hooks(page, 'setSpeed', 1);
  await hooks(page, 'camera', 0, -1, 44, 0.35, 0.9);
  const wide = await measure(page, 2500);
  const report = { measuredAt: new Date().toISOString(), note: 'Headless SwiftShader (software GL); fps here is far below a real GPU. Draw calls and triangles are the hard budget.', starter, busy, wide };
  mkdirSync('docs/screens', { recursive: true });
  writeFileSync('docs/screens/perf.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  expect(starter.drawCalls).toBeLessThan(250);
  expect(busy.drawCalls).toBeLessThan(250);
  expect(wide.drawCalls).toBeLessThan(250);
  expect(wide.triangles).toBeLessThan(900_000);
  expect(busy.people).toBeGreaterThan(5);
});
