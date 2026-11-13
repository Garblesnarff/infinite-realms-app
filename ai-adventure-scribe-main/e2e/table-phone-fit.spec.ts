import { expect, test } from '@playwright/test';

import config from '../playwright.config';

import type { Page } from '@playwright/test';

// #1503, #1504, #1505, #1507: the Table story chrome, turn strip and seals fit at 390 px and 1280 px.
// A new spec on purpose: table-game-layout.spec.ts and table-roll-seal.spec.ts are edited by other open PRs.

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
    if (path.endsWith('/legal-actions'))
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          actorId: 'hero',
          actions: [
            {
              type: 'attack',
              label: 'Attack with Quarterstaff',
              weaponId: 'quarterstaff',
              targetIds: ['foe'],
            },
            { type: 'dodge', label: 'Dodge' },
            { type: 'end_turn', label: 'End turn' },
          ],
        }),
      });
    if (path.endsWith('/tactical-map'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"map":null}' });
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
}

const widths = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];

for (const { width, height } of widths) {
  test(`#1503 the timeline rail dots sit inside the viewport and the parchment at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await stubSession(page);
    await page.goto(new URL('/e2e/table-game-layout.html', layoutUrl).toString());
    await expect(page.getByTestId('story-box')).toBeVisible();
    await expect(page.locator('.timeline-dot').first()).toBeAttached();
    const boxes = await page.evaluate(() => {
      const rect = (el: Element) => {
        const b = el.getBoundingClientRect();
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
      };
      const story = rect(document.querySelector('[data-testid="story-box"]')!);
      const dots = Array.from(document.querySelectorAll('.timeline-dot')).map(rect);
      return { story, dots, viewport: document.documentElement.clientWidth };
    });
    expect(boxes.dots.length).toBeGreaterThan(0);
    for (const dot of boxes.dots) {
      expect(dot.left).toBeGreaterThanOrEqual(0);
      expect(dot.right).toBeLessThanOrEqual(boxes.viewport);
      expect(dot.left).toBeGreaterThanOrEqual(boxes.story.left);
      expect(dot.right).toBeLessThanOrEqual(boxes.story.right);
    }
  });

  test(`#1503 the Illustrate pill stays inside the parchment when its message is brought into view at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await stubSession(page);
    await page.goto(new URL('/e2e/table-game-layout.html', layoutUrl).toString());
    await expect(page.getByTestId('story-box')).toBeVisible();
    const pill = page.getByRole('button', { name: 'Illustrate this scene' }).first();
    await expect(pill).toBeAttached();
    await pill.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await page.waitForTimeout(300);
    const boxes = await page.evaluate(() => {
      const rect = (el: Element) => {
        const b = el.getBoundingClientRect();
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
      };
      const story = rect(document.querySelector('[data-testid="story-box"]')!);
      const button = Array.from(document.querySelectorAll('button')).find((b) =>
        /Illustrate this scene/.test(b.textContent ?? ''),
      )!;
      return { story, pill: rect(button), viewport: document.documentElement.clientWidth };
    });
    expect(boxes.pill.left).toBeGreaterThanOrEqual(0);
    expect(boxes.pill.right).toBeLessThanOrEqual(boxes.viewport);
    expect(boxes.pill.top).toBeGreaterThanOrEqual(boxes.story.top);
    expect(boxes.pill.bottom).toBeLessThanOrEqual(boxes.story.bottom);
  });
}

// #1504: the combat turn strip. The fixture's combat view is the same one the Table shell tests use.
for (const { width, height } of widths) {
  test(`#1504 the turn strip keeps its text readable and its chips in their own row at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await stubSession(page);
    await page.goto(new URL('/e2e/table-game-layout.html?combat=true', layoutUrl).toString());
    await expect(page.getByTestId('combat-turn-bar').first()).toBeVisible();
    const strip = await page.evaluate(() => {
      const rect = (el: Element | null) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return {
          left: b.left,
          right: b.right,
          top: b.top,
          bottom: b.bottom,
          scrollWidth: (el as HTMLElement).scrollWidth,
          clientWidth: (el as HTMLElement).clientWidth,
        };
      };
      const bar = rect(document.querySelector('[data-testid="combat-turn-bar"]'));
      const pips = document.querySelector('[data-testid="combat-turn-pip"]')?.parentElement ?? null;
      return {
        bar,
        viewport: document.documentElement.clientWidth,
        text: rect(document.querySelector('[data-testid="combat-turn-text"]')),
        sub: rect(document.querySelector('[data-testid="combat-turn-sub"]')),
        next: rect(document.querySelector('[data-testid="combat-turn-next"]')),
        chips: rect(pips),
      };
    });
    expect(strip.bar!.right).toBeLessThanOrEqual(strip.viewport);
    expect(strip.text!.scrollWidth).toBeLessThanOrEqual(strip.text!.clientWidth);
    expect(strip.sub!.scrollWidth).toBeLessThanOrEqual(strip.sub!.clientWidth);
    expect(strip.chips!.right).toBeLessThanOrEqual(strip.viewport);
    // The chips row scrolls inside itself; it never widens the page.
    const page_ = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(page_).toBeLessThanOrEqual(strip.viewport);
  });
}

test('#1504 the dying instruction is fully readable at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(new URL('/e2e/death-end-layout.html?view=turnbar', layoutUrl).toString());
  await expect(page.getByTestId('combat-turn-sub')).toBeVisible();
  const sub = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="combat-turn-sub"]') as HTMLElement;
    const b = el.getBoundingClientRect();
    return {
      text: el.textContent ?? '',
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      right: b.right,
      viewport: document.documentElement.clientWidth,
    };
  });
  expect(sub.text).toContain('roll a death saving throw');
  expect(sub.scrollWidth).toBeLessThanOrEqual(sub.clientWidth);
  expect(sub.right).toBeLessThanOrEqual(sub.viewport);
});

// #1505: a sealed result card's seal never covers its title.
for (const { width, height } of widths) {
  test(`#1505 sealed card titles and seals do not intersect at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route('**/v1/**', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
    );
    await page.goto(new URL('/e2e/table-roll-seal.html', layoutUrl).toString());
    await expect(page.getByLabel('Save result')).toBeVisible();
    const pairs = await page.evaluate(() => {
      const rect = (el: Element) => {
        const b = el.getBoundingClientRect();
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
      };
      return Array.from(document.querySelectorAll('.engine-card-head')).flatMap((head) => {
        const wrapper = head.closest('.relative');
        const seal = wrapper?.querySelector('[data-testid="engine-roll-seal"]');
        const title = head.firstElementChild;
        if (!seal || !title) return [];
        return [{ title: rect(title), seal: rect(seal), text: title.textContent ?? '' }];
      });
    });
    expect(pairs.length).toBeGreaterThan(0);
    for (const { title, seal } of pairs) {
      const overlaps =
        seal.left < title.right &&
        title.left < seal.right &&
        seal.top < title.bottom &&
        title.top < seal.bottom;
      expect(overlaps).toBe(false);
    }
  });
}
