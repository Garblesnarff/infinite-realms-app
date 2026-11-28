import { expect, test, type Page } from '@playwright/test';

/**
 * #1797 (Hark T26-006): the tactical map keeps its picture and takes a move in every round.
 * Mounts the real TacticalMapProvider and TacticalMapBoard in a rail-width column. The combat
 * context is a shim that reads a recorded encounter, and the server's broadcasts are replayed as
 * the same window events the socket sends. The rail is hidden while the foe acts and the new
 * round's map arrives, the way a collapsed panel does, and shown again without any re-render.
 */

const BASE = 'http://127.0.0.1:4173/e2e/tactical-round-1797.html';
const SESSION_ID = 'session-1797';
const WIDTH = 8;
const HEIGHT = 6;

// Plain JS: the browser loads it as a module with no import map.
const COMBAT_SHIM = `
export function useCombat() {
  return { state: { activeEncounter: window.harness?.encounter ?? null } };
}
`;

type Point = { x: number; y: number };

function mapAt(round: number, hero: Point, foe: Point) {
  const cell = {
    terrain: 'floor',
    blocksMovement: false,
    blocksSight: false,
    cover: 0,
    elevation: 0,
  };
  const entity = (id: string, at: Point, type: 'pc' | 'monster', name: string) => ({
    id,
    x: at.x,
    y: at.y,
    size: 'medium',
    type,
    speedFeet: 30,
    movementRemaining: 30,
    name,
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
    if (url.pathname.includes('/valid-moves/'))
      return json({
        moves: [
          { x: 2, y: 2 },
          { x: 3, y: 2 },
        ],
      });
    return json({ ok: true });
  });
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto(BASE);
  await expect(page.locator('canvas')).toBeVisible();
}

/** What a player sees on the canvas: its buffer size and how many pixels are not background. */
async function paintedPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas || !canvas.width || !canvas.height) return 0;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let i = 0; i < data.length; i += 4 * 97) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (!(Math.abs(r - 7) < 6 && Math.abs(g - 11) < 6 && Math.abs(b - 20) < 6)) painted += 1;
    }
    return painted;
  });
}

async function cellPoint(page: Page, cell: Point): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').boundingBox();
  const size = Math.min(box!.width / WIDTH, box!.height / HEIGHT);
  return { x: box!.x + (cell.x + 0.5) * size, y: box!.y + (cell.y + 0.5) * size };
}

async function clickCell(page: Page, cell: Point): Promise<void> {
  await page.mouse.click(...(Object.values(await cellPoint(page, cell)) as [number, number]));
}

/** The server's combat state: whose turn it is. The board reads it on its next render. */
async function setTurn(page: Page, turnId: string): Promise<void> {
  await page.evaluate((id) => {
    const harness = (window as unknown as { harness: { encounter: unknown; render: () => void } })
      .harness;
    harness.encounter = { id: 'enc-1797', currentTurnParticipantId: id };
    harness.render();
  }, turnId);
}

/** A socket event as the page receives it: the same window event the socket dispatches. */
async function dispatchDelta(page: Page, detail: unknown): Promise<void> {
  await page.evaluate(
    (event) => window.dispatchEvent(new CustomEvent('tactical-map-delta', { detail: event })),
    detail,
  );
}

async function setRailShown(page: Page, shown: boolean): Promise<void> {
  await page.evaluate((visible) => {
    (document.querySelector('[data-testid="rail"]') as HTMLElement).style.display = visible
      ? ''
      : 'none';
  }, shown);
}

test.describe('tactical map across rounds (#1797)', () => {
  test('keeps its picture and takes a move in rounds 1, 2 and 3', async ({ page }) => {
    const requests: string[] = [];
    await openHarness(page, requests);
    const count = (needle: string): number =>
      requests.filter((entry) => entry.includes(needle)).length;

    // Round 1: the hero moves.
    await setTurn(page, 'hero');
    await expect.poll(() => paintedPixels(page)).toBeGreaterThan(0);
    await clickCell(page, { x: 1, y: 2 });
    await expect.poll(() => count('/valid-moves/hero')).toBe(1);
    await clickCell(page, { x: 2, y: 2 });
    await expect.poll(() => count('/combat/enc-1797/intent')).toBe(1);
    await dispatchDelta(page, {
      type: 'entity_moved',
      entityId: 'hero',
      path: [
        { x: 1, y: 2 },
        { x: 2, y: 2 },
      ],
      movementRemaining: 20,
    });

    // The foe acts while the panel is hidden, and the next round's map arrives then too.
    await setTurn(page, 'foe');
    await setRailShown(page, false);
    await dispatchDelta(page, {
      type: 'tactical_action_queue',
      actions: [
        {
          type: 'entity_moved',
          entityId: 'foe',
          path: [
            { x: 6, y: 2 },
            { x: 5, y: 2 },
          ],
          movementRemaining: 20,
        },
      ],
    });
    await dispatchDelta(page, {
      type: 'map_created',
      map: mapAt(2, { x: 2, y: 2 }, { x: 5, y: 2 }),
    });
    await page.waitForTimeout(300);
    await setRailShown(page, true);

    // Round 2: the picture returns on its own, and the hero moves.
    await expect.poll(() => paintedPixels(page)).toBeGreaterThan(0);
    await setTurn(page, 'hero');
    await clickCell(page, { x: 2, y: 2 });
    await expect.poll(() => count('/valid-moves/hero')).toBe(2);
    await clickCell(page, { x: 3, y: 2 });
    await expect.poll(() => count('/combat/enc-1797/intent')).toBe(2);
    await dispatchDelta(page, {
      type: 'entity_moved',
      entityId: 'hero',
      path: [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ],
      movementRemaining: 10,
    });

    // Round 3: the same again, with the panel hidden and shown once more.
    await setTurn(page, 'foe');
    await setRailShown(page, false);
    await dispatchDelta(page, {
      type: 'map_created',
      map: mapAt(3, { x: 3, y: 2 }, { x: 4, y: 2 }),
    });
    await page.waitForTimeout(300);
    await setRailShown(page, true);
    await expect.poll(() => paintedPixels(page)).toBeGreaterThan(0);
    await setTurn(page, 'hero');
    await clickCell(page, { x: 3, y: 2 });
    await expect.poll(() => count('/valid-moves/hero')).toBe(3);
    await clickCell(page, { x: 2, y: 2 });
    await expect.poll(() => count('/combat/enc-1797/intent')).toBe(3);
  });
});
