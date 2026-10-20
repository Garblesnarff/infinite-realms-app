import { test, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file compiles to dist/test/, so the package root is two levels up.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));

const binRelativePath: string = pkg.bin['lore-keeper-mcp'];
const binPath = join(packageRoot, binRelativePath);

describe('Start entry point (smoke)', () => {
  it('package main, bin, and start all point at files the build actually emits', () => {
    assert.ok(
      existsSync(join(packageRoot, pkg.main)),
      `main target ${pkg.main} should exist after build`
    );
    assert.ok(
      existsSync(binPath),
      `bin target ${binRelativePath} should exist after build`
    );
    // The start script is the exact surface that broke in #845 ("npm start"
    // → MODULE_NOT_FOUND), so its target is regression-guarded too.
    const startTarget: string = String(pkg.scripts.start).replace(/^node\s+/, '');
    assert.ok(
      existsSync(join(packageRoot, startTarget)),
      `start target ${startTarget} should exist after build`
    );
    assert.equal(
      resolve(packageRoot, startTarget),
      binPath,
      'start and bin should resolve to the same entry file'
    );
  });

  it('the start entry answers an MCP initialize request over stdio', async () => {
    const child: ChildProcess = spawn(process.execPath, [binPath], {
      cwd: packageRoot,
      env: {
        ...process.env,
        // Dummy values: client construction does not connect, and the
        // initialize handshake never touches the database.
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_SERVICE_ROLE_KEY: 'smoke-test-key',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    try {
      const response = await new Promise<any>((resolvePromise, rejectPromise) => {
        const timer = setTimeout(() => {
          rejectPromise(
            new Error(`Timed out waiting for initialize response. stderr: ${stderr}`)
          );
        }, 15000);

        let buffer = '';
        child.stdout?.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const message = JSON.parse(line);
              if (message.id === 1) {
                clearTimeout(timer);
                resolvePromise(message);
              }
            } catch {
              // Not a complete JSON message yet; keep buffering.
            }
          }
        });
        child.on('error', (error) => {
          clearTimeout(timer);
          rejectPromise(error);
        });
        child.on('exit', (code) => {
          clearTimeout(timer);
          rejectPromise(
            new Error(`Server exited early with code ${code}. stderr: ${stderr}`)
          );
        });

        child.stdin?.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'smoke-test', version: '0.0.0' },
            },
          }) + '\n'
        );
      });

      assert.equal(response.jsonrpc, '2.0');
      assert.ok(response.result, 'initialize should return a result');
      assert.equal(response.result.serverInfo.name, 'lore-keeper-server');
      assert.ok(
        typeof response.result.protocolVersion === 'string' &&
          response.result.protocolVersion.length > 0,
        'initialize result should carry a protocolVersion'
      );
    } finally {
      child.kill('SIGTERM');
      // Give the graceful-shutdown handler a moment, then force-kill so the
      // test run never hangs on a lingering child.
      await Promise.race([
        new Promise((resolvePromise) => child.on('exit', resolvePromise)),
        new Promise((resolvePromise) => setTimeout(resolvePromise, 3000)),
      ]);
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }
  });
});
