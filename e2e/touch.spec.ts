import { expect, test, type Page } from '@playwright/test';

const style = (page: Page, selector: string) =>
  page.locator(selector).evaluate((element) => {
    const computed = getComputedStyle(element);
    return { touchAction: computed.touchAction, userSelect: computed.userSelect };
  });

// These tests read CSS only; without WebGL the page skips the software-rendered scene.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
});

test('turns off double-tap zoom and text selection but keeps the scene gestures', async ({
  page,
}) => {
  await page.goto('./');
  expect((await style(page, 'html')).touchAction).toBe('manipulation');
  expect(await style(page, 'body')).toEqual({ touchAction: 'manipulation', userSelect: 'none' });
  expect((await style(page, '#scene')).touchAction).toBe('none');

  await page.evaluate(() => {
    const text = document.createElement('p');
    text.id = 'probe';
    text.textContent = 'Heads and tails';
    text.style.cssText = 'position: fixed; top: 40%; left: 0; z-index: 1; font-size: 32px';
    document.body.append(text);
  });
  await page.locator('#probe').dblclick();
  expect(await page.evaluate(() => getSelection()!.toString())).toBe('');
});

test('keeps form fields selectable', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => {
    for (const html of ['<input id="field">', '<textarea></textarea>', '<div contenteditable>']) {
      document.body.insertAdjacentHTML('beforeend', html);
    }
  });
  for (const selector of ['input', 'textarea', '[contenteditable]']) {
    expect((await style(page, selector)).userSelect).toBe('text');
  }
});
