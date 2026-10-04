import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    rafCalls: number;
  }
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function waitForScene(page: Page): Promise<void> {
  await expect(page.locator('body[data-scene-ready="true"]')).toBeAttached();
}

test('renders the scene full-screen without errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');

  await waitForScene(page);
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

test('resizes the drawing buffer to the new viewport with pixel ratio capped at 2', async ({
  page,
}) => {
  await page.goto('./');
  await waitForScene(page);

  await page.setViewportSize({ width: 915, height: 412 });

  await expect
    .poll(() =>
      page.locator('#scene').evaluate((canvas: HTMLCanvasElement) => {
        const ratio = Math.min(window.devicePixelRatio, 2);
        return {
          clientWidth: canvas.clientWidth,
          width: canvas.width,
          expectedWidth: Math.floor(canvas.clientWidth * ratio),
          height: canvas.height,
          expectedHeight: Math.floor(canvas.clientHeight * ratio),
        };
      }),
    )
    .toEqual({
      clientWidth: 915,
      width: 1830,
      expectedWidth: 1830,
      height: 824,
      expectedHeight: 824,
    });
});

test('pauses the render loop while the tab is hidden and resumes when visible', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.rafCalls = 0;
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      window.rafCalls += 1;
      return original(callback);
    };
  });
  await page.goto('./');
  await waitForScene(page);

  const setHidden = (hidden: boolean) =>
    page.evaluate((value) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (value ? 'hidden' : 'visible'),
      });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  const rafCalls = () => page.evaluate(() => window.rafCalls);

  await setHidden(true);
  const whileHidden = await rafCalls();
  await page.waitForTimeout(300);
  expect(await rafCalls()).toBe(whileHidden);

  await setHidden(false);
  await expect.poll(rafCalls).toBeGreaterThan(whileHidden);
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
