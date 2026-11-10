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
    await page.waitForTimeout(1600);
    await expect(
      page.getByLabel('Ability check result').getByTestId('engine-roll-seal'),
    ).toHaveText('SUCCESS');
    await expect(page.getByLabel('Save result').getByTestId('engine-roll-seal')).toHaveText(/FAIL/);
    await expect(page.getByLabel('Attack result').getByTestId('engine-roll-seal')).toHaveText(
      'HIT',
    );
    await expect(page.getByLabel('Initiative result').getByTestId('engine-roll-seal')).toHaveText(
      '9',
    );
    await expect(page.getByLabel('NPC roll result').getByTestId('engine-roll-seal')).toHaveText(
      'HIT',
    );
    const sections = ['Resolved narrative check', 'Failed narrative check', 'Missed engine attack'];
    for (const section of sections) {
      const ratio = await page
        .getByLabel(section)
        .getByTestId('engine-roll-seal')
        .evaluate((element) => {
          const css = getComputedStyle(element);
          const luminance = (color: string): number => {
            const components = color
              .match(/[\d.]+/g)
              ?.slice(0, 3)
              .map(Number);
            if (!components || components.length !== 3)
              throw new Error(`Unexpected color: ${color}`);
            const channels = components
              .map((value) => value / 255)
              .map((value) =>
                value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
              );
            return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
          };
          const foreground = luminance(css.color);
          const background = luminance(css.backgroundColor);
          return (
            (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
          );
        });
      expect(ratio, `${section} seal contrast`).toBeGreaterThanOrEqual(7);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    if (width === 1280)
      await page.screenshot({ path: test.info().outputPath('table-roll-seal-1280.png') });
  });
}
