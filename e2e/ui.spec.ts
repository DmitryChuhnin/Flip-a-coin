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
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/** Taps the table until a toss starts; a tap during a swap or a camera move is ignored. */
async function tossOnce(page: Page, count: string): Promise<void> {
  await expect(async () => {
    await page.locator('#scene').tap();
    await expect(body(page)).toHaveAttribute('data-toss-count', count, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

test('switches between the coin and a die and remembers the choice', async ({ page }) => {
  // Three page loads and a roll: about 30 s on a CI runner with software WebGL.
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await page.goto('./');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'idle', { timeout: 15_000 });
  await expect(page.locator('#hint')).toHaveText('Tap to toss');
  await expect(button(page, 'Coin')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#tray')).toBeHidden();

  await button(page, 'Dice').click();
  await expect(body(page)).toHaveAttribute('data-item', 'd20');
  await expect(page.locator('#tray')).toBeVisible();
  await button(page, 'd6').click();
  await expect(body(page)).toHaveAttribute('data-item', 'd6');
  await expect(button(page, 'd6')).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(body(page)).toHaveAttribute('data-item', 'd6');
  await expect(button(page, 'Dice')).toHaveAttribute('aria-pressed', 'true');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'idle', { timeout: 15_000 });

  await tossOnce(page, '1');
  await expect(page.locator('#hint')).toBeHidden();
  await expect(body(page)).toHaveAttribute('data-toss-state', 'result', { timeout: 10_000 });
  await expect(page.locator('#toss-result')).toHaveText(/^Rolled [1-6]$/);

  await button(page, 'Coin').click();
  await expect(body(page)).toHaveAttribute('data-item', 'coin');
  await expect(page.locator('#roll-number')).toBeHidden();
  await expect(page.locator('#toss-result')).toHaveText('');

  await page.reload();
  await expect(body(page)).toHaveAttribute('data-item', 'coin');
  await expect(page.locator('#hint')).toBeHidden();
  expect(errors).toEqual([]);
});

test('locks the item controls in flight but not the sound button', async ({ page }) => {
  await page.goto('./');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'idle', { timeout: 15_000 });
  const sound = button(page, 'Sound');
  await expect(sound).toHaveAttribute('aria-pressed', 'true');

  await tossOnce(page, '1');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'flying');
  await expect(button(page, 'Dice')).toBeDisabled();
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'false');

  await expect(body(page)).toHaveAttribute('data-toss-state', 'result', { timeout: 10_000 });
  await expect(button(page, 'Dice')).toBeEnabled();
  await page.reload();
  await expect(button(page, 'Sound')).toHaveAttribute('aria-pressed', 'false');
});

test('starts with the coin and no errors when storage is blocked', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
  });
  await page.goto('./');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'idle', { timeout: 15_000 });
  await expect(body(page)).toHaveAttribute('data-item', 'coin');

  await button(page, 'Dice').click();
  await expect(body(page)).toHaveAttribute('data-item', 'd20');
  await tossOnce(page, '1');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'result', { timeout: 10_000 });
  expect(errors).toEqual([]);
});

test('moves the dice tray to the right edge on a landscape phone', async ({ page }) => {
  await page.setViewportSize({ width: 915, height: 412 });
  await page.goto('./');
  await button(page, 'Dice').click();
  await expect(page.locator('#tray')).toBeVisible();
  const tray = await page.locator('#tray').boundingBox();
  // The resting die sits in the middle of the lower half; the tray must stay off it.
  expect(tray!.x).toBeGreaterThan(915 * 0.75);
  expect(tray!.y + tray!.height).toBeLessThanOrEqual(412);
});

test('replaces the dice tray and the hint with the reload panel when the engine fails', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('flip-a-coin:settings', JSON.stringify({ tab: 'dice', die: 'd6' }));
  });
  await page.route('**/*.wasm', (route) => route.abort());
  await page.goto('./');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'error', { timeout: 15_000 });
  await expect(page.locator('#tray')).toBeHidden();
  await expect(page.locator('#hint')).toBeHidden();
  await expect(button(page, 'Coin')).toBeDisabled();
  await expect(button(page, 'Sound')).toBeEnabled();

  const reloaded = page.waitForEvent('load');
  await button(page, 'Reload').click();
  await reloaded;
});
