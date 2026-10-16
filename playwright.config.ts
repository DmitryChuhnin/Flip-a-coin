import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  // Well above a test's run on CI, so a slow but passing wait leaves the next one its whole limit
  // and a wait that runs out fails with its own message, not the test's.
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  // Software WebGL in parallel workers starves a CI runner and times out waits.
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/flip-a-coin/`,
    // Playwright's default of 0 lets an action or a page load hang until the test timeout.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
        launchOptions: {
          // Headless CI runners have no GPU; SwiftShader gives a software WebGL2 context.
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  // Serves the existing dist/ without rebuilding; `npm run test:e2e` builds first.
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/flip-a-coin/`,
    reuseExistingServer: false,
  },
});
