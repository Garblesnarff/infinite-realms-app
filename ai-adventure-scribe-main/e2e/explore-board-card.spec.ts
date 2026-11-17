import { expect, test } from '@playwright/test';

/**
 * Public Explore page card (#1610). The /explore page must show the
 * PublicExplore board card (one navy card per campaign, "Begin your journey")
 * at 1280 and at 390, with no sideways scroll and 44 px targets.
 *
 * Network data is stubbed in the test, so no live API, Supabase database or DM
 * is touched. Only `starter_campaigns` is fulfilled; every other request off
 * 127.0.0.1 ports 4565/4566 is aborted.
 */
const origin = process.env.PUBLIC_LAYOUT_ORIGIN ?? 'http://127.0.0.1:4565';

const fixtureRows = [
  {
    id: 'fixture-abyssal',
    slug: 'abyssal-descent',
    title: 'Abyssal Descent',
    tagline: null,
    genre: ['horror', 'survival'],
    tone: ['dark'],
    difficulty: 'hard',
    level_range: '1',
    estimated_sessions: '10–15',
    premise:
      'The party joins an expedition to descend the Infinite Chasm, a vertical cave system that supposedly reaches the center of the earth.',
    is_complete: true,
    is_published: true,
    is_featured: false,
    cover_image_url: null,
    banner_image_url: null,
  },
  {
    id: 'fixture-feast',
    slug: 'the-eternal-feast',
    title: 'The Eternal Feast',
    tagline: null,
    genre: ['fantasy'],
    tone: ['warm'],
    difficulty: 'medium',
    level_range: '1',
    estimated_sessions: null,
    premise: 'A legendary restaurant that exists between dimensions.',
    is_complete: true,
    is_published: true,
    is_featured: false,
    cover_image_url: null,
    banner_image_url: null,
  },
];

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const allowed = url.hostname === '127.0.0.1' && (url.port === '4565' || url.port === '4566');
    return allowed ? route.continue() : route.abort();
  });
  // Registered after the catch-all, so it wins for the campaign list request.
  await page.route('**/rest/v1/starter_campaigns*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixtureRows),
    }),
  );
});

for (const width of [1280, 390]) {
  test(`/explore shows the board navy card at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/explore`);

    await expect(page.getByRole('heading', { level: 1, name: 'Explore adventures' })).toBeVisible({
      timeout: 15_000,
    });

    const card = page.getByRole('link', { name: /Abyssal Descent/ });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('href', '/explore/abyssal-descent');
    await expect(card).toContainText('Begin your journey');
    await expect(card).toContainText('Level 1 · 10–15 sessions');
    await expect(card).toHaveCSS('background-color', 'rgb(12, 18, 32)');
    await expect(page.getByText('Open the box')).toHaveCount(0);

    const cta = card.getByText('Begin your journey');
    await expect(cta).toHaveCSS('color', 'rgb(213, 176, 112)');

    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);

    const geometry = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      width: document.documentElement.scrollWidth,
    }));
    expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
  });
}
