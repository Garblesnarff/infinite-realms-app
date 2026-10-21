import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function run(diagnostics: string, exit = 2, entry = 'src/legacy.ts : 1 # #664', server = false) {
  const app = mkdtempSync(resolve(tmpdir(), 'cli-gate-'));
  dirs.push(app);
  for (const dir of ['scripts', 'cli', 'server-bun', 'bin']) mkdirSync(resolve(app, dir));
  for (const file of ['cli-typecheck-gate.sh', 'server-typecheck-gate.sh'])
    copyFileSync(resolve(appRoot, 'scripts', file), resolve(app, 'scripts', file));
  writeFileSync(resolve(app, 'cli/typecheck-known-errors.txt'), entry);
  writeFileSync(resolve(app, 'server-bun/typecheck-known-errors.txt'), '');
  writeFileSync(resolve(app, 'diagnostics'), diagnostics);
  writeFileSync(
    resolve(app, 'bin/bun'),
    '#!/bin/sh\ncase "$*" in *cli/tsconfig.json*) cat "$DIAGNOSTICS"; exit "$TSC_EXIT";; *) exit 0;; esac\n',
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    PATH: `${app}/bin:${process.env.PATH}`,
    DIAGNOSTICS: `${app}/diagnostics`,
    TSC_EXIT: String(exit),
  };
  try {
    return {
      status: 0,
      output: execFileSync(
        'bash',
        [resolve(app, 'scripts', server ? 'server-typecheck-gate.sh' : 'cli-typecheck-gate.sh')],
        { env, encoding: 'utf8' },
      ),
    };
  } catch (error) {
    const failed = error as { status: number; stdout: string };
    return { status: failed.status, output: String(failed.stdout) };
  }
}
const known = 'src/legacy.ts(1,1): error TS2322: known\n';
describe('#844 CLI typecheck CI owner', () => {
  it('accepts the exact acknowledged file/count', () => {
    expect(run(known).status).toBe(0);
  });
  it('rejects a new file', () => {
    expect(run(known + 'cli/src/new.ts(1,1): error TS2322: new\n').status).toBe(1);
  });
  it('rejects count increases and resolved quarantines', () => {
    expect(run(known + known).status).toBe(1);
    expect(run('', 0).status).toBe(1);
  });
  it('rejects global errors and crashes without diagnostics', () => {
    expect(run('error TS5083: bad config\n').status).toBe(1);
    expect(run('out of memory\n', 137).status).toBe(1);
  });
  it('rejects malformed allowlists', () => {
    expect(run(known, 2, 'src/legacy.ts : nope').status).toBe(1);
  });
  it('fails the existing server CI entry point on a new CLI error', () => {
    const result = run(known + 'cli/src/new.ts(1,1): error TS2322: new\n', 2, undefined, true);
    expect(result.status).toBe(1);
    expect(result.output).toContain('server-typecheck: PASS');
    expect(result.output).toContain('cli/src/new.ts');
  });
});
