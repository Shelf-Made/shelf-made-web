import { defineConfig } from '@playwright/test';

const port = 4173;
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    launchOptions: {
      // Local: the preinstalled Chromium. CI sets CHROMIUM_PATH to an empty string to use Playwright's own download.
      executablePath: process.env.CHROMIUM_PATH === undefined ? '/opt/pw-browsers/chromium' : (process.env.CHROMIUM_PATH || undefined),
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'npm run preview',
    port,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
