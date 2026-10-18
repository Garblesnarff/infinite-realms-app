import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'bun:test';

const scriptsDir = path.resolve(import.meta.dir, '../../scripts');

async function runFixture(
  files: Record<string, string>,
): Promise<{ exitCode: number; output: string }> {
  const root = mkdtempSync(path.join(tmpdir(), 'isolated-runner-'));
  try {
    mkdirSync(path.join(root, 'scripts'));
    mkdirSync(path.join(root, 'src'));
    for (const script of ['run-isolated-tests.ts', 'apple-double.ts']) {
      copyFileSync(path.join(scriptsDir, script), path.join(root, 'scripts', script));
    }
    for (const [file, source] of Object.entries(files)) {
      writeFileSync(path.join(root, 'src', file), source);
    }
    const proc = Bun.spawn({
      cmd: [process.execPath, 'scripts/run-isolated-tests.ts'],
      cwd: root,
      env: { ...process.env, ISOLATED_TEST_CONCURRENCY: '2' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, output: stdout + stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const passingTest = `import { test, expect } from 'bun:test';
test('passes', () => expect(1).toBe(1));`;

describe('isolated test runner', () => {
  it('runs TypeScript and TSX test files, excluding AppleDouble sidecars', async () => {
    const result = await runFixture({
      'ordinary.test.ts': passingTest,
      'view.test.tsx': passingTest,
      '._sidecar.test.tsx': 'throw new Error("sidecar must not execute");',
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Ran 2 tests across 2 files.');
    expect(result.output).toContain('2 pass');
  });

  it('rejects an empty file even when another file passes', async () => {
    const result = await runFixture({
      'ordinary.test.ts': passingTest,
      'empty.test.ts': 'export {};',
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('src/empty.test.ts');
    expect(result.output).toContain('did not report any tests');
  });

  it('rejects a successful early exit with no test summary', async () => {
    const result = await runFixture({ 'early-exit.test.ts': 'process.exit(0);' });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('did not report any tests');
  });

  it('preserves suites deliberately skipped without a database', async () => {
    const result = await runFixture({
      'db.real-db.test.ts': `import { describe, test } from 'bun:test';
describe.skip('database unavailable', () => { test('needs a database', () => {}); });`,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Ran 1 tests across 1 files.');
    expect(result.output).toContain('1 skip');
  });

  it('propagates assertion failures', async () => {
    const result = await runFixture({
      'failure.test.ts': `import { test, expect } from 'bun:test';
test('fails', () => expect(1).toBe(2));`,
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('1 fail');
  });

  it('keeps module replacements local while files run concurrently', async () => {
    const result = await runFixture({
      'target.ts': 'export const value = "original";',
      'mocked.test.ts': `import { test, expect, mock } from 'bun:test';
mock.module('./target', () => ({ value: 'mocked' }));
const { value } = await import('./target');
test('sees its replacement', () => expect(value).toBe('mocked'));`,
      'unmocked.test.ts': `import { test, expect } from 'bun:test';
import { value } from './target';
test('sees the original module', () => expect(value).toBe('original'));`,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Ran 2 tests across 2 files.');
    expect(result.output).toContain('2 pass');
  });
});

describe('server discovery CLI', () => {
  it('names known-unrun suites and their reasons without claiming every suite runs', () => {
    const scriptDir = path.resolve(import.meta.dir, '../../../scripts/ci');
    const backlog: Record<string, string> = JSON.parse(
      readFileSync(path.join(scriptDir, 'real-db-known-unlisted.json'), 'utf8'),
    );
    const result = spawnSync(
      process.execPath,
      [path.join(scriptDir, 'check-server-tests-run.mjs')],
      {
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${Object.keys(backlog).length} known-unrun suite(s)`);
    for (const [file, reason] of Object.entries(backlog)) {
      expect(result.stdout).toContain(`${file} — ${reason}`);
    }
    expect(result.stdout).not.toContain('every server-bun test file is run');
  });
});
