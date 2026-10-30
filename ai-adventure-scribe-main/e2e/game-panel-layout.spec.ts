import { expect, test } from '@playwright/test';

const variants = [
  { name: 'desktop without combat', query: '' },
  { name: 'desktop in combat', query: '&combat=true' },
  { name: 'mobile without combat', query: '&mobile=true' },
  { name: 'mobile in combat', query: '&mobile=true&combat=true' },
] as const;

for (const variant of variants) {
  test(`keeps every ${variant.name} tab inside the 280px tablist`, async ({ page }) => {
    await page.setViewportSize({ width: 280, height: 800 });
    await page.goto(`http://127.0.0.1:4173/e2e/game-panel-layout.html?${variant.query}`);

    const tablist = page.getByRole('tablist');
    await expect(tablist).toBeVisible();
    const tabs = tablist.getByRole('tab');
    const tablistBox = await tablist.boundingBox();
    expect(tablistBox).not.toBeNull();
    expect(await tablist.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );

    for (const tab of await tabs.all()) {
      const tabBox = await tab.boundingBox();
      expect(tabBox).not.toBeNull();
      expect(tabBox!.x).toBeGreaterThanOrEqual(tablistBox!.x);
      expect(tabBox!.x + tabBox!.width).toBeLessThanOrEqual(tablistBox!.x + tablistBox!.width + 1);
      await expect(tab).toHaveText(/Sheet|Memory|Combat|Journal/);
    }
  });
}
