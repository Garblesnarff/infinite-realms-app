import { expect, test } from '@playwright/test';

import config from '../playwright.config';

const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];
const layoutUrl =
  process.env.TABLE_LAYOUT_BASE_URL ??
  servers.find((server) => server?.url?.includes('/e2e/game-panel-layout.html'))?.url;
if (!layoutUrl) throw new Error('The layout web server is not configured');

const campaign = {
  id: 'fixture-campaign',
  slug: 'fixture',
  title: 'The Chasm',
  tagline: 'A descent',
  genre: ['horror'],
  tone: [],
  difficulty: 'hard',
  level_range: '1-5',
  estimated_sessions: '8-12',
  premise: 'A descent into the dark.',
  creative_brief: null,
  overview: 'A descent into the dark.',
  is_complete: true,
  is_published: true,
  is_featured: false,
  cover_image_url: null,
  banner_image_url: null,
};
const heroes = ['One', 'Two', 'Three', 'Four', 'Five'].map((name, index) => ({
  id: `hero-${index}`,
  starter_campaign_id: campaign.id,
  template_key: `hero-${index}`,
  name,
  tagline: 'A ready hero.',
  race: 'Human',
  class: 'Fighter',
  level: 1,
  ability_scores: {
    strength: 15,
    dexterity: 12,
    constitution: 14,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
  },
  personality: {},
  skills: [],
  languages: [],
  equipment: [],
  portrait_url: null,
  card_image_url: null,
  display_order: index,
}));

for (const width of [1280, 390]) {
  for (const path of ['/explore', '/explore/fixture']) {
    test(`${path} Table view fits ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.addInitScript(() =>
        document.addEventListener('DOMContentLoaded', () =>
          document.body.classList.add('ir-table-look'),
        ),
      );
      await page.route('**/rest/v1/starter_campaigns**', (route) => {
        const single = route.request().headers().accept?.includes('vnd.pgrst.object');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(single ? campaign : [campaign]),
        });
      });
      await page.route('**/v1/starter-character-templates**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(heroes),
        }),
      );
      await page.goto(new URL(path, layoutUrl).toString());
      await expect(page.getByText('The Chasm').first()).toBeVisible();
      if (path === '/explore') await expect(page.getByText('Open the box')).toBeVisible();
      else await expect(page.getByRole('button', { name: 'Choose One' })).toBeVisible();
      const geometry = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        width: document.documentElement.scrollWidth,
      }));
      expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
      const target =
        path === '/explore'
          ? page.getByRole('link', { name: 'Explore The Chasm campaign' })
          : page.getByRole('button', { name: 'Choose One' });
      const box = await target.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: test.info().outputPath('screen.png') });
    });
  }
}
