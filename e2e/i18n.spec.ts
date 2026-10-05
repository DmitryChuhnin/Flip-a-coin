import { expect, test, type Page } from '@playwright/test';

const body = (page: Page) => page.locator('body');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.describe('in a Russian browser', () => {
  test.use({ locale: 'ru-RU' });

  test('shows the game in Russian with a Cyrillic font', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('./');
    await expect(body(page)).toHaveAttribute('data-toss-state', 'idle', { timeout: 15_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page).toHaveTitle('Подбрось монетку');
    await expect(page.locator('#hint')).toHaveText('Тапни, чтобы бросить');
    await expect(button(page, 'Монетка')).toHaveAttribute('aria-pressed', 'true');
    await expect(button(page, 'Звук')).toBeVisible();
    // The Cyrillic face is fetched only once Cyrillic text is on screen.
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.fonts].some(
            (face) => face.family.includes('Nunito') && face.status === 'loaded',
          ),
        ),
      )
      .toBe(true);

    await expect(async () => {
      await page.locator('#scene').tap();
      await expect(body(page)).toHaveAttribute('data-toss-count', '1', { timeout: 500 });
    }).toPass({ timeout: 10_000 });
    await expect(body(page)).toHaveAttribute('data-toss-state', 'result', { timeout: 10_000 });
    await expect(page.locator('#toss-result')).toHaveText(/^(Орёл|Решка)$/);
    expect(errors).toEqual([]);
  });
});

test.describe('in a Ukrainian browser', () => {
  test.use({ locale: 'uk-UA' });

  test('falls back to English', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#hint')).toHaveText('Tap to toss', { timeout: 15_000 });
  });
});
