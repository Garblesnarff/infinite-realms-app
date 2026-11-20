import { expect, test } from '@playwright/test';

/**
 * #1672: the signed-in boxed card keeps its genre chips inside the card, one row, whole words, with
 * the difficulty chip always visible; the level prints through formatStarterLevelRange; and the hero
 * row shows an edge fade on the side that is cut off. Served by the Vite dev server at
 * BOXED_LAYOUT_ORIGIN (default 127.0.0.1:4173), page /e2e/boxed-campaign-1672.html.
 */
const origin = process.env.BOXED_LAYOUT_ORIGIN ?? 'http://127.0.0.1:4173';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const allowed = url.hostname === '127.0.0.1' && url.port === (new URL(origin).port || '80');
    return allowed ? route.continue() : route.abort();
  });
  await page.goto(`${origin}/e2e/boxed-campaign-1672.html`);
  await page.waitForSelector('[data-width="342"] article');
});

for (const width of [342, 384]) {
  test(`signed-in card at ${width}px: chips inside, one row, difficulty visible, level printed`, async ({
    page,
  }) => {
    const cards = page.locator(`[data-width="${width}"] article`);
    expect(await cards.count()).toBe(4);
    for (let i = 0; i < 4; i++) {
      const m = await cards.nth(i).evaluate((article) => {
        const inner = article.querySelector('a > div') as HTMLElement;
        const box = inner.getBoundingClientRect();
        const rect = (el: Element) => {
          const b = el.getBoundingClientRect();
          return {
            t: (el.textContent ?? '').trim(),
            l: b.left,
            r: b.right,
            top: Math.round(b.top),
          };
        };
        const genres = [...(inner.querySelector('.left-3')?.children ?? [])].map(rect);
        const diff = rect(inner.querySelector('.right-3') as Element);
        const level =
          [...inner.querySelectorAll('p')]
            .map((p) => p.textContent ?? '')
            .find((t) => t.includes('Level')) ?? '';
        return { box: { l: box.left, r: box.right }, genres, diff, level };
      });
      // Tolerance for the card's tilt (up to 2.5 degrees).
      const tol = 4;
      for (const g of m.genres) {
        expect(g.l, `${m.diff.t}: chip ${g.t} inside left`).toBeGreaterThanOrEqual(m.box.l - tol);
        expect(g.r, `chip ${g.t} inside right`).toBeLessThanOrEqual(m.box.r + tol);
        expect(g.r, `chip ${g.t} clear of difficulty`).toBeLessThanOrEqual(m.diff.l);
        expect(g.t).toMatch(/^(\+\d+|[A-Za-z][A-Za-z ]*)$/);
      }
      expect(m.diff.l, 'difficulty inside left').toBeGreaterThanOrEqual(m.box.l - tol);
      expect(m.diff.r, 'difficulty fully visible').toBeLessThanOrEqual(m.box.r + tol);
      const tops = new Set(m.genres.map((g) => g.top));
      expect(tops.size, 'genre chips on one row').toBeLessThanOrEqual(1);
      expect(m.level).toMatch(/Level \d+(-\d+)?/);
      expect(m.level).not.toContain('7-10-11');
    }
  });
}

test('abyssal card prints "+1" and the squeezed level', async ({ page }) => {
  const card = page.locator('[data-width="384"] article').nth(1);
  await expect(card.getByText('+1', { exact: true })).toBeVisible();
  await expect(card.getByText('Level 7-11')).toBeVisible();
});

for (const width of [342, 848]) {
  test(`hero row at ${width}px shows an edge fade on the cut side`, async ({ page }) => {
    const row = page.locator(`[data-fan="${width}"] [role="group"]`);
    const fadeLeft = page.locator(`[data-fan="${width}"] [data-testid="hero-row-fade-left"]`);
    const fadeRight = page.locator(`[data-fan="${width}"] [data-testid="hero-row-fade-right"]`);
    await expect(fadeRight).toBeVisible();
    await expect(fadeLeft).toHaveCount(0);
    await row.evaluate((el) => el.scrollTo({ left: el.scrollWidth, behavior: 'instant' }));
    await expect(fadeLeft).toBeVisible();
    await expect(fadeRight).toHaveCount(0);
  });
}

test('wider chip type drops chips to fit and counts them (measured, not estimated)', async ({
  page,
}) => {
  await page.addStyleTag({
    content: '[data-width="342"] .left-3 span { font-size: 15px !important; }',
  });
  const card = page.locator('[data-width="342"] article').nth(0);
  await expect(card.getByText('+2', { exact: true })).toBeVisible();
  const m = await card.evaluate((article) => {
    const inner = article.querySelector('a > div') as HTMLElement;
    const row = inner.querySelector('.left-3') as HTMLElement;
    const diff = inner.querySelector('.right-3') as HTMLElement;
    const chips = [...row.children].map((c) => ({
      t: (c.textContent ?? '').trim(),
      r: c.getBoundingClientRect().right,
    }));
    return {
      chips,
      diffLeft: diff.getBoundingClientRect().left,
      rowRight: row.getBoundingClientRect().right,
    };
  });
  const words = m.chips.filter((c) => !/^\+\d+$/.test(c.t));
  expect(words).toHaveLength(1);
  expect(words[0].t).toBe('Psychological Terror');
  for (const c of m.chips) expect(c.r).toBeLessThanOrEqual(m.diffLeft);
});

test('one over-long genre ends with an ellipsis inside the card', async ({ page }) => {
  const card = page.locator('[data-width="342"] article').nth(2);
  const chip = card.locator('.left-3 > span');
  await expect(chip).toHaveCount(1);
  const m = await chip.evaluate((el) => {
    const inner = el.closest('a > div') as HTMLElement;
    const diff = inner.querySelector('.right-3') as HTMLElement;
    return {
      truncated: el.scrollWidth > el.clientWidth,
      overflowStyle: getComputedStyle(el).textOverflow,
      chipRight: el.getBoundingClientRect().right,
      diffLeft: diff.getBoundingClientRect().left,
      innerRight: inner.getBoundingClientRect().right,
    };
  });
  expect(m.truncated).toBe(true);
  expect(m.overflowStyle).toBe('ellipsis');
  expect(m.chipRight).toBeLessThanOrEqual(m.diffLeft);
  expect(m.chipRight).toBeLessThanOrEqual(m.innerRight);
});
