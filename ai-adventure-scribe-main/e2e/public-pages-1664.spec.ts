import { expect, test } from '@playwright/test';

/**
 * #1664: the nine layout defects from the public boards check, measured at 1280 and 390.
 *
 * Runs against a production build served on PUBLIC_LAYOUT_ORIGIN (default 127.0.0.1:4565), built
 * with VITE_SUPABASE_URL and VITE_API_URL set to the offline fixture in e2e/fixtures/public-pages-api.mjs
 * (port 4566). Every other request is aborted, so no live service is touched.
 */
const origin = process.env.PUBLIC_LAYOUT_ORIGIN ?? 'http://127.0.0.1:4565';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const allowed = url.hostname === '127.0.0.1' && (url.port === '4565' || url.port === '4566');
    return allowed ? route.continue() : route.abort();
  });
});

for (const width of [1280, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });

    test('campaign page: hero fan, title line, tap targets, sign-in button (items 1-4)', async ({
      page,
    }) => {
      await page.goto(`${origin}/explore/abyssal-descent`);
      await expect(
        page.getByRole('heading', { name: 'Abyssal Descent', exact: true }),
      ).toBeVisible();

      // Item 2: the title is not repeated as a second line.
      const titleLine = await page
        .getByRole('heading', { name: 'Abyssal Descent', exact: true })
        .evaluate((h) => h.nextElementSibling?.textContent?.trim() ?? '');
      expect(titleLine).not.toBe('Abyssal Descent');

      // Item 1: the fan either fits, or starts at the first card with padding and scrolls.
      const fan = await page.getByRole('group', { name: 'Choose your hero' }).evaluate((row) => {
        const cards = [...row.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
        const box = row.getBoundingClientRect();
        return {
          rowLeft: box.left,
          rowRight: box.right,
          firstLeft: cards[0].left,
          scrolls: row.scrollWidth > row.clientWidth,
          allVisible: cards.every((c) => c.left >= box.left && c.right <= box.right),
        };
      });
      expect(fan.firstLeft).toBeGreaterThanOrEqual(fan.rowLeft);
      expect(fan.allVisible || fan.scrolls).toBe(true);

      // Item 3: back link and footer link are 44 px tall.
      for (const name of [/All campaigns/, /^Infinite Realms$/]) {
        const box = await page.getByRole('link', { name }).last().boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }

      // Item 4: the sign-in button text is on one line.
      const lines = await page
        .getByRole('button', { name: /sign in to play as/i })
        .first()
        .evaluate((button) => {
          const range = document.createRange();
          range.selectNodeContents(button);
          return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
        });
      expect(lines).toBe(1);

      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
    });

    test('landing: Example label, header tap targets, memory card inset, join heading (items 5-7)', async ({
      page,
    }) => {
      await page.goto(`${origin}/`);
      await expect(page.getByRole('heading', { name: /THE 5E CAMPAIGN/i })).toBeVisible();

      // Item 5: the Example label is at least 12 px.
      const exampleSize = await page
        .getByText('Example', { exact: true })
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(exampleSize).toBeGreaterThanOrEqual(12);

      // Item 6: the logo link and Sign in are 44 px tall.
      const logo = await page.getByRole('link', { name: 'Infinite Realms home' }).boundingBox();
      const signIn = await page.getByRole('link', { name: 'Sign in' }).boundingBox();
      expect(logo?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(signIn?.height ?? 0).toBeGreaterThanOrEqual(44);

      // Item 7: the memory card sits 16 px in on phones, and the join heading is not loosely spaced.
      if (width === 390) {
        const card = await page
          .getByText('The DM remembers this story.')
          .locator('xpath=..')
          .boundingBox();
        expect(card?.x ?? 0).toBeGreaterThanOrEqual(15.5);
        expect(card?.x ?? 0).toBeLessThanOrEqual(16.5);
      }
      const join = await page
        .getByRole('heading', { name: 'Be a founding adventurer' })
        .evaluate((h) => ({
          size: parseFloat(getComputedStyle(h).fontSize),
          line: parseFloat(getComputedStyle(h).lineHeight),
        }));
      expect(join.line / join.size).toBeLessThanOrEqual(1.2);

      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
    });

    test('explore: one header row and one tag row per card (items 8-9)', async ({ page }) => {
      await page.goto(`${origin}/explore`);
      await expect(page.getByRole('heading', { name: /explore adventures/i })).toBeVisible();

      // Item 8: the logo stays on the same row as "Back to home".
      const nav = await page.getByRole('navigation', { name: 'Main' }).evaluate((n) => {
        const back = n.querySelector('a')!.getBoundingClientRect();
        const logo = n
          .querySelector('a[aria-label="Infinite Realms, home"]')!
          .getBoundingClientRect();
        return {
          height: n.getBoundingClientRect().height,
          backTop: back.top,
          logoTop: logo.top,
          logoBottom: logo.bottom,
        };
      });
      expect(Math.abs(nav.logoTop - nav.backTop)).toBeLessThanOrEqual(12);
      expect(nav.height).toBeLessThanOrEqual(64);

      // Item 9: each card's genre tags sit on one row.
      const rows = await page.locator('article a').evaluateAll((links) =>
        links.slice(0, 3).map((link) => {
          const pills = [...link.querySelectorAll('span.rounded-full')].filter(
            (p) => !p.className.includes('absolute'),
          );
          return new Set(pills.map((p) => Math.round(p.getBoundingClientRect().top))).size;
        }),
      );
      for (const count of rows) expect(count).toBe(1);

      // Item 3-style tap targets for the header controls.
      const back = await page.getByRole('link', { name: 'Back to home' }).boundingBox();
      expect(back?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
    });
  });
}
