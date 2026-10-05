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

/** Opens the game with settings saved by an earlier visit. */
async function openWith(page: Page, settings: Record<string, unknown>): Promise<void> {
  await page.addInitScript((saved) => {
    localStorage.setItem('flip-a-coin:settings', JSON.stringify(saved));
  }, settings);
  await page.goto('./');
}

test('rolls a d20 on tap, ignores taps in flight, shows and announces the number', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openWith(page, { tab: 'dice', die: 'd20' });

  await expect(body(page)).toHaveAttribute('data-item', 'd20');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'idle', { timeout: 15_000 });
  const canvas = page.locator('#scene');
  const result = page.locator('#toss-result');
  const caption = page.locator('#roll-number');
  await expect(caption).toBeHidden();

  await canvas.tap();
  await expect(body(page)).toHaveAttribute('data-toss-state', 'flying');
  await canvas.tap();
  await page.keyboard.press('Space');
  await expect(body(page)).toHaveAttribute('data-toss-count', '1');

  await expect(body(page)).toHaveAttribute('data-toss-state', 'result', { timeout: 10_000 });
  await expect(result).toHaveText(/^Rolled ([1-9]|1[0-9]|20)$/);
  const rolled = (await result.textContent())!.replace('Rolled ', '');
  await expect(caption).toBeVisible();
  await expect(caption).toHaveText(rolled);
  await expect(caption).toHaveAttribute('aria-hidden', 'true');

  // Space is ignored until the camera settles on the landed die.
  await expect(async () => {
    await page.keyboard.press('Space');
    await expect(body(page)).toHaveAttribute('data-toss-count', '2', { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await expect(caption).toBeHidden();
  await expect(result).toHaveText('');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'result', { timeout: 10_000 });
  await expect(result).toHaveText(/^Rolled ([1-9]|1[0-9]|20)$/);
  expect(errors).toEqual([]);
});

test('ignores a tap while the camera settles on the landed die', async ({ page }) => {
  await page.clock.install();
  await openWith(page, { tab: 'dice', die: 'd6' });
  await expect(body(page)).toHaveAttribute('data-toss-state', 'idle', { timeout: 15_000 });
  // A paused clock advances frames only on runFor, so the tap lands within 50 ms of landing.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  const canvas = page.locator('#scene');

  await canvas.tap();
  await expect(body(page)).toHaveAttribute('data-toss-state', 'flying');
  for (let i = 0; i < 200; i += 1) {
    if ((await body(page).getAttribute('data-toss-state')) === 'result') break;
    await page.clock.runFor(50);
  }
  await expect(body(page)).toHaveAttribute('data-toss-state', 'result');
  await expect(page.locator('#toss-result')).toHaveText(/^Rolled [1-6]$/);

  await canvas.tap();
  await expect(body(page)).toHaveAttribute('data-toss-count', '1');

  await page.clock.runFor(1000);
  await canvas.tap();
  await expect(body(page)).toHaveAttribute('data-toss-count', '2');
});

test('opens the coin for an unknown saved tab and shows no caption after a toss', async ({
  page,
}) => {
  await openWith(page, { tab: 'die', die: 'd6' });
  await expect(body(page)).toHaveAttribute('data-item', 'coin');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'idle', { timeout: 15_000 });

  await page.locator('#scene').tap();
  await expect(body(page)).toHaveAttribute('data-toss-state', 'result', { timeout: 10_000 });
  await expect(page.locator('#toss-result')).toHaveText(/^(Heads|Tails)$/);
  await expect(page.locator('#roll-number')).toBeHidden();
});

test('opens the d20 for an unknown saved die on the dice tab', async ({ page }) => {
  await openWith(page, { tab: 'dice', die: 'd7' });
  await expect(body(page)).toHaveAttribute('data-item', 'd20');
});
