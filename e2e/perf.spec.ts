import { expect, test, type Page } from '@playwright/test';
import { LANDING_MS } from './waits';

const body = (page: Page) => page.locator('body');

test('shows frame rate and planning time with ?perf and passes taps on the panel to the table', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./?perf');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'idle', { timeout: 15_000 });
  const panel = page.locator('#perf');
  await expect(panel).toContainText(/last 1 s \d+ fps, worst \d+ ms, slow \d+\/\d+/);
  await expect(panel).toContainText(/prepare \d+ ms/);
  await expect(panel).toContainText('last flight -');

  const box = (await panel.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(body(page)).toHaveAttribute('data-toss-count', '1');
  try {
    await expect(body(page)).toHaveAttribute('data-toss-state', 'result', { timeout: LANDING_MS });
    await expect(panel).toContainText(/last flight \d+ fps, worst \d+ ms, slow \d+\/\d+/);
    await expect(panel).toContainText(/tap frame \d+ ms, plan \d+ ms, prepare \d+ ms/);
  } finally {
    // Also on a failure, so the CI log shows the runner's frame rate that LANDING_MS allows for.
    console.log(`?perf panel:\n${await panel.textContent()}`);
  }
  expect(errors).toEqual([]);
});

test('keeps the panel and the reload offer with ?perf when the engine fails to load', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*.wasm', (route) => route.abort());
  await page.goto('./?perf');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'error', { timeout: 15_000 });
  // The state attribute is set before the panel hears of the state; the button comes after it.
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
  const panel = page.locator('#perf');
  await expect(panel).toContainText(/last 1 s \d+ fps/);
  await expect(panel).toContainText('tap frame -, plan -, prepare -');
  expect(errors).toEqual([]);
});

test('shows no panel without ?perf', async ({ page }) => {
  await page.goto('./');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'idle', { timeout: 15_000 });
  await expect(page.locator('#perf')).toHaveCount(0);
});
