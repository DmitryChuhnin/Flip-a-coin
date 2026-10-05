import { expect, test, type Page } from '@playwright/test';

const body = (page: Page) => page.locator('body');

/** Counts `navigator.vibrate` calls; Chromium on desktop ignores them otherwise. */
async function recordVibrations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: number[] = [];
    Object.defineProperty(window, 'vibrations', { value: calls });
    navigator.vibrate = (pattern) => {
      calls.push(Number(pattern));
      return true;
    };
  });
}

const vibrations = (page: Page) =>
  page.evaluate(() => (window as unknown as { vibrations: number[] }).vibrations.length);

test('unlocks audio on the first tap and vibrates once on landing', async ({ page }) => {
  await recordVibrations(page);
  await page.goto('./');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'idle', { timeout: 15_000 });
  await expect(body(page)).toHaveAttribute('data-audio', 'locked');

  await page.locator('#scene').tap();
  await expect(body(page)).toHaveAttribute('data-audio', 'running');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'result', { timeout: 10_000 });
  expect(await vibrations(page)).toBe(1);
});

test('stays silent and still with the sound switched off', async ({ page }) => {
  await recordVibrations(page);
  await page.goto('./');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'idle', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Sound', exact: true }).click();

  await page.locator('#scene').tap();
  await expect(body(page)).toHaveAttribute('data-toss-state', 'result', { timeout: 10_000 });
  expect(await vibrations(page)).toBe(0);
});

test('tosses without errors where Web Audio and vibration are missing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', { value: undefined });
    Object.defineProperty(Navigator.prototype, 'vibrate', { value: undefined });
  });
  await page.goto('./');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'idle', { timeout: 15_000 });
  await page.locator('#scene').tap();
  await expect(body(page)).toHaveAttribute('data-audio', 'unavailable');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'result', { timeout: 10_000 });
  expect(errors).toEqual([]);
});
