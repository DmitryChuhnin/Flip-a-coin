import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test } from '@playwright/test';

const body = (page: import('@playwright/test').Page) => page.locator('body');

/** Width and height from the PNG header. */
const pngSize = (png: Buffer) => `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;

/** Alpha of an image's top-left pixel, from 0 to 255. */
const cornerAlpha = (page: import('@playwright/test').Page, src: string) =>
  page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const context = new OffscreenCanvas(1, 1).getContext('2d')!;
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, 1, 1).data[3];
  }, src);

/** The linked manifest as Chromium parsed it; `id` resolves against the origin, not the file. */
async function parsedManifest(page: import('@playwright/test').Page) {
  const cdp = await page.context().newCDPSession(page);
  return {
    ...(await cdp.send('Page.getAppManifest')),
    ...(await cdp.send('Page.getInstallabilityErrors')),
  };
}

/**
 * Loads the page, waits for the worker and reloads, so the page is under the worker's control.
 * WebGL is off: these tests check the worker, and the software-rendered scene only slows them.
 */
async function controlledPage(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

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

test('links an installable manifest of the game path whose icons load', async ({
  page,
  request,
}) => {
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifestUrl = new URL(href!, page.url());
  const manifest = await (await request.get(manifestUrl.href)).json();
  expect(manifest).toMatchObject({ display: 'standalone', start_url: './', scope: './' });
  const parsed = await parsedManifest(page);
  expect(parsed.errors).toEqual([]);
  expect(parsed.installabilityErrors).toEqual([]);
  // An id at the origin root would be shared by every app on the origin.
  const game = new URL('/flip-a-coin/', page.url()).href;
  expect(parsed.manifest).toMatchObject({ id: game, startUrl: game, scope: game });
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    'content',
    manifest.theme_color,
  );
  const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(manifest.icons).toContainEqual(
    expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
  );
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, manifestUrl).href;
    const response = await request.get(url);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toBe('image/png');
    expect(pngSize(await response.body())).toBe(icon.sizes);
    // Desktops show the plain icons unmasked, so only the maskable one fills its square.
    expect(await cornerAlpha(page, url)).toBe(icon.purpose === 'maskable' ? 255 : 0);
  }
  const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  const response = await request.get(new URL(touchIcon!, page.url()).href);
  expect(response.ok()).toBe(true);
  expect(pngSize(await response.body())).toBe('180x180');
});

test('registers the worker for the game path only', async ({ page }) => {
  await page.goto('./');
  const scope = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.scope));
  expect(scope).toBe(new URL('/flip-a-coin/', page.url()).href);
  const scopes = await page.evaluate(() =>
    navigator.serviceWorker.getRegistrations().then((all) => all.map((r) => r.scope)),
  );
  expect(scopes).toEqual([scope]);
});

test('loads the page from the network while online, so a deploy shows at the next launch', async ({
  page,
  context,
}) => {
  await controlledPage(page);
  const next = readFileSync(join(import.meta.dirname, '..', 'dist', 'index.html'), 'utf8').replace(
    '<body>',
    '<body data-deploy="next">',
  );
  // The worker's own requests go through the context routes too.
  await context.route('**/flip-a-coin/', (route) =>
    route.fulfill({ contentType: 'text/html', body: next }),
  );
  await page.reload();
  await expect(body(page)).toHaveAttribute('data-deploy', 'next');
});

test('opens the cached page when the server fails it', async ({ page, context }) => {
  await controlledPage(page);
  await context.route('**/flip-a-coin/', (route) => route.fulfill({ status: 503, body: 'down' }));
  await page.reload();
  await expect(page.locator('#scene')).toBeAttached();
});

test('precaches every built file except the worker itself', () => {
  const dist = join(import.meta.dirname, '..', 'dist');
  const built = readdirSync(dist, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dist, join(entry.parentPath, entry.name)))
    .filter((name) => name !== 'sw.js' && name !== 'index.html');
  const worker = readFileSync(join(dist, 'sw.js'), 'utf8');
  const list = (name: string) =>
    JSON.parse(new RegExp(`const ${name} = (\\[.*\\]);`).exec(worker)![1]!) as string[];
  expect([...list('HASHED'), ...list('FRESH')].sort()).toEqual(built.sort());
});
