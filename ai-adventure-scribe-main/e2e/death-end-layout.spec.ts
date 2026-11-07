import { expect, test } from '@playwright/test';

/**
 * Table 11 phone measurement. The end screen and the dying panel must not
 * scroll sideways at 390, and the primary control stays a 44px target at
 * 1280 and 390.
 */
const origin = process.env.DEATH_LAYOUT_ORIGIN ?? 'http://127.0.0.1:4173';

for (const width of [1280, 390]) {
  for (const view of ['end', 'dying'] as const) {
    test(`${view} fits ${width}px without sideways scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(
        `${origin}/e2e/death-end-layout.html${view === 'dying' ? '?view=dying' : ''}`,
      );
      const fits = async (): Promise<void> => {
        const geometry = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          width: document.documentElement.scrollWidth,
        }));
        expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
      };
      if (view === 'end') {
        await expect(page.getByRole('heading', { name: 'The Scholar has fallen' })).toBeVisible();
        const story = page.getByRole('button', { name: 'Read the story so far' });
        const hero = page.getByRole('button', { name: 'Choose a new hero' });
        const explore = page.getByRole('button', { name: 'Explore other campaigns' });
        const realm = page.getByRole('link', { name: 'Back to your realm' });
        await expect(story).toBeVisible();
        const order = await page.evaluate(() => {
          const ids = [
            'death-screen-read-story',
            'death-screen-new-character',
            'death-screen-explore',
            'death-screen-realm',
          ];
          return ids.every((id, index) => {
            if (index === 0) return true;
            const previous = document.querySelector(`[data-testid="${ids[index - 1]}"]`);
            const current = document.querySelector(`[data-testid="${id}"]`);
            return Boolean(
              previous &&
              current &&
              previous.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING,
            );
          });
        });
        expect(order).toBe(true);
        for (const target of [story, hero, explore, realm]) {
          const box = await target.boundingBox();
          expect(box).not.toBeNull();
          expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        }
        await fits();
        await story.click();
        await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
        if (width === 390) {
          await page.goto(`${origin}/e2e/death-end-layout.html?longName=1`);
          await expect(
            page.getByRole('heading', { name: 'Bartholomew the Unbroken has fallen' }),
          ).toBeVisible();
          await page.getByRole('button', { name: 'Read the story so far' }).click();
          await expect(
            page.getByRole('heading', { name: 'Bartholomew the Unbroken — fallen' }),
          ).toBeVisible();
        }
      } else {
        await expect(page.getByRole('heading', { name: 'The Scholar is dying' })).toBeVisible();
        const roll = page.getByRole('button', { name: 'Roll death save' });
        const box = await roll.boundingBox();
        expect(box).not.toBeNull();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.width ?? width + 1).toBeLessThanOrEqual(width);
      }
      await fits();
    });
  }
}
