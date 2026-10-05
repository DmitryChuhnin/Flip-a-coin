import { expect, test } from '@playwright/test';

const body = (page: import('@playwright/test').Page) => page.locator('body');

test('runs offline after the first visit', async ({ page, context }) => {
  await page.goto('./');
  await expect(body(page)).toHaveAttribute('data-toss-state', 'idle', { timeout: 15_000 });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

  await context.setOffline(true);
  await page.reload();
  await expect(body(page)).toHaveAttribute('data-toss-state', 'idle', { timeout: 15_000 });
  await expect(async () => {
    await page.locator('#scene').tap();
    await expect(body(page)).toHaveAttribute('data-toss-count', '1', { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await expect(body(page)).toHaveAttribute('data-toss-state', 'result', { timeout: 10_000 });
});

test('links a manifest whose icons load', async ({ page, request }) => {
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifestUrl = new URL(href!, page.url());
  const manifest = await (await request.get(manifestUrl.href)).json();
  expect(manifest).toMatchObject({ display: 'standalone', start_url: './', scope: './' });
  const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  for (const icon of manifest.icons) {
    const response = await request.get(new URL(icon.src, manifestUrl).href);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toBe('image/png');
  }
});
