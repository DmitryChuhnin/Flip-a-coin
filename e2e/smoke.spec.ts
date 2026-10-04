import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('renders the scene full-screen without errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');

  await expect(page.locator('body[data-scene-ready="true"]')).toBeAttached();
  const canvas = page.locator('#scene');
  await expect(canvas).toBeVisible();
  await expect(page.locator('#webgl-error')).toBeHidden();

  const box = await canvas.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box).toEqual({ x: 0, y: 0, width: viewport!.width, height: viewport!.height });

  expect(errors).toEqual([]);
});

test('tapping the canvas produces no errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await expect(page.locator('body[data-scene-ready="true"]')).toBeAttached();

  await page.locator('#scene').tap();
  await page.locator('#scene').tap({ position: { x: 10, y: 10 } });

  expect(errors).toEqual([]);
});

test('shows a fallback message when WebGL2 is unavailable', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ) {
      if (type === 'webgl2') return null;
      return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  await page.goto('./');

  await expect(page.locator('#webgl-error')).toBeVisible();
  await expect(page.locator('#webgl-error')).toHaveText('WebGL is not available');
  await expect(page.locator('body')).not.toHaveAttribute('data-scene-ready');
  expect(errors).toEqual([]);
});
