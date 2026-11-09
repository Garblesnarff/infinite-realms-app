import { expect, test } from '@playwright/test';

/**
 * Public pages (Table 12) measurements. The real LaunchPage /
 * ExploreGalleryPage / CampaignDetailPage / PricingPage components mount via
 * e2e/public-pages-layout.html with fixture data (no live DB/DM/prod).
 * Each route must fit without sideways scroll at 1280 and 390, and the
 * primary control must stay a 44px target. Landing hero pill text is exact.
 */
const origin = process.env.PUBLIC_LAYOUT_ORIGIN ?? 'http://127.0.0.1:4565';
const screenshotDir = '/workspace/night-queue/1432-screenshots';

const routes = ['/', '/explore', '/explore/abyssal-descent', '/pricing'] as const;

const headings: Record<string, { role: string; name: string }> = {
  '/': { role: 'heading', name: /THE 5E CAMPAIGN/i },
  '/explore': { role: 'heading', name: /explore adventures/i },
  '/explore/abyssal-descent': { role: 'heading', name: 'Abyssal Descent' },
  '/pricing': { role: 'heading', name: 'Play free. Upgrade when you want more.' },
};

for (const width of [1280, 390]) {
  for (const route of routes) {
    test(`${route} fits ${width}px without sideways scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${origin}/e2e/public-pages-layout.html?route=${encodeURIComponent(route)}`);
      const heading = headings[route];
      await expect(
        page.getByRole(heading.role as 'heading', { name: heading.name as string }),
      ).toBeVisible({
        timeout: 15_000,
      });

      const geometry = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        width: document.documentElement.scrollWidth,
      }));
      expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);

      if (route === '/') {
        await expect(page.getByText('Open beta · Free to play · No waitlist')).toBeVisible();
        const cta = page.getByRole('link', { name: /roll for initiative/i }).first();
        await expect(cta).toBeVisible();
        const box = await cta.boundingBox();
        expect(box).not.toBeNull();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        await page.screenshot({ path: `${screenshotDir}/landing-${width}.png` });
      } else if (route === '/explore') {
        const card = page.getByRole('link', { name: /explore .* campaign/i }).first();
        await expect(card).toBeVisible();
        const box = await card.boundingBox();
        expect(box).not.toBeNull();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      } else if (route === '/explore/abyssal-descent') {
        const cta = page.getByRole('button', { name: /sign in to play as bram/i }).first();
        await expect(cta).toBeVisible({ timeout: 15_000 });
        const box = await cta.boundingBox();
        expect(box).not.toBeNull();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        await page.screenshot({ path: `${screenshotDir}/campaign-${width}.png` });
      } else {
        const cta = page.getByRole('link', { name: /play free/i }).first();
        await expect(cta).toBeVisible({ timeout: 15_000 });
        const box = await cta.boundingBox();
        expect(box).not.toBeNull();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
    });
  }
}

test('landing hero pill exact text at 1280', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto(`${origin}/e2e/public-pages-layout.html?route=%2F`);
  await expect(page.getByText('Open beta · Free to play · No waitlist')).toBeVisible();
  const text = await page.getByText('Open beta · Free to play · No waitlist').textContent();
  expect(text?.trim()).toEqual('Open beta · Free to play · No waitlist');
});
