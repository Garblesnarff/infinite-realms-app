import { expect, test, type Page } from '@playwright/test';

/**
 * #1797 follow-up: Move mode ends when the turn ends. Hark: map clicks ignored until Move is
 * pressed again. A stale selection and reachable list from an earlier turn made the map ignore
 * new clicks while Move still looked armed.
 */

const BASE = 'http://127.0.0.1:4173/e2e/tactical-round-1797.html';
const SESSION_ID = 'session-1797';
const WIDTH = 8;
const HEIGHT = 6;
const COMBAT_SHIM = `
export function useCombat() {
  return { state: { activeEncounter: window.harness?.encounter ?? null } };
}
`;

type Point = { x: number; y: number };

function mapAt(round: number, hero: Point, foe: Point) {
  const cell = { terrain: 'floor', blocksMovement: false, blocksSight: false, cover: 0, elevation: 0 };
  const entity = (id: string, at: Point, type: 'pc' | 'monster', name: string) => ({
    id, x: at.x, y: at.y, size: 'medium', type, speedFeet: 30, movementRemaining: 30, name,
  });
  return {
    id: 'map-1797',
    sessionId: SESSION_ID,
    width: WIDTH,
    height: HEIGHT,
    cells: Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => ({ ...cell }))),
    entities: [entity('hero', hero, 'pc', 'Hero'), entity('foe', foe, 'monster', 'Foe')],
    round,
    sceneDescription: 'A bout in the yard.',
  };
}

async function openHarness(page: Page, requests: string[]): Promise<void> {
  await page.route('**/src/contexts/CombatContext.tsx*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: COMBAT_SHIM }),
  );
  await page.route('**/v1/**', (route) => {
    const url = new URL(route.request().url());
    requests.push(`${route.request().method()} ${url.pathname}`);
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/tactical-map'))
      return json({ map: mapAt(1, { x: 1, y: 2 }, { x: 6, y: 2 }) });
    if (url.pathname.includes('/valid-moves/')) return json({ moves: [{ x: 2, y: 2 }, { x: 3, y: 2 }] });
    return json({ ok: true });
  });
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto(BASE);
  await expect(page.locator('canvas')).toBeVisible();
}

async function cellPoint(page: Page, cell: Point): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').boundingBox();
  const size = Math.min(box!.width / WIDTH, box!.height / HEIGHT);
  return { x: box!.x + (cell.x + 0.5) * size, y: box!.y + (cell.y + 0.5) * size };
}

async function clickCell(page: Page, cell: Point): Promise<void> {
  const point = await cellPoint(page, cell);
  await page.mouse.click(point.x, point.y);
}

async function setTurn(page: Page, turnId: string): Promise<void> {
  await page.evaluate((id) => {
    const harness = (window as unknown as { harness: { encounter: unknown; render: () => void } }).harness;
    harness.encounter = { id: 'enc-1797', currentTurnParticipantId: id };
    harness.render();
  }, turnId);
}

test.describe('Move mode follows the turn (#1797)', () => {
  test('a click after the turn changes is not lost to a stale Move selection', async ({ page }) => {
    const requests: string[] = [];
    await openHarness(page, requests);
    const count = (needle: string): number => requests.filter((entry) => entry.includes(needle)).length;

    // Round 1: press Move, then click a square that is not a legal move. Nothing is sent.
    await setTurn(page, 'hero');
    const move = page.getByRole('button', { name: 'Move' });
    await move.click();
    await expect.poll(() => count('/valid-moves/hero')).toBe(1);
    await expect(move).toHaveAttribute('aria-pressed', 'true');
    await clickCell(page, { x: 5, y: 5 });

    // The turn ends with Move still pressed. The foe acts; round 2 is the hero's turn.
    await setTurn(page, 'foe');
    await expect(move).toHaveAttribute('aria-pressed', 'false');
    await setTurn(page, 'hero');
    await expect(move).toHaveAttribute('aria-pressed', 'false');

    // Round 2: Move ended with the turn, so a square from the old list must not move the hero.
    // Before the fix the old reachable list was still held, and this click sent a move.
    await clickCell(page, { x: 2, y: 2 });
    await page.waitForTimeout(300);
    expect(count('/combat/enc-1797/intent')).toBe(0);
    await clickCell(page, { x: 4, y: 4 });
    await expect(page.getByRole('status')).toHaveText('Press Move, then choose a square.');
    expect(count('/combat/enc-1797/intent')).toBe(0);
    await move.click();
    await expect.poll(() => count('/valid-moves/hero')).toBe(2);
    await clickCell(page, { x: 3, y: 2 });
    await expect.poll(() => count('/combat/enc-1797/intent')).toBe(1);
  });
});
