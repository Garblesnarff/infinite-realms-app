/**
 * #1432: capture the Table game screen for the landing hero (desktop and phone).
 *
 * Re-run after a UI change:
 *   1. Start the capture fixture's dev server (the same env playwright.config.ts uses):
 *      VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=playwright-layout-harness \
 *        bunx vite --host 127.0.0.1 --port 4173
 *   2. bun run scripts/capture-landing-picture.ts
 *
 * The fixture is e2e/landing-hero-capture.tsx. Every name in it is invented. The script answers
 * only these requests and aborts everything else, so no live DM, database or sign-in is reached:
 *   - /v1/** on localhost:8888: the fixture's stubs (messages, legal actions, no encounter);
 *   - /tactical-map: the fixed battle map in e2e/landing-hero-capture.map.json;
 *   - the public-storage render URL for the scene art: a repo image (public/hero-bg-v2.jpg).
 *
 * Each capture is taken at deviceScaleFactor 2, drawn to the target width and encoded in the
 * browser as WebP. Outputs (under public/landing/):
 *   table-game-1280.webp  1280 px wide, the desktop picture (900:561 display ratio)
 *   table-game-390.webp   390 px wide, the phone picture (254:549 display ratio)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const outDir = resolve(appRoot, 'public', 'landing');
const baseUrl = process.env.CAPTURE_BASE_URL ?? 'http://127.0.0.1:4173';
const chromiumPath = process.env.CAPTURE_CHROMIUM_PATH;
const sceneArtFile = resolve(appRoot, 'public', 'hero-bg-v2.jpg');
const mapFile = resolve(appRoot, 'e2e', 'landing-hero-capture.map.json');

interface Shot {
  name: string;
  viewport: { width: number; height: number };
  /** Output width in CSS px; the 2x capture is drawn at this width. */
  outWidth: number;
  /** Rows kept from the top, so the picture has the aspect ratio the board draws. */
  keepHeight: number;
  /** Decorative chrome hidden for this picture only (the phone's rail and strip, the table frame, the candle). */
  hide: string[];
}

const shots: Shot[] = [
  {
    name: 'table-game-1280',
    viewport: { width: 1280, height: 800 },
    outWidth: 1280,
    keepHeight: 798,
    hide: ['.ir-table-felt', '.ir-candle'],
  },
  {
    name: 'table-game-390',
    viewport: { width: 390, height: 844 },
    outWidth: 390,
    keepHeight: 843,
    hide: ['.timeline-rail', '.order-1 > .min-h-0', '.ir-table-felt', '.ir-candle'],
  },
];

const sceneArt = readFileSync(sceneArtFile);
const tacticalMapJson = readFileSync(mapFile, 'utf8');

const apiResponse = (path: string): { status: number; body: string } => {
  if (path.endsWith('/messages')) return { status: 200, body: '{"messages":[],"total":0}' };
  if (path.endsWith('/legal-actions'))
    return {
      status: 200,
      body: JSON.stringify({
        actorId: 'hero',
        actions: [
          { type: 'attack', label: 'Attack with Dagger', weaponId: 'dagger', targetIds: ['foe'] },
          { type: 'dodge', label: 'Dodge' },
          { type: 'end_turn', label: 'End turn' },
        ],
      }),
    };
  if (path.endsWith('/tactical-map')) return { status: 200, body: tacticalMapJson };
  return { status: 404, body: '{}' };
};

async function capture(browser: Browser, shot: Shot): Promise<void> {
  const context = await browser.newContext({ viewport: shot.viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const localPort = new URL(baseUrl).port;

  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && url.port === localPort) return route.continue();
    if (url.hostname === 'localhost' && url.port === '8888' && url.pathname.startsWith('/v1/')) {
      const { status, body } = apiResponse(url.pathname);
      return route.fulfill({ status, contentType: 'application/json', body });
    }
    if (
      url.hostname === 'example.supabase.co' &&
      url.pathname.includes('/storage/v1/render/image/public/')
    ) {
      return route.fulfill({ status: 200, contentType: 'image/jpeg', body: sceneArt });
    }
    return route.abort();
  });

  await page.goto(`${baseUrl}/e2e/landing-hero-capture.html`, { waitUntil: 'load' });
  await page.getByTestId('story-box').waitFor({ timeout: 120_000 });
  // The option cards arrive after the DM message settles; wait for the first card, not a fixed time.
  await page
    .getByText('Climb hand over hand')
    .first()
    .waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(1000);

  // The header's build-and-session button shows a build id and a session id. Screenshots must not
  // carry ids (#1432), so it is hidden for the capture only.
  await page.evaluate(
    ({ ids, selectors }: { ids: string[]; selectors: string[] }) => {
      for (const selector of ids) {
        document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
          el.style.visibility = 'hidden';
        });
      }
      for (const selector of selectors) {
        document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
          el.style.display = 'none';
        });
      }
    },
    { ids: ['[data-testid="build-session-status"]'], selectors: shot.hide },
  );

  // Start the story on a whole message: scroll the story so the first message that fits in the
  // box, with every message below it, is at the top edge. A half-cut message never starts the picture.
  await page.evaluate(() => {
    const first = document.querySelector<HTMLElement>('[data-testid="story-box"] [id^="m-"]');
    if (!first) return;
    let scroller: HTMLElement | null = first.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (!scroller) return;
    const messages = [...scroller.querySelectorAll<HTMLElement>(':scope [id^="m-"]')];
    const last = messages[messages.length - 1];
    const viewTop = scroller.getBoundingClientRect().top;
    const fits = (el: HTMLElement): boolean =>
      last.getBoundingClientRect().bottom - el.getBoundingClientRect().top <= scroller.clientHeight;
    const start = messages.find(fits) ?? last;
    // Align below the scroller's top padding, so the message's label and avatar are not in the fade.
    const padTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
    scroller.style.scrollBehavior = 'auto';
    scroller.scrollTop += start.getBoundingClientRect().top - viewTop - padTop;
  });
  await page.waitForTimeout(400);

  const png = await page.screenshot({ type: 'png' });
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;

  const encoded = await page.evaluate(
    async ({
      src,
      outWidth,
      keepHeight,
    }): Promise<{ width: number; height: number; webp: number[] }> => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const scale = outWidth / (img.naturalWidth / 2);
      const outHeight = Math.round(keepHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = outWidth;
      canvas.height = outHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d canvas');
      ctx.imageSmoothingQuality = 'high';
      // The source is the 2x capture; keep its top keepHeight CSS px.
      ctx.drawImage(img, 0, 0, img.naturalWidth, keepHeight * 2, 0, 0, outWidth, outHeight);
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('webp encode failed'))),
          'image/webp',
          0.84,
        ),
      );
      return {
        width: outWidth,
        height: outHeight,
        webp: Array.from(new Uint8Array(await blob.arrayBuffer())),
      };
    },
    { src: dataUrl, outWidth: shot.outWidth, keepHeight: shot.keepHeight },
  );

  mkdirSync(outDir, { recursive: true });
  const webpPath = resolve(outDir, `${shot.name}.webp`);
  writeFileSync(webpPath, Buffer.from(encoded.webp));
  process.stdout.write(
    `${shot.name}: ${encoded.width}x${encoded.height} webp=${encoded.webp.length}B\n`,
  );
  await context.close();
}

const browser = await chromium.launch({
  ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  args: ['--no-sandbox'],
});
try {
  for (const shot of shots) {
    await capture(browser, shot);
  }
} finally {
  await browser.close();
}
