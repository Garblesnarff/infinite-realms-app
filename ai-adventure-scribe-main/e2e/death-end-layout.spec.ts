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

test('end hero bar stays pinned on the real scroll container at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/e2e/death-end-layout.html?tall=1`);
  await expect(page.getByRole('heading', { name: 'The Scholar has fallen' })).toBeVisible();
  const hero = page.getByRole('button', { name: 'Choose a new hero' });
  await expect(hero).toBeVisible();

  type Geometry = {
    scrollTop: number;
    maxScroll: number;
    clientHeight: number;
    heroTop: number;
    heroHeight: number;
    barrierBottom: number;
    barrierPosition: string;
    docScrollWidth: number;
    docClientWidth: number;
  };
  const geometryAt = (scrollTop: number | null): Promise<Geometry> =>
    page.evaluate((target: number | null) => {
      const heroEl = document.querySelector(
        '[data-testid="death-screen-new-character"]',
      ) as HTMLElement;
      const barrier = heroEl.closest('div') as HTMLElement;
      let scroller: HTMLElement | null = heroEl;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
        scroller = scroller.parentElement as HTMLElement | null;
      }
      if (!scroller) throw new Error('no scroll container');
      if (target !== null) scroller.scrollTop = target;
      const rect = heroEl.getBoundingClientRect();
      const barrierRect = barrier.getBoundingClientRect();
      return {
        scrollTop: scroller.scrollTop,
        maxScroll: scroller.scrollHeight - scroller.clientHeight,
        clientHeight: scroller.clientHeight,
        heroTop: rect.top,
        heroHeight: rect.height,
        barrierBottom: barrierRect.bottom,
        barrierPosition: getComputedStyle(barrier).position,
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
      };
    }, scrollTop);
  const noSideways = (g: Geometry): void => {
    expect(g.docScrollWidth).toBeLessThanOrEqual(g.docClientWidth);
  };

  const atTop = await geometryAt(0);
  expect(atTop.maxScroll).toBeGreaterThan(300);
  expect(atTop.barrierPosition).toBe('sticky');
  expect(atTop.heroHeight).toBeGreaterThanOrEqual(44);
  expect(Math.abs(atTop.barrierBottom - atTop.clientHeight)).toBeLessThanOrEqual(2);
  noSideways(atTop);
  const pinnedTop = atTop.heroTop;

  const atMax = await geometryAt(atTop.maxScroll);
  noSideways(atMax);
  const naturalBarrierBottom = atMax.barrierBottom + atMax.maxScroll;
  const releaseScroll = naturalBarrierBottom - atTop.clientHeight;
  expect(releaseScroll).toBeGreaterThan(300);
  expect(atMax.barrierBottom).toBeLessThan(atTop.clientHeight - 2);
  await expect(page.getByRole('button', { name: 'Explore other campaigns' })).toBeVisible();

  for (let y = 75; y <= releaseScroll; y += 75) {
    const g = await geometryAt(y);
    expect(g.scrollTop).toBe(y);
    expect(Math.abs(g.heroTop - pinnedTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.barrierBottom - g.clientHeight)).toBeLessThanOrEqual(2);
    expect(g.heroHeight).toBeGreaterThanOrEqual(44);
    noSideways(g);
  }
  await geometryAt(Math.min(200, releaseScroll));
  await page.screenshot({ path: 'test-results/death-end-390-pinned.png' });

  const backAtTop = await geometryAt(0);
  expect(Math.abs(backAtTop.heroTop - pinnedTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(backAtTop.barrierBottom - backAtTop.clientHeight)).toBeLessThanOrEqual(2);
});

test('end hero bar is static in flow at 1280px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto(`${origin}/e2e/death-end-layout.html?tall=1`);
  await expect(page.getByRole('heading', { name: 'The Scholar has fallen' })).toBeVisible();

  const geometryAt = (
    scrollTop: number | null,
  ): Promise<{
    scrollTop: number;
    maxScroll: number;
    clientHeight: number;
    heroTop: number;
    heroHeight: number;
    barrierBottom: number;
    barrierPosition: string;
    docScrollWidth: number;
    docClientWidth: number;
  }> =>
    page.evaluate((target: number | null) => {
      const heroEl = document.querySelector(
        '[data-testid="death-screen-new-character"]',
      ) as HTMLElement;
      const barrier = heroEl.closest('div') as HTMLElement;
      let scroller: HTMLElement | null = heroEl;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
        scroller = scroller.parentElement as HTMLElement | null;
      }
      if (!scroller) throw new Error('no scroll container');
      if (target !== null) scroller.scrollTop = target;
      const rect = heroEl.getBoundingClientRect();
      const barrierRect = barrier.getBoundingClientRect();
      return {
        scrollTop: scroller.scrollTop,
        maxScroll: scroller.scrollHeight - scroller.clientHeight,
        clientHeight: scroller.clientHeight,
        heroTop: rect.top,
        heroHeight: rect.height,
        barrierBottom: barrierRect.bottom,
        barrierPosition: getComputedStyle(barrier).position,
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
      };
    }, scrollTop);

  const atTop = await geometryAt(0);
  expect(atTop.barrierPosition).toBe('static');
  expect(atTop.heroHeight).toBeGreaterThanOrEqual(44);
  expect(atTop.docScrollWidth).toBeLessThanOrEqual(atTop.docClientWidth);
  expect(atTop.heroTop).toBeGreaterThanOrEqual(atTop.clientHeight - 2);
  const scrolled = await geometryAt(100);
  expect(scrolled.scrollTop).toBe(100);
  expect(Math.abs(scrolled.heroTop - (atTop.heroTop - 100))).toBeLessThanOrEqual(2);
  expect(scrolled.docScrollWidth).toBeLessThanOrEqual(scrolled.docClientWidth);
  await page.screenshot({ path: 'test-results/death-end-1280-scrolled.png' });
});

for (const width of [1280, 390]) {
  test(`dying cards 4-8 fit ${width}px with engine counts`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${origin}/e2e/death-end-layout.html?view=cards`);
    await expect(page.getByRole('heading', { name: 'Dying cards — fixture' })).toBeVisible();
    const success = page.getByTestId('card-success');
    const failure = page.getByTestId('card-failure');
    const nat20 = page.getByTestId('card-nat20');
    const nat1 = page.getByTestId('card-nat1');
    const strike = page.getByTestId('card-strike');
    await expect(success).toContainText('SUCCESS');
    await expect(success).toContainText('d20 14 vs DC 10');
    await expect(success).toContainText('1 of 3 successes');
    await expect(success).toContainText('Saved');
    await expect(failure).toContainText('FAILED');
    await expect(failure).toContainText('d20 6 vs DC 10');
    await expect(failure).toContainText('2 of 3 failures');
    await expect(nat20).toContainText('NATURAL 20');
    await expect(nat20).toContainText('d20 20 · natural 20');
    await expect(nat20).toContainText('You wake with 1 HP');
    await expect(nat20).not.toContainText('Saved');
    await expect(nat1).toContainText('NATURAL 1');
    await expect(nat1).toContainText('d20 1 · natural 1');
    await expect(nat1).toContainText('Two death-save failures');
    await expect(strike).toContainText('CRITICAL HIT');
    await expect(strike).toContainText('automatic critical hit');
    await expect(strike).toContainText('Failed');
    const geometry = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
    for (const badge of await page.getByTestId('engine-card-badge').all()) {
      expect((await badge.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(40);
    }
    await page.screenshot({ path: `test-results/dying-cards-${width}.png`, fullPage: true });
  });

  test(`turn bar says Dying at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${origin}/e2e/death-end-layout.html?view=turnbar`);
    await expect(page.getByTestId('combat-turn-text')).toHaveText('Dying');
    await expect(page.getByTestId('combat-turn-sub')).toHaveText(
      '0 HP · roll a death saving throw',
    );
    await expect(page.getByTestId('combat-turn-dying')).toHaveText(/Dying/);
    await expect(page.getByTestId('combat-turn-pip').first()).toContainText('The Scholar');
    const geometry = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
    await page.screenshot({ path: `test-results/dying-turnbar-${width}.png` });
  });
}

test('death saves respect show target numbers and plain look stays plain', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/e2e/death-end-layout.html?view=cards&targets=hidden`);
  await expect(page.getByTestId('card-success')).toContainText('d20 14');
  await expect(page.getByTestId('card-success')).not.toContainText('DC 10');
  await page.goto(`${origin}/e2e/death-end-layout.html?view=cards`);
  await expect(page.getByTestId('card-success')).toContainText('DC 10');
  const badge = page.getByTestId('card-success').getByTestId('engine-card-badge');
  const pips = page.getByTestId('card-success').getByTestId('death-save-pip');
  await page.evaluate(() => document.body.classList.remove('ir-table-look'));
  await expect(badge).toBeVisible();
  await expect(badge).toContainText('SUCCESS');
  const plainHeight = (await badge.boundingBox())?.height ?? 0;
  expect(plainHeight).toBeLessThan(40);
  // FIX2: plain pips match the pre-patch renderer — 10px, no Saved/Failed labels.
  const plainPips = await pips.all();
  expect(plainPips).toHaveLength(6);
  for (const pip of plainPips) {
    const box = await pip.boundingBox();
    expect(box?.width ?? 0).toBeCloseTo(10, 0);
    expect(box?.height ?? 0).toBeCloseTo(10, 0);
  }
  await expect(page.getByTestId('card-success')).not.toContainText('Saved');
  await expect(page.getByTestId('card-success')).not.toContainText('Failed');
  await page.evaluate(() => document.body.classList.add('ir-table-look'));
  await expect(badge).toBeVisible();
  const tableHeight = (await badge.boundingBox())?.height ?? 0;
  expect(tableHeight).toBeGreaterThanOrEqual(40);
  // FIX2: Table pips are 20px with Saved/Failed labels and engine counts.
  const tablePips = await pips.all();
  expect(tablePips).toHaveLength(6);
  for (const pip of tablePips) {
    const box = await pip.boundingBox();
    expect(box?.width ?? 0).toBeCloseTo(20, 0);
    expect(box?.height ?? 0).toBeCloseTo(20, 0);
  }
  await expect(page.getByTestId('card-success')).toContainText('Saved');
  await expect(page.getByTestId('card-success')).toContainText('Failed');
  await expect(page.getByTestId('card-success')).toContainText('1 of 3 successes');
});

test('pip fill is none with reduced motion and table look separates', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/e2e/death-end-layout.html?view=cards`);
  await expect(page.getByTestId('card-success')).toContainText('SUCCESS');
  const toMs = (value: string): number =>
    value
      .split(',')
      .map((part) => {
        const trimmed = part.trim();
        if (trimmed.endsWith('ms')) return Number.parseFloat(trimmed);
        if (trimmed.endsWith('s')) return Number.parseFloat(trimmed) * 1000;
        return 0;
      })
      .reduce((max, value) => Math.max(max, value), 0);
  // FIX3: regular Table look animates the fill over 150ms.
  const normal = await page.getByTestId('card-success').evaluate((el) => {
    const pip = el.querySelector('[data-testid="death-save-pip"]') as HTMLElement;
    const style = getComputedStyle(pip);
    return {
      duration: style.transitionDuration,
      property: style.transitionProperty,
      count: el.querySelectorAll('[data-testid="death-save-pip"]').length,
    };
  });
  expect(normal.count).toBe(6);
  expect(toMs(normal.duration)).toBe(150);
  // FIX3: OS-level reduce disables the transition entirely (transition: none).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const osReduced = await page.getByTestId('card-success').evaluate((el) => {
    const pip = el.querySelector('[data-testid="death-save-pip"]') as HTMLElement;
    const style = getComputedStyle(pip);
    return { duration: style.transitionDuration, property: style.transitionProperty };
  });
  expect(toMs(osReduced.duration)).toBe(0);
  expect(osReduced.property).toBe('none');
  // FIX3: manual on disables it too, even without OS reduce.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-reduce-motion', 'on');
  });
  const manualReduced = await page.getByTestId('card-success').evaluate((el) => {
    const pip = el.querySelector('[data-testid="death-save-pip"]') as HTMLElement;
    const style = getComputedStyle(pip);
    return { duration: style.transitionDuration, property: style.transitionProperty };
  });
  expect(toMs(manualReduced.duration)).toBe(0);
  expect(manualReduced.property).toBe('none');
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-reduce-motion', 'off');
  });
  const restored = await page.getByTestId('card-success').evaluate((el) => {
    const pip = el.querySelector('[data-testid="death-save-pip"]') as HTMLElement;
    const style = getComputedStyle(pip);
    return { duration: style.transitionDuration };
  });
  expect(toMs(restored.duration)).toBe(150);
});

test('natural 20 without reported HP does not invent a wake HP number', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/e2e/death-end-layout.html?view=cards`);
  const noHp = page.getByTestId('card-nat20-nohp');
  await expect(noHp).toContainText('NATURAL 20');
  await expect(noHp).toContainText('d20 20 · natural 20');
  // FIX1: no finite newCurrentHp from the producer, so the card omits the HP
  // effect line instead of falling back to a fabricated "1 HP".
  await expect(noHp.getByText(/You wake with/)).toHaveCount(0);
  await expect(noHp).not.toContainText('You wake with');
  // The reported-HP card from the same producer still shows its real HP.
  await expect(page.getByTestId('card-nat20')).toContainText('You wake with 1 HP');
});

test('dying turn bar shows initials in plain look and Dying chip only in table look', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/e2e/death-end-layout.html?view=turnbar`);
  // FIX4: Table header is Dying; tracker wording stays engine-driven (isDying).
  await expect(page.getByTestId('combat-turn-text')).toHaveText('Dying');
  await expect(page.getByTestId('combat-turn-dying')).toBeVisible();
  await expect(page.getByTestId('combat-turn-pip').first()).toContainText('The Scholar');
  await page.evaluate(() => document.body.classList.remove('ir-table-look'));
  await expect(page.getByTestId('combat-turn-dying')).toHaveCount(0);
  await expect(page.getByTestId('combat-turn-pip').first()).toHaveText('S');
  // FIX4: plain header is unchanged.
  await expect(page.getByTestId('combat-turn-text')).toHaveText('You are down');
});
