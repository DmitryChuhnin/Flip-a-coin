import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const body = (page: Page) => page.locator('body');

test('tosses on tap, ignores taps in flight, announces the result and tosses again on Space', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('./');

  await expect(body(page)).toHaveAttribute('data-toss-state', 'idle', { timeout: 15_000 });
  await expect(body(page)).toHaveAttribute('data-toss-count', '0');
  const canvas = page.locator('#scene');
  const result = page.locator('#toss-result');
  await expect(result).toHaveAttribute('aria-live', 'polite');

  await canvas.tap();
  await expect(body(page)).toHaveAttribute('data-toss-state', 'flying');
  await expect(body(page)).toHaveAttribute('data-toss-count', '1');

  await canvas.tap();
  await page.keyboard.press('Space');
  await expect(body(page)).toHaveAttribute('data-toss-count', '1');

  await expect(body(page)).toHaveAttribute('data-toss-state', 'result', { timeout: 10_000 });
  await expect(result).toHaveText(/^(Heads|Tails)$/);

  await page.keyboard.press('Space');
  await expect(body(page)).toHaveAttribute('data-toss-count', '2');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'flying');
  await expect(result).toHaveText('');

  await expect(body(page)).toHaveAttribute('data-toss-state', 'result', { timeout: 10_000 });
  await expect(result).toHaveText(/^(Heads|Tails)$/);
  expect(errors).toEqual([]);
});

test('ignores taps until the physics engine has loaded', async ({ page }) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/*.wasm', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('./');

  await expect(page.locator('body[data-scene-ready="true"]')).toBeAttached();
  await expect(body(page)).toHaveAttribute('data-toss-state', 'loading');
  await page.locator('#scene').tap();
  await page.keyboard.press('Enter');
  await expect(body(page)).toHaveAttribute('data-toss-count', '0');

  release();
  await expect(body(page)).toHaveAttribute('data-toss-state', 'idle', { timeout: 15_000 });
  await page.keyboard.press('Enter');
  await expect(body(page)).toHaveAttribute('data-toss-count', '1');
});

test('keeps tossing unavailable when the physics engine fails to load', async ({ page }) => {
  await page.route('**/*.wasm', (route) => route.abort());
  await page.goto('./');

  await expect(body(page)).toHaveAttribute('data-toss-state', 'error', { timeout: 15_000 });
  await page.locator('#scene').tap();
  await expect(body(page)).toHaveAttribute('data-toss-count', '0');
});
