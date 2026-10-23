import { test, type Page } from '@playwright/test';
import { ready, hooks } from './helpers';
const out = (n: string) => '/tmp/claude-0/-home-user-shelf-made-web/79a87f1e-676d-516c-aa73-bcc4088e270f/scratchpad/shots/' + n + '.png';
async function follow(page: Page, x: number, z: number, dist = 12, yaw = 0, ms = 900, pitch?: number): Promise<void> {
  await hooks(page, 'fp', x, z, yaw, pitch, dist);
  await page.waitForTimeout(ms);
}
test('upstairs views', async ({ page }) => {
  test.setTimeout(300_000);
  const UP = -16;
  await ready(page);
  await hooks(page, 'newGame', 7, 'main', 'Tall Order', { tutorial: false });
  await hooks(page, 'setSpeed', 0);
  await page.evaluate(() => { (window as unknown as { __shelf: { state: () => { cash: number } } }).__shelf.state().cash = 50000; });
  await hooks(page, 'quickSetup', true);
  for (const [fixtureType, x, z, rot] of [['stairs', 0.5, -2, 0], ['shelf', -2.5, -4 + UP, 1], ['shelf', -2.5, -3 + UP, 1], ['register', 1.5, -2 + UP, 2], ['escalator', -0.5, -2 + UP, 0], ['produce', 1.5, -5 + 2 * UP, 3]] as [string, number, number, number][]) await hooks(page, 'dispatch', { type: 'placeFixture', fixtureType, x, z, rot });
  await hooks(page, 'advance', 5);
  await follow(page, -1, -3, 12, 0.5, 2500);
  await page.screenshot({ path: out('ground') });
  await follow(page, -1, -3, 24, 0.5, 2500, 0.6);
  await page.screenshot({ path: out('ground-far') });
  await follow(page, -1, -3 + UP, 12, 0.5, 2500);
  await page.screenshot({ path: out('first') });
  await follow(page, -1, -3 + UP, 24, 0.5, 2500, 0.6);
  await page.screenshot({ path: out('first-far') });
});
