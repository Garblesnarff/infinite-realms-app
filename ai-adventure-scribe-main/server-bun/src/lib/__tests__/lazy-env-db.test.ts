import { describe, expect, test } from 'bun:test';

const REQUIRED = ['DATABASE_URL', 'PORT', 'CORS_ORIGIN', 'WORKOS_API_KEY', 'WORKOS_CLIENT_ID'];

/** Run a script in a fresh process so the module cache and env are clean. */
async function runScript(script: string, setEnv: boolean) {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const name of REQUIRED) delete env[name];
  if (setEnv) {
    for (const name of REQUIRED) env[name] = `test-${name.toLowerCase()}`;
    env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test';
  }
  const proc = Bun.spawn([process.execPath, '--no-env-file', '-e', script], {
    cwd: new URL('../../..', import.meta.url).pathname,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe('AIUsageService import with env unset (#2183)', () => {
  test('imports without throwing and fails at first use with a clear error', async () => {
    const result = await runScript(
      `
      const mod = await import('./src/services/ai-usage-service.ts');
      console.log('units=' + mod.voiceQuotaUnits(250));
      try {
        await (await import('./src/lib/db.ts')).sql\`select 1\`;
        console.log('NO_THROW');
      } catch (e) {
        console.log('ERR=' + e.message.split('\\n').join('|'));
      }
      `,
      false,
    );
    expect(result.stderr).not.toContain('Missing required environment variables');
    expect(result.stdout).toContain('units=3');
    expect(result.stdout).toContain('ERR=Missing required environment variables:');
    for (const name of REQUIRED) expect(result.stdout).toContain(name);
  });

  test('with env set, import works and env and sql are usable', async () => {
    const result = await runScript(
      `
      const mod = await import('./src/services/ai-usage-service.ts');
      const { sql } = await import('./src/lib/db.ts');
      const { env } = await import('./src/lib/env.ts');
      console.log('units=' + mod.voiceQuotaUnits(250));
      console.log('port=' + env.PORT);
      console.log('unsafe=' + typeof sql.unsafe);
      process.exit(0);
      `,
      true,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('units=3');
    expect(result.stdout).toContain('port=test-port');
    expect(result.stdout).toContain('unsafe=function');
  });
});
