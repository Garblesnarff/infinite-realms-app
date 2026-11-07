import { expect, test } from '@playwright/test';

import config from '../playwright.config';

const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];
const layoutUrl =
  process.env.TABLE_LAYOUT_BASE_URL ??
  servers.find((server) => server?.url?.includes('/e2e/game-panel-layout.html'))?.url;
if (!layoutUrl) throw new Error('The layout web server is not configured');

for (const width of [1280, 390]) {
  test(`roll verdicts fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(new URL('/e2e/table-roll-seal.html', layoutUrl).toString());
    await expect(
      page.getByLabel('Resolved narrative check').getByTestId('engine-roll-seal'),
    ).toHaveText('SUCCESS');
    await expect(
      page.getByLabel('Resolved engine attack').getByTestId('engine-roll-seal'),
    ).toHaveText('20 CRIT');
    await expect(
      page.getByLabel('Missed engine attack').getByTestId('engine-roll-seal'),
    ).toHaveText('MISS');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    if (width === 1280)
      await page.screenshot({ path: test.info().outputPath('table-roll-seal-1280.png') });
  });
}
