import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'bun:test';

import { checkLandingPreload, landingJsHrefs } from './check-landing-preload.mjs';

const tempRoots: string[] = [];

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

/** A dist/ directory whose index.html preloads the given chunks: [href, body] pairs. */
function makeDist(preloads: Array<[string, string]>, entryBody = 'export {}'): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'landing-preload-'));
  tempRoots.push(root);
  mkdirSync(path.join(root, 'assets'));
  const entry = '/assets/main-abc123.js';
  const links = preloads.map(
    ([href]) => `    <link rel="modulepreload" crossorigin href="${href}">`,
  );
  writeFileSync(
    path.join(root, 'index.html'),
    [
      '<!DOCTYPE html>',
      '<html><head>',
      ...links,
      `</head><body><script type="module" crossorigin src="${entry}"></script></body></html>`,
    ].join('\n'),
  );
  writeFileSync(path.join(root, entry), entryBody);
  for (const [href, body] of preloads) {
    writeFileSync(path.join(root, href), body);
  }
  return root;
}

describe('checkLandingPreload', () => {
  it('reads the entry script and every modulepreload href', () => {
    const html = `<script type="module" crossorigin src="/assets/main.js"></script>
      <link rel="stylesheet" href="/assets/main.css">
      <link rel="modulepreload" crossorigin href="/assets/vendor.js">`;

    expect(landingJsHrefs(html)).toEqual(['/assets/main.js', '/assets/vendor.js']);
  });

  it('passes when the landing page preloads no three.js chunk', () => {
    const dist = makeDist([
      ['/assets/react-111.js', 'export const react = 1;'],
      ['/assets/vendor-222.js', 'export const vendor = 2;'],
    ]);

    const result = checkLandingPreload(dist);

    expect(result.failures).toEqual([]);
    expect(result.files.map((file) => file.href)).toEqual([
      '/assets/main-abc123.js',
      '/assets/react-111.js',
      '/assets/vendor-222.js',
    ]);
    expect(result.rawBytes).toBeGreaterThan(0);
    expect(result.gzipBytes).toBeGreaterThan(0);
  });

  it('fails when the landing page preloads the three.js chunk by name (negative control)', () => {
    const dist = makeDist([
      ['/assets/react-111.js', 'export const react = 1;'],
      ['/assets/three-BR1SRXg-.js', 'export const scene = 3;'],
    ]);

    const result = checkLandingPreload(dist);

    expect(result.failures).toEqual([
      'landing page preloads the three.js chunk: /assets/three-BR1SRXg-.js',
    ]);
  });

  it('fails when a preloaded chunk with another name contains three.js code', () => {
    const dist = makeDist([['/assets/shell-333.js', 'class WebGLRenderer {}']]);

    const result = checkLandingPreload(dist);

    expect(result.failures).toEqual([
      'landing page loads three.js code (WebGLRenderer) in: /assets/shell-333.js',
    ]);
  });

  it('fails when the entry script itself contains three.js code', () => {
    const dist = makeDist([], 'class WebGLRenderer {}');

    const result = checkLandingPreload(dist);

    expect(result.failures).toEqual([
      'landing page loads three.js code (WebGLRenderer) in: /assets/main-abc123.js',
    ]);
  });
});
