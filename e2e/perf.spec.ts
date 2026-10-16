import { expect, test, type Page } from '@playwright/test';

const body = (page: Page) => page.locator('body');

test('shows frame rate and planning time with ?perf and passes taps on the panel to the table', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./?perf');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'idle', { timeout: 15_000 });
  const panel = page.locator('#perf');
  await expect(panel).toContainText(/last 1 s \d+ fps, worst \d+ ms, slow \d+\/\d+/);
  await expect(panel).toContainText(/prepare \d+ ms/);
  await expect(panel).toContainText('flight -');

  const box = (await panel.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(body(page)).toHaveAttribute('data-toss-count', '1');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'result', { timeout: 10_000 });
  await expect(panel).toContainText(/flight \d+ fps, worst \d+ ms, slow \d+\/\d+/);
  await expect(panel).toContainText(/plan \d+ ms, prepare \d+ ms/);
  expect(errors).toEqual([]);
});

test('shows no panel without ?perf', async ({ page }) => {
  await page.goto('./');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'idle', { timeout: 15_000 });
  await expect(page.locator('#perf')).toHaveCount(0);
});
