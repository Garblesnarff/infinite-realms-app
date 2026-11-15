import { expect, test } from '@playwright/test';

for (const width of [1280, 390]) {
  test(`result cards fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${process.env.TABLE_LAYOUT_BASE_URL}/e2e/table-results-1428.html`);
    await expect(page.getByTestId('engine-result-card')).toHaveCount(9);
    await expect(page.getByText('Spell attack: d20', { exact: false }).first()).toBeVisible();
    const cards = page.getByTestId('engine-result-card');
    const expected = [
      /Spell attack: d20 2 \+ 6 = 8 vs AC 11[\s\S]*No damage/,
      /d20 14 \+ 0 = 14 vs your AC 11[\s\S]*3 slashing damage[\s\S]*HP 7 → 4 of 7/,
      /DEX save 6 vs DC 14[\s\S]*2 acid damage/,
      /DEX save 17 vs DC 14[\s\S]*No damage/,
      /CRITICAL HIT[\s\S]*6 slashing damage[\s\S]*HP 7 → 1 of 7/,
      /AUTO-HIT[\s\S]*7 force damage/,
      /moves 30 ft.*No attack/,
      /REFUSED[\s\S]*No roll, no damage/,
      /FAILED[\s\S]*2 of 3 failures/,
    ];
    for (let i = 0; i < expected.length; i++) {
      await expect(cards.nth(i)).toContainText(expected[i]);
      await expect(cards.nth(i).getByTestId('engine-card-sentence')).not.toBeEmpty();
    }

    expect(await cards.nth(0).evaluate((el) => getComputedStyle(el).borderLeftColor)).toBe(
      'rgb(79, 182, 196)',
    );
    expect(await cards.nth(1).evaluate((el) => getComputedStyle(el).borderLeftColor)).toBe(
      'rgb(239, 138, 138)',
    );
    expect(await cards.nth(6).evaluate((el) => getComputedStyle(el).borderLeftWidth)).toBe('1px');
    const badges = page.getByTestId('engine-card-badge');
    await expect(badges).toHaveCount(8);
    expect(
      await badges.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-tone'))),
    ).toEqual(['grey', 'red', 'gold', 'grey', 'red', 'gold', 'grey', 'red']);
    expect(await badges.nth(1).evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(
      'linear-gradient',
    );
    expect(await badges.nth(2).evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(
      'linear-gradient',
    );
    expect(await badges.nth(0).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(18, 27, 48)',
    );
    for (const badge of await badges.all()) {
      expect((await badge.boundingBox())?.height).toBeGreaterThanOrEqual(40);
      await expect(badge.locator('svg')).toHaveCount(1);
      const minimumContrast = await badge.evaluate((element) => {
        const style = getComputedStyle(element);
        const parse = (value: string): number[] =>
          (value.match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map(Number);
        const luminance = (channels: number[]): number => {
          const values = channels.map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
          return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
        };
        const foreground = luminance(parse(style.color));
        const backgrounds =
          style.backgroundImage === 'none'
            ? [style.backgroundColor]
            : (style.backgroundImage.match(/rgb\([^)]*\)/g) ?? []);
        if (backgrounds.length === 0) return 0;
        return Math.min(
          ...backgrounds.map((background) => {
            const bg = luminance(parse(background));
            return (Math.max(foreground, bg) + 0.05) / (Math.min(foreground, bg) + 0.05);
          }),
        );
      });
      expect(minimumContrast).toBeGreaterThanOrEqual(4.5);
    }

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => document.body.classList.remove('ir-table-look'));
    expect((await badges.first().boundingBox())?.height).toBeLessThan(40);
    await page.evaluate(() => document.body.classList.add('ir-table-look'));
    await page.screenshot({
      path: test.info().outputPath('results.png'),
      fullPage: true,
      animations: 'disabled',
    });
  });
}

test('hides target numbers in visual cards and accessible sentences', async ({ page }) => {
  await page.goto(
    `${process.env.TABLE_LAYOUT_BASE_URL}/e2e/table-results-1428.html?targets=hidden`,
  );
  const cards = page.getByTestId('engine-result-card');
  await expect(cards).toHaveCount(9);
  await expect(cards.nth(0)).not.toContainText('AC 11');
  await expect(cards.nth(2)).not.toContainText('DC 14');
  await expect(cards.nth(0).getByTestId('engine-card-sentence')).not.toContainText('AC 11');
  await expect(cards.nth(2).getByTestId('engine-card-sentence')).not.toContainText('DC 14');
});

for (const width of [1280, 390]) {
  test(`target save fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${process.env.TABLE_LAYOUT_BASE_URL}/e2e/table-results-1428.html?save=true`);
    const card = page.getByTestId('spell-target-save-card');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading')).toHaveText('Captain Sarah Reeves must save');
    await expect(card.getByRole('button', { name: 'Continue' })).toBeFocused();
    for (const button of await card.getByRole('button').all()) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
    expect(await card.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(12, 18, 32)',
    );
    await card.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-answer', 'continue');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
}
