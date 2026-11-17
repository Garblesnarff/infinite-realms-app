/**
 * #1432: capture the Table game screen for the landing hero (desktop and phone).
 *
 * Re-run after a UI change:
 *   1. Start the layout fixture (the same server playwright.config.ts starts for e2e):
 *      VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=playwright-layout-harness \
 *        bunx vite --host 127.0.0.1 --port 4173
 *   2. bun run scripts/capture-landing-picture.ts
 *
 * What it does: opens the repo's own Table fixture (e2e/table-game-layout.tsx) with fixture
 * story, character and campaign names. Only /v1/** on localhost:8888 is answered, by the
 * fixture stubs below. Every other request is aborted, so no live DM, no database and no
 * sign-in is reached. Each screenshot is taken at deviceScaleFactor 2, then drawn to the
 * target width and encoded in the browser as WebP plus a PNG fallback.
 *
 * Outputs (under public/landing/):
 *   table-game-1280.webp / .png   1280 px wide desktop capture, cropped to 900:561 ratio
 *   table-game-390.webp  / .png   390 px wide phone capture, cropped to 254:549 ratio
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const outDir = resolve(appRoot, 'public', 'landing');
const baseUrl = process.env.CAPTURE_BASE_URL ?? 'http://127.0.0.1:4173';
const chromiumPath = process.env.CAPTURE_CHROMIUM_PATH;

interface Shot {
  name: string;
  viewport: { width: number; height: number };
  /** Output width in CSS px; the capture is drawn at this width. */
  outWidth: number;
  /** Rows kept after the top, so the picture has the aspect ratio the board draws. */
  keepHeight: number;
  query: string;
}

const shots: Shot[] = [
  {
    name: 'table-game-1280',
    viewport: { width: 1280, height: 800 },
    outWidth: 1280,
    keepHeight: 798,
    query: 'roll=true',
  },
  {
    name: 'table-game-390',
    viewport: { width: 390, height: 844 },
    outWidth: 390,
    keepHeight: 843,
    query: 'roll=true',
  },
];

const turnResponse = (path: string): { status: number; body: string } => {
  if (path.endsWith('/messages')) return { status: 200, body: '{"messages":[],"total":0}' };
  if (path.endsWith('/legal-actions'))
    return {
      status: 200,
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
    };
  if (path.endsWith('/tactical-map')) return { status: 200, body: '{"map":null}' };
  return { status: 404, body: '{}' };
};

async function capture(browser: Browser, shot: Shot): Promise<void> {
  const context = await browser.newContext({
    viewport: shot.viewport,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && url.port === new URL(baseUrl).port) return route.continue();
    if (url.hostname === 'localhost' && url.port === '8888' && url.pathname.startsWith('/v1/')) {
      const { status, body } = turnResponse(url.pathname);
      return route.fulfill({ status, contentType: 'application/json', body });
    }
    return route.abort();
  });

  await page.goto(`${baseUrl}/e2e/table-game-layout.html?${shot.query}`, { waitUntil: 'load' });
  await page.getByTestId('story-box').waitFor({ timeout: 120_000 });
  await page.waitForTimeout(2500);

  // The header's build-and-session button (BuildSessionStatus) shows a build id and a session id.
  // Screenshots must not carry ids (#1432), so it is hidden for the capture only.
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('[data-testid="build-session-status"]').forEach((el) => {
      el.style.visibility = 'hidden';
    });
  });

  const png = await page.screenshot({ type: 'png' });
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;

  const encoded = await page.evaluate(
    async ({
      src,
      outWidth,
      keepHeight,
    }): Promise<{ width: number; height: number; webp: number[]; png: number[] }> => {
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
      // Source is the 2x capture; keep the top keepHeight CSS px of it.
      ctx.drawImage(img, 0, 0, img.naturalWidth, keepHeight * 2, 0, 0, outWidth, outHeight);
      const toBytes = (type: string, quality?: number): Promise<number[]> =>
        new Promise<number[]>((resolve, reject) =>
          canvas.toBlob(
            async (blob) => {
              if (!blob) return reject(new Error(`encode ${type} failed`));
              resolve(Array.from(new Uint8Array(await blob.arrayBuffer())));
            },
            type,
            quality,
          ),
        );
      return {
        width: outWidth,
        height: outHeight,
        webp: await toBytes('image/webp', 0.82),
        png: await toBytes('image/png'),
      };
    },
    { src: dataUrl, outWidth: shot.outWidth, keepHeight: shot.keepHeight },
  );

  mkdirSync(outDir, { recursive: true });
  const webpPath = resolve(outDir, `${shot.name}.webp`);
  const pngPath = resolve(outDir, `${shot.name}.png`);
  writeFileSync(webpPath, Buffer.from(encoded.webp));
  writeFileSync(pngPath, Buffer.from(encoded.png));
  // Palette-reduce the PNG fallback with ImageMagick when it is installed (plain PNG is ~5x larger).
  if (Bun.which('convert')) {
    const reduced = Bun.spawnSync([
      'convert',
      pngPath,
      '-strip',
      '-colors',
      '256',
      '-define',
      'png:compression-level=9',
      pngPath,
    ]);
    if (reduced.exitCode !== 0) throw new Error(`convert failed for ${pngPath}`);
  }
  process.stdout.write(
    `${shot.name}: ${encoded.width}x${encoded.height} webp=${encoded.webp.length}B png=${Bun.file(pngPath).size}B\n`,
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
