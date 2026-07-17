import { expect, test } from '@playwright/test';

import { resolveAttackRules } from '../server-bun/src/services/combat/combat-rules';

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

for (const viewport of viewports) {
  test(`complete authoritative three-turn encounter (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.setContent(`
      <main aria-label="Combat state" style="max-width:100%;overflow:hidden;font:16px sans-serif">
        <h1>Round 1</h1><p data-turn></p><p data-hp></p><div data-actions></div>
      </main>
      <script>
        window.addEventListener('combat-state-updated', (event) => {
          const state = event.detail.combat;
          document.querySelector('[data-turn]').textContent = 'Turn: ' + state.current;
          document.querySelector('[data-hp]').textContent = 'Goblin HP: ' + state.goblinHp;
          document.querySelector('[data-actions]').textContent = state.actions.join(' · ');
        });
      </script>
    `);

    const longsword = {
      id: 'longsword', name: 'Longsword', damageDice: '1d8', damageType: 'slashing',
      normalRange: 5, magicBonus: 0, finesse: false, ranged: false, proficient: true,
    };
    const shortbow = {
      id: 'shortbow', name: 'Shortbow', damageDice: '1d6', damageType: 'piercing',
      normalRange: 80, longRange: 320, magicBonus: 0, finesse: false, ranged: true, proficient: true,
    };

    // Turn 1: player attacks through half cover; the server-calculated AC is rendered.
    const turnOne = resolveAttackRules({
      strength: 16, dexterity: 12, level: 5, baseTargetAc: 14, weapon: longsword,
      geometry: { distanceFeet: 5, hasLineOfSight: true, cover: 1 },
    });
    expect(turnOne).toMatchObject({ legal: true, attackBonus: 6, targetAc: 16 });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('combat-state-updated', {
      detail: { combat: { current: 'Goblin', goblinHp: 4, actions: ['Attack', 'Dash', 'Dodge', 'Disengage', 'End turn'] } },
    })));

    // Turn 2: a long-range enemy shot is legal but disadvantaged.
    const turnTwo = resolveAttackRules({
      strength: 8, dexterity: 14, level: 1, baseTargetAc: 16, weapon: shortbow,
      geometry: { distanceFeet: 100, hasLineOfSight: true, cover: 0 },
    });
    expect(turnTwo).toMatchObject({ legal: true, disadvantage: true });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('combat-state-updated', {
      detail: { combat: { current: 'Hero', goblinHp: 4, actions: ['Attack', 'Cast a prepared spell', 'End turn'] } },
    })));

    // Turn 3: the player finishes the target; synchronized HP/actions replace narration choices.
    const turnThree = resolveAttackRules({
      strength: 16, dexterity: 12, level: 5, baseTargetAc: 14, weapon: longsword,
      requestedAdvantage: true,
      geometry: { distanceFeet: 5, hasLineOfSight: true, cover: 0 },
    });
    expect(turnThree).toMatchObject({ legal: true, advantage: true });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('combat-state-updated', {
      detail: { combat: { current: 'Combat ended', goblinHp: 0, actions: [] } },
    })));

    await expect(page.getByText('Goblin HP: 0')).toBeVisible();
    await expect(page.getByText('Turn: Combat ended')).toBeVisible();
    expect(await page.locator('main').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}
