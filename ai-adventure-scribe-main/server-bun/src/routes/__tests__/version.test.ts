import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'bun:test';

import { createRequestPipelineApp } from '../../http-pipeline.js';
import { createVersionRoutes, versionRoutes } from '../version.js';

// #2293 Part A. Testers had no way to tell which commit prod was running, so runs 12 and M6
// played a bundle without the #2280 fix. These go through the real request pipeline with no
// Authorization header, the way Playtest's browser and ops/smoke.sh call it.

const SHA = '3fa7eefe0c1d2b3a4f5e6d7c8b9a0f1e2d3c4b5a';
const INDEX_HTML =
  '<html><head><meta name="app-version" content="3fa7eefe0c1d">' +
  '<script type="module" crossorigin src="/assets/main-DMthKkaE.js"></script></head></html>';

async function getVersion(routes: ReturnType<typeof createVersionRoutes>) {
  const app = createRequestPipelineApp().use(routes);
  const res = await app.handle(new Request('http://localhost/version'));
  return { res, body: (await res.json()) as Record<string, unknown> };
}

describe('GET /version', () => {
  it('returns the injected commit, build time and live bundle with no auth', async () => {
    const { res, body } = await getVersion(
      createVersionRoutes({
        env: { GIT_COMMIT: SHA, BUILD_TIME: '2026-09-27T01:02:03Z' },
        gitHead: () => {
          throw new Error('GIT_COMMIT wins; git must not be asked');
        },
        readClientIndex: () => INDEX_HTML,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({
      commit: SHA,
      short: '3fa7eefe',
      builtAt: '2026-09-27T01:02:03.000Z',
      bundle: 'main-DMthKkaE.js',
      clientBuild: '3fa7eefe0c1d',
    });
  });

  it('falls back to git HEAD, then the process start time', async () => {
    const startedAt = new Date('2026-09-27T04:05:06Z');
    const { body } = await getVersion(
      createVersionRoutes({
        env: {},
        gitHead: () => SHA.toUpperCase(),
        readClientIndex: () => INDEX_HTML,
        startedAt,
      }),
    );
    expect(body.commit).toBe(SHA);
    expect(body.builtAt).toBe(startedAt.toISOString());
  });

  it('never fails: unknown commit and no bundle when neither can be read', async () => {
    const { res, body } = await getVersion(
      createVersionRoutes({
        env: { GIT_COMMIT: 'not a sha; rm -rf /', BUILD_TIME: 'garbage' },
        gitHead: () => {
          throw new Error('not a git checkout');
        },
        readClientIndex: () => {
          throw new Error('ENOENT');
        },
        startedAt: new Date('2026-09-27T00:00:00Z'),
      }),
    );
    expect(res.status).toBe(200);
    expect(body).toEqual({
      commit: 'unknown',
      short: 'unknown',
      builtAt: '2026-09-27T00:00:00.000Z',
      bundle: null,
      clientBuild: null,
    });
  });

  it('reads the bundle per request, so a publish after the restart shows up', async () => {
    let html = INDEX_HTML;
    const app = createRequestPipelineApp().use(
      createVersionRoutes({ env: { GIT_COMMIT: SHA }, readClientIndex: () => html }),
    );
    const first = await (await app.handle(new Request('http://localhost/version'))).json();
    html = INDEX_HTML.replace('main-DMthKkaE.js', 'main-Bx9fNew1.js');
    const second = await (await app.handle(new Request('http://localhost/version'))).json();
    expect([first.bundle, second.bundle]).toEqual(['main-DMthKkaE.js', 'main-Bx9fNew1.js']);
  });

  it('never echoes a non-SHA app-version stamp', async () => {
    const { body } = await getVersion(
      createVersionRoutes({
        env: { GIT_COMMIT: SHA },
        readClientIndex: () => '<meta name="app-version" content="<script>x</script>">',
      }),
    );
    expect(body.clientBuild).toBeNull();
  });

  it('the exported route (as mounted in app.ts) reports this checkout with no auth', async () => {
    const { res, body } = await getVersion(versionRoutes);
    expect(res.status).toBe(200);
    const head = process.env.GIT_COMMIT?.trim()
      ? process.env.GIT_COMMIT.trim().toLowerCase()
      : execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    expect(body.commit).toBe(head);
    expect(body.short).toBe(head.slice(0, 8));
    expect(Object.keys(body).sort()).toEqual([
      'builtAt',
      'bundle',
      'clientBuild',
      'commit',
      'short',
    ]);
  });
});
