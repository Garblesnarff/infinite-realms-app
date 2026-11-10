import { expect, test } from '@playwright/test';

/**
 * Public pages (Table 12) measurements against the REAL app entry/AppRoutes
 * served by `vite preview` on a production build (bare routes `/`, `/explore`,
 * `/explore/abyssal-descent`, `/pricing` — NOT e2e/public-pages-layout.html).
 *
 * Only network data is stubbed, via an offline fixture API on 127.0.0.1:4566
 * (PostgREST-shaped `starter_campaigns` rows at /rest/v1/starter_campaigns,
 * matching the use-starter-campaigns producer, and templates at
 * /v1/starter-character-templates, matching userDataApi.listStarterCharacterTemplates).
 * The fixture env is baked in at build time: VITE_SUPABASE_URL=http://127.0.0.1:4566,
 * VITE_API_URL=http://127.0.0.1:4566, VITE_SUPABASE_ANON_KEY=dummy-anon-key-for-harness.
 * Any request outside 127.0.0.1 ports 4565/4566 is aborted, so no live
 * provider, Supabase database, or production service is touched.
 *
 * Each route must fit without sideways scroll at 1280 and 390, the body must
 * carry the default Table look (`ir-table-look`, from useTableLook defaults
 * Table on), and the primary control must stay a 44px target in both axes.
 */
const origin = process.env.PUBLIC_LAYOUT_ORIGIN ?? 'http://127.0.0.1:4565';
const screenshotDir = '/workspace/night-queue/1432-screenshots';
const finalSentence = 'The final gate bears a silver fox and opens into daylight.';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const allowed = url.hostname === '127.0.0.1' && (url.port === '4565' || url.port === '4566');
    return allowed ? route.continue() : route.abort();
  });
  await page.route('**/audio/landing-voice-sample.mp3', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'audio/mpeg',
      body: Buffer.alloc(0),
    });
  });
});

const routes = ['/', '/explore', '/explore/abyssal-descent', '/pricing'] as const;

const headings: Record<string, { name: string | RegExp; exact?: boolean }> = {
  '/': { name: /THE 5E CAMPAIGN/i },
  '/explore': { name: /explore adventures/i },
  '/explore/abyssal-descent': { name: 'Abyssal Descent', exact: true },
  '/pricing': { name: 'Play free. Upgrade when you want more.' },
};

for (const width of [1280, 390]) {
  for (const route of routes) {
    test(`${route} fits ${width}px without sideways scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${origin}${route}`);
      const heading = headings[route];
      await expect(
        page.getByRole('heading', { name: heading.name as string, exact: heading.exact ?? false }),
      ).toBeVisible({ timeout: 15_000 });

      await expect(page.locator('body')).toHaveClass(/ir-table-look/);

      const geometry = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        width: document.documentElement.scrollWidth,
      }));
      expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);

      const expectTarget44 = async (locator: ReturnType<typeof page.getByRole>) => {
        await expect(locator).toBeVisible({ timeout: 15_000 });
        const box = await locator.boundingBox();
        expect(box).not.toBeNull();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      };

      if (route === '/') {
        await expect(page.getByText('Open beta · Free to play · No waitlist')).toBeVisible();
        await expectTarget44(page.getByRole('link', { name: /roll for initiative/i }).first());
        const voicePlay = page.getByRole('button', { name: /voice sample/i });
        await expect(voicePlay).toBeVisible({ timeout: 15_000 });
        const voiceBox = await voicePlay.boundingBox();
        expect(voiceBox).not.toBeNull();
        expect(voiceBox?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect(voiceBox?.width ?? 0).toBeGreaterThanOrEqual(44);
        await page.screenshot({ path: `${screenshotDir}/landing-${width}.png` });
      } else if (route === '/explore') {
        await expect(page.getByText('Open the box').first()).toBeVisible();
        await expectTarget44(page.getByRole('link', { name: /explore .* campaign/i }).first());
      } else if (route === '/explore/abyssal-descent') {
        await expect(page.getByRole('button', { name: 'Choose Bram', exact: true })).toBeVisible();
        await expectTarget44(
          page.getByRole('button', { name: /sign in to play as bram/i }).first(),
        );
        const story = page.locator('section[aria-labelledby="campaign-story"]');
        await expect(story).not.toContainText(finalSentence);
        const more = page.getByRole('button', { name: 'Read more', exact: true });
        await expectTarget44(more);
        await more.click();
        await expect(story).toContainText(finalSentence);
        await expectTarget44(page.getByRole('button', { name: 'Show less', exact: true }));
        await page.screenshot({ path: `${screenshotDir}/campaign-${width}.png` });
      } else {
        await expectTarget44(page.getByRole('link', { name: /play free/i }).first());
      }
    });
  }
}

test('landing hero pill exact text at 1280', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto(`${origin}/`);
  await expect(page.getByText('Open beta · Free to play · No waitlist')).toBeVisible();
  const text = await page.getByText('Open beta · Free to play · No waitlist').textContent();
  expect(text?.trim()).toEqual('Open beta · Free to play · No waitlist');
});
