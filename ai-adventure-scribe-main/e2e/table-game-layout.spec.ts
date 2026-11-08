import { expect, test } from '@playwright/test';

import config from '../playwright.config';

import type { Page } from '@playwright/test';

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

for (const width of [1280, 390]) {
  test(`the Table game screen fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await stubSession(page);
    await page.goto(new URL('/e2e/table-game-layout.html', layoutUrl).toString());
    await expect(page.getByTestId('story-box')).toBeVisible();
    await expect(page.getByText('The ledge comes into view.')).toBeVisible();
    const story = await page.getByTestId('story-box').boundingBox();
    expect(story?.height).toBeGreaterThanOrEqual(100);
    const geometry = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      width: document.documentElement.scrollWidth,
      canvases: document.querySelectorAll('canvas').length,
    }));
    expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.canvases).toBeLessThanOrEqual(1);
    const ratios = await page.evaluate(() => {
      const values = getComputedStyle(document.body);
      const luminance = (hex: string): number => {
        const channels = hex
          .trim()
          .slice(1)
          .match(/../g)!
          .map((part) => parseInt(part, 16) / 255)
          .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const contrast = (light: string, dark: string): number =>
        (luminance(values.getPropertyValue(light)) + 0.05) /
        (luminance(values.getPropertyValue(dark)) + 0.05);
      return {
        parchment: contrast('--ir-parchment-2', '--ir-ink'),
        brass: contrast('--ir-brass-2', '--ir-brass-ink'),
      };
    });
    expect(ratios.parchment).toBeGreaterThanOrEqual(7);
    expect(ratios.brass).toBeGreaterThanOrEqual(7);
    const sceneInfo = await page.getByLabel('Table controls').boundingBox();
    expect(sceneInfo!.width).toBeGreaterThanOrEqual(44);
    expect(sceneInfo!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: test.info().outputPath('screen.png'), animations: 'disabled' });
  });
}

for (const width of [1280, 390]) {
  test(`the Table check card fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await stubSession(page);
    await page.goto(new URL('/e2e/table-game-layout.html?roll=true', layoutUrl).toString());
    const card = page.getByTestId('dice-roll-request');
    await expect(card).toBeVisible();
    await expect(card.getByRole('switch', { name: /show target numbers/i })).toBeVisible();
    for (const target of [
      card.getByRole('switch', { name: /show target numbers/i }),
      card.getByRole('button', { name: /roll .* for/i }),
      card.getByRole('button', { name: /enable advantage/i }),
      card.getByRole('button', { name: /enter my own roll/i }),
    ]) {
      const box = await target.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const bodyInk = await card
      .getByText('Strength (Athletics)')
      .evaluate((element) => getComputedStyle(element).color);
    expect(bodyInk).toBe('rgb(42, 26, 12)');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect(await page.locator('canvas').count()).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath('screen.png'), animations: 'disabled' });
  });
}

test('the check card hides the target until the player turns it on', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.addInitScript(() => localStorage.setItem('ui:showTargetNumbers:v1', 'off'));
  await stubSession(page);
  await page.goto(new URL('/e2e/table-game-layout.html?roll=true', layoutUrl).toString());
  const card = page.getByTestId('dice-roll-request');
  await expect(card.getByText('DC hidden · the DM knows the number')).toBeVisible();
  await expect(card.getByText('DC 12')).toHaveCount(0);
  await card.getByRole('switch', { name: /show target numbers/i }).click();
  await expect(card.getByText('DC 12')).toBeVisible();
});

for (const mode of ['explore', 'combat'] as const) {
  for (const width of [1280, 390]) {
    test(`Table shell ${mode} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await stubSession(page);
      await page.goto(
        new URL(
          `/e2e/table-game-layout.html${mode === 'combat' ? '?combat=true' : ''}`,
          layoutUrl,
        ).toString(),
      );
      const header = page.getByTestId('table-screen-header');
      const character = page.getByRole('region', { name: 'Character summary' });
      const story = page.getByTestId('story-box');
      await expect(header).toBeVisible();
      await expect(character).toBeVisible();
      await expect(story).toBeVisible();
      await expect(page.getByTestId('engine-line').first()).toBeAttached();
      const colors = await page.evaluate(() => {
        const luminance = (color: string): number => {
          const values = (color.match(/\d+(?:\.\d+)?/g) ?? [])
            .slice(0, 3)
            .map((channel) => Number(channel) / 255)
            .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
          return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
        };
        const ratio = (foreground: string, background: string): number => {
          const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
          return (a + 0.05) / (b + 0.05);
        };
        const composer = document.querySelector('.chat-composer')!;
        const input = composer.querySelector('textarea')!;
        const ledger = document.querySelector('[data-testid="engine-line"] > button')!;
        const label = ledger.querySelector('span:nth-child(2)')!;
        const seal = ledger.querySelector('[data-testid="engine-line-pill"]')!;
        const detail = ledger.querySelector('span.text-muted-foreground')!;
        const voice = document.querySelector('.ir-tts')!;
        return {
          composer: ratio(
            getComputedStyle(input).color,
            getComputedStyle(composer).backgroundColor,
          ),
          ledger: ratio(getComputedStyle(label).color, getComputedStyle(ledger).backgroundColor),
          seal: ratio(getComputedStyle(seal).color, getComputedStyle(seal).backgroundColor),
          detail: ratio(getComputedStyle(detail).color, getComputedStyle(ledger).backgroundColor),
          voice: ratio(getComputedStyle(voice).color, getComputedStyle(voice).backgroundColor),
        };
      });
      expect(colors.composer).toBeGreaterThanOrEqual(7);
      expect(colors.ledger).toBeGreaterThanOrEqual(7);
      expect(colors.seal).toBeGreaterThanOrEqual(7);
      expect(colors.detail).toBeGreaterThanOrEqual(7);
      expect(colors.voice).toBeGreaterThanOrEqual(7);
      await expect(page.getByText('The Scholar').first()).toBeVisible();
      await expect(header.locator('section').first().getByRole('heading')).toHaveText(
        /Abyssal Descent/i,
      );
      await expect(page.getByRole('button', { name: 'Hide Campaign' })).not.toBeVisible();
      if (mode === 'combat') {
        await expect(header.getByText('Captain Reeves · wounded')).toBeVisible();
        await expect(header.getByTestId('combat-turn-pip').first()).toBeVisible();
      } else {
        await expect(header.getByText('Exploring')).toBeVisible();
        await expect(page.getByTestId('table-turn-slot')).toBeEmpty();
      }
      const boxes = await Promise.all([character.boundingBox(), story.boundingBox()]);
      expect(boxes[0]).not.toBeNull();
      expect(boxes[1]).not.toBeNull();
      if (width === 1280) {
        const right = await page.getByTestId('table-roll-column').boundingBox();
        expect(right).not.toBeNull();
        expect(boxes[0]!.x + boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x);
        expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(right!.x);
      } else {
        await expect(page.getByTestId('table-phone-tiles')).toBeVisible();
        expect(boxes[0]!.y + boxes[0]!.height).toBeLessThanOrEqual(boxes[1]!.y);
        await expect(character.getByRole('button', { name: /The Scholar/ })).toHaveAttribute(
          'aria-expanded',
          'false',
        );
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      expect(await page.locator('canvas').count()).toBeLessThanOrEqual(1);
      await page.screenshot({ path: test.info().outputPath('shell.png'), animations: 'disabled' });
      await page.getByLabel('Table controls').click();
      await page.getByRole('button', { name: 'Hide Campaign' }).click();
      await expect(character).not.toBeVisible();
      await page.getByRole('button', { name: 'Show Campaign' }).click();
      await expect(character).toBeVisible();
      await page.getByLabel('Table controls').click();
      await page.getByRole('button', { name: 'Memory', exact: true }).click();
      await expect(page.getByRole('tab', { name: /Memory/i }).first()).toHaveAttribute(
        'data-state',
        'active',
      );
      await page.getByRole('tab', { name: 'Sheet' }).first().click();
      await expect(page.getByRole('tab', { name: 'Sheet' }).first()).toHaveAttribute(
        'data-state',
        'active',
      );
      await page.getByRole('button', { name: 'Memory', exact: true }).click();
      await expect(page.getByRole('tab', { name: /Memory/i }).first()).toHaveAttribute(
        'data-state',
        'active',
      );
    });
  }
}

test('changing looks keeps the pending roll mounted', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await stubSession(page);
  await page.goto(new URL('/e2e/table-game-layout.html?roll=true', layoutUrl).toString());
  const card = page.getByTestId('dice-roll-request');
  await expect(card).toBeVisible();
  await card.evaluate((element) => {
    (window as unknown as { originalRoll: Element }).originalRoll = element;
  });
  await page.evaluate(() => document.body.classList.remove('ir-table-look'));
  await expect(card).toBeVisible();
  expect(
    await card.evaluate(
      (element) => element === (window as unknown as { originalRoll: Element }).originalRoll,
    ),
  ).toBe(true);
  await page.evaluate(() => document.body.classList.add('ir-table-look'));
  await expect(card).toBeVisible();
  expect(
    await card.evaluate(
      (element) => element === (window as unknown as { originalRoll: Element }).originalRoll,
    ),
  ).toBe(true);
});

test('a large encounter leaves the phone story and composer reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await stubSession(page);
  await page.goto(
    new URL('/e2e/table-game-layout.html?combat=true&many=true', layoutUrl).toString(),
  );
  const header = page.getByTestId('table-screen-header');
  await expect(header.getByText('Long-named opponent 12 · wounded')).toBeAttached();
  expect((await header.boundingBox())!.height).toBeLessThan(320);
  const story = page.getByTestId('story-box');
  const composer = page.locator('.chat-composer textarea');
  await expect(story).toBeVisible();
  await expect(composer).toBeVisible();
  expect((await story.boundingBox())!.height).toBeGreaterThan(40);
  const inputBox = (await composer.boundingBox())!;
  expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(900);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
