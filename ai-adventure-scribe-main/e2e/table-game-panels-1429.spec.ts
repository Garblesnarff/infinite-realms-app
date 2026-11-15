import { expect, test } from '@playwright/test';

// The game runs under the OS dark preference (index.css: `@media
// (prefers-color-scheme: dark)`); force it so the harness matches the game.
test.use({ colorScheme: 'dark' });

const BASE = 'http://127.0.0.1:4173/e2e/table-game-panels-1429.html';

test.describe('game panels (#1429)', () => {
  test('desktop Memory tab: search, counted chips, grouped cards with glyphs', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE}?tab=memory`);

    await expect(page.getByRole('heading', { name: 'What the DM remembers' })).toBeVisible();
    await expect(
      page.getByText('The DM remembers 5 things about this story.'),
    ).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search memories' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'All 5' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Characters 2' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Characters · 2' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Locations · 1' })).toBeVisible();
    await expect(page.getByText('Character', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('The innkeeper owes the party a favour.')).toBeVisible();
    // The inactive Journal panel must not take flex space (a `flex` class on a
    // Radix TabsContent overrides its `hidden` attribute): only the active
    // panel is laid out, and the memory list fills the panel height.
    const panels = page.locator('[role="tabpanel"]');
    await expect(panels.nth(2)).toBeHidden();
    expect(await panels.nth(2).boundingBox()).toBeNull();
    const searchBox = await page.getByRole('searchbox', { name: 'Search memories' }).boundingBox();
    const panelBox = await page.getByTestId('desktop-panel').boundingBox();
    expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(
      panelBox!.x + panelBox!.width,
    );
    const viewportBox = await page
      .locator('[data-radix-scroll-area-viewport]')
      .first()
      .boundingBox();
    expect(viewportBox!.height).toBeGreaterThan(700);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      1280,
    );
  });

  test('desktop Memory tab: searching filters the cards and the flat list has no heads', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE}?tab=memory`);

    await page.getByRole('searchbox', { name: 'Search memories' }).fill('mara');
    await expect(page.getByText('Mara the guard watches the north gate at night.')).toBeVisible();
    await expect(page.getByText('The innkeeper owes the party a favour.')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Characters · 2' })).toBeHidden();

    await page.getByRole('searchbox', { name: 'Search memories' }).fill('dragon');
    await expect(page.getByText('No memories match. Try another word.')).toBeVisible();
  });

  test('desktop Journal tab: handouts, objective, notes and the Story so far link', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE}?tab=journal`);

    await expect(page.getByRole('heading', { name: 'Journal' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Handouts' })).toBeVisible();
    await expect(page.getByText('Torn page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Objective' })).toBeVisible();
    await expect(page.getByText('Find the lost ledger and return it to the Abbey.')).toBeVisible();
    await expect(page.getByPlaceholder('Type your session notes here...')).toBeVisible();
    await expect(page.getByText('Only you can see your notes.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Notes' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Read the chronicle/ })).toBeVisible();
  });

  test('mobile 390: bottom sheet has no page-level sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}?mobile=true&tab=journal`);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(page.getByRole('heading', { name: 'Journal' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Read the chronicle/ })).toBeVisible();
  });

  test('mobile 390: Memory tab renders search and cards in the sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}?mobile=true&tab=memory`);

    await expect(page.getByRole('searchbox', { name: 'Search memories' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'All 5' })).toBeVisible();
    await expect(page.getByText('The innkeeper owes the party a favour.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });

  test('settings sheet: all five settings plus target-numbers default stated, no Table look switch', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE}?settings=true`);

    await expect(page.getByRole('switch', { name: 'Show target numbers' })).toBeVisible();
    await expect(
      page.getByText('Shows the DC and AC on checks and attacks. Default for this campaign: off (Hard).'),
    ).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Dice sound' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Reduce motion' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Show NPC rolls' })).toBeVisible();
    // #1486 removed the Table look switch: Table look is the only look now, always on
    // (useTableLook adds the body class on every game route; nothing reads the old
    // setting). The sheet must not offer it.
    await expect(page.getByRole('switch', { name: 'Table look' })).toHaveCount(0);
    await expect(page.getByText('Table look')).toHaveCount(0);
    await expect(
      page.getByRole('switch', { name: 'Read new DM messages aloud' }),
    ).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Volume' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Speed' })).toBeVisible();
    await expect(page.getByRole('radio', { name: '1×' })).toBeVisible();
    await expect(page.getByText('Level Advancement')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      1280,
    );
  });

  test('settings sheet at 390: no page-level sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}?settings=true&mobile=true`);

    await expect(page.getByRole('switch', { name: 'Show target numbers' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Speed' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});
