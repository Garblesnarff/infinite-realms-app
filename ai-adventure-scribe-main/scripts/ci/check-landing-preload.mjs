#!/usr/bin/env node
/**
 * Guard: the landing page must not preload three.js (#226).
 *
 * The landing page is the SPA entry at "/". Vite lists every chunk that entry
 * imports statically as <link rel="modulepreload">, so one static import of a
 * lazy route's module puts that chunk on the first-paint path. This reads the
 * built index.html and fails if the entry script or any preloaded file is the
 * three.js chunk. It also prints what the landing page loads before first paint.
 *
 * Run after `vite build`: node scripts/ci/check-landing-preload.mjs [dist-dir]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

// Chunk names come from manualChunks in vite.config.ts; the marker is a three.js
// class name, so the check still fails if the chunk is renamed.
const THREE_CHUNK_FILE = /\/assets\/three-[^/]*\.js$/;
const THREE_MARKER = 'WebGLRenderer';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIST = path.resolve(SCRIPT_DIR, '..', '..', 'dist');

/** Hrefs of the entry script and every modulepreload link, in document order. */
export function landingJsHrefs(html) {
  const hrefs = [];
  for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
    if (!/\btype="module"/.test(tag)) continue;
    const src = tag.match(/\bsrc="([^"]+)"/);
    if (src) hrefs.push(src[1]);
  }
  for (const tag of html.match(/<link\b[^>]*>/g) ?? []) {
    if (!/\brel="modulepreload"/.test(tag)) continue;
    const href = tag.match(/\bhref="([^"]+)"/);
    if (href) hrefs.push(href[1]);
  }
  return hrefs;
}

/**
 * Sizes and failures for the landing page at `distDir` (the directory holding
 * index.html). Returns { files, rawBytes, gzipBytes, failures }.
 */
export function checkLandingPreload(distDir) {
  const html = readFileSync(path.join(distDir, 'index.html'), 'utf8');
  const hrefs = landingJsHrefs(html);
  const failures = [];
  if (hrefs.length === 0) {
    failures.push('index.html has no module entry script or modulepreload links');
  }

  const files = hrefs.map((href) => {
    const body = readFileSync(path.join(distDir, href));
    if (THREE_CHUNK_FILE.test(href)) {
      failures.push(`landing page preloads the three.js chunk: ${href}`);
    } else if (body.includes(THREE_MARKER)) {
      failures.push(`landing page loads three.js code (${THREE_MARKER}) in: ${href}`);
    }
    return { href, raw: body.length, gzip: gzipSync(body).length };
  });

  return {
    files,
    rawBytes: files.reduce((sum, file) => sum + file.raw, 0),
    gzipBytes: files.reduce((sum, file) => sum + file.gzip, 0),
    failures,
  };
}

function main() {
  const distDir = path.resolve(process.argv[2] ?? DEFAULT_DIST);
  const result = checkLandingPreload(distDir);

  for (const file of result.files) {
    console.log(`${String(file.raw).padStart(10)} ${String(file.gzip).padStart(9)}  ${file.href}`);
  }
  console.log(
    `landing JS before first paint: ${result.files.length} files, ${result.rawBytes} bytes raw, ${result.gzipBytes} bytes gzip`,
  );

  if (result.failures.length > 0) {
    for (const failure of result.failures) console.error(`FAIL: ${failure}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
