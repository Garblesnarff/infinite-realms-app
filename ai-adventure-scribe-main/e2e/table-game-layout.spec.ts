import { expect, test } from '@playwright/test';

import config from '../playwright.config';

import type { Page } from '@playwright/test';

const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];
const layoutUrl =
  process.env.TABLE_LAYOUT_BASE_URL ??
  servers.find((server) => server?.url?.includes('/e2e/game-panel-layout.html'))?.url;
if (!layoutUrl) throw new Error('The layout web server is not configured');
async function stubSession(page: Page): Promise<void> {
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/messages'))
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"messages":[],"total":0}',
      });
    if (path.endsWith('/tactical-map'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"map":null}' });
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
}

for (const width of [1280, 390]) {
  test(`the Table game screen fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await stubSession(page);
    await page.goto(new URL('/e2e/table-game-layout.html', layoutUrl).toString());
    await expect(page.getByTestId('story-box')).toBeVisible();
    await expect(page.getByText('The ledge comes into view.')).toBeVisible();
    const story = await page.getByTestId('story-box').boundingBox();
    expect(story?.height).toBeGreaterThanOrEqual(100);
    const geometry = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      width: document.documentElement.scrollWidth,
      canvases: document.querySelectorAll('canvas').length,
    }));
    expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.canvases).toBeLessThanOrEqual(1);
    const ratios = await page.evaluate(() => {
      const values = getComputedStyle(document.body);
      const luminance = (hex: string): number => {
        const channels = hex
          .trim()
          .slice(1)
          .match(/../g)!
          .map((part) => parseInt(part, 16) / 255)
          .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const contrast = (light: string, dark: string): number =>
        (luminance(values.getPropertyValue(light)) + 0.05) /
        (luminance(values.getPropertyValue(dark)) + 0.05);
      return {
        parchment: contrast('--ir-parchment-2', '--ir-ink'),
        brass: contrast('--ir-brass-2', '--ir-brass-ink'),
      };
    });
    expect(ratios.parchment).toBeGreaterThanOrEqual(7);
    expect(ratios.brass).toBeGreaterThanOrEqual(7);
    const sceneInfo = await page.getByRole('button', { name: 'Show scene details' }).boundingBox();
    expect(sceneInfo!.width).toBeGreaterThanOrEqual(44);
    expect(sceneInfo!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: test.info().outputPath('screen.png') });
  });
}

for (const width of [1280, 390]) {
  test(`the Table check card fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await stubSession(page);
    await page.goto(new URL('/e2e/table-game-layout.html?roll=true', layoutUrl).toString());
    const card = page.getByTestId('dice-roll-request');
    await expect(card).toBeVisible();
    await expect(card.getByRole('switch', { name: /show target numbers/i })).toBeVisible();
    for (const target of [
      card.getByRole('switch', { name: /show target numbers/i }),
      card.getByRole('button', { name: /roll .* for/i }),
      card.getByRole('button', { name: /enable advantage/i }),
      card.getByRole('button', { name: /enter my own roll/i }),
    ]) {
      const box = await target.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const bodyInk = await card
      .getByText('Strength (Athletics)')
      .evaluate((element) => getComputedStyle(element).color);
    expect(bodyInk).toBe('rgb(42, 26, 12)');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect(await page.locator('canvas').count()).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath('screen.png') });
  });
}

test('the check card hides the target until the player turns it on', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.addInitScript(() => localStorage.setItem('ui:showTargetNumbers:v1', 'off'));
  await stubSession(page);
  await page.goto(new URL('/e2e/table-game-layout.html?roll=true', layoutUrl).toString());
  const card = page.getByTestId('dice-roll-request');
  await expect(card.getByText('DC hidden · the DM knows the number')).toBeVisible();
  await expect(card.getByText('DC 12')).toHaveCount(0);
  await card.getByRole('switch', { name: /show target numbers/i }).click();
  await expect(card.getByText('DC 12')).toBeVisible();
});
