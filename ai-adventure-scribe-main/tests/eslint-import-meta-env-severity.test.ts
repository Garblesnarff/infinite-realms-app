import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Lints inline fixtures with the repo's real eslint.config.js, as if they were
// files under src/. #2216: the import.meta?.env guard (#2211) must be an error
// while the WorkOS getItem('workos_access_token') selector stays a warning.
const eslint = new ESLint({ cwd: process.cwd() });

const SEVERITY = { 1: 'warn', 2: 'error' } as const;

type Report = { ruleId: string | null; severity: 'warn' | 'error' };

async function lintAs(filePath: string, code: string): Promise<Report[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages
    .filter(
      (m) =>
        m.ruleId === 'local/no-optional-import-meta-env' || m.ruleId === 'no-restricted-syntax',
    )
    .map((m) => ({ ruleId: m.ruleId, severity: SEVERITY[m.severity as 1 | 2] }));
}

// Built from parts so the #2211 grep test and this file's own lint stay clean.
const OPTIONAL_META_ENV = `export const flag = import.meta${'?.'}env.VITE_FLAG;\n`;
const WORKOS_READ = "export const token = localStorage.getItem('workos_access_token');\n";

describe('eslint severity for import.meta?.env vs WorkOS token reads (#2216)', () => {
  it('reports import.meta?.env as an error', async () => {
    expect(await lintAs('src/lint-fixture.ts', OPTIONAL_META_ENV)).toEqual([
      { ruleId: 'local/no-optional-import-meta-env', severity: 'error' },
    ]);
  });

  it('still reports the WorkOS token read as a warning only', async () => {
    expect(await lintAs('src/lint-fixture.ts', WORKOS_READ)).toEqual([
      { ruleId: 'no-restricted-syntax', severity: 'warn' },
    ]);
  });

  it('reports both at their own severity in one file', async () => {
    const messages = await lintAs('src/lint-fixture.ts', OPTIONAL_META_ENV + WORKOS_READ);
    expect(messages).toEqual([
      { ruleId: 'local/no-optional-import-meta-env', severity: 'error' },
      { ruleId: 'no-restricted-syntax', severity: 'warn' },
    ]);
  });

  it('allows import.meta.env.X and import.meta.env?.X', async () => {
    const code =
      'export const a = import.meta.env.VITE_A;\nexport const b = import.meta.env?.VITE_B;\n';
    expect(await lintAs('src/lint-fixture.ts', code)).toEqual([]);
  });

  it('keeps the WorkOS read allowed in TokenService', async () => {
    expect(await lintAs('src/services/auth/TokenService.ts', WORKOS_READ)).toEqual([]);
  });
});
