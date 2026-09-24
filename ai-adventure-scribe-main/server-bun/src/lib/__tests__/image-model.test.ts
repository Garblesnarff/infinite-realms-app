import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';

import { DEFAULT_IMAGE_MODEL, resolveImageModel } from '../image-model.js';

describe('resolveImageModel (#2201)', () => {
  it('returns the env value when set', () => {
    expect(resolveImageModel({ OPENROUTER_IMAGE_MODEL: 'vendor/some-model' })).toBe(
      'vendor/some-model',
    );
  });

  it('falls back to the #2177 code default when unset or empty', () => {
    expect(DEFAULT_IMAGE_MODEL).toBe('google/gemini-3.1-flash-image');
    expect(resolveImageModel({})).toBe(DEFAULT_IMAGE_MODEL);
    expect(resolveImageModel({ OPENROUTER_IMAGE_MODEL: '' })).toBe(DEFAULT_IMAGE_MODEL);
  });

  it('matches the expression routes/v1/images.ts uses for the request', () => {
    const src = readFileSync(join(import.meta.dir, '../../routes/v1/images.ts'), 'utf8');
    expect(src).toContain(`process.env.OPENROUTER_IMAGE_MODEL || '${DEFAULT_IMAGE_MODEL}'`);
  });
});

describe('GET /health imageModel (#2201)', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'sk-test-must-not-appear';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  async function health(): Promise<{ body: Record<string, unknown>; raw: string }> {
    const { buildHealthPayload } = await import('../health-payload.js');
    const app = new Elysia().get('/health', () => buildHealthPayload());
    const res = await app.handle(new Request('http://localhost/health'));
    expect(res.status).toBe(200);
    const raw = await res.text();
    return { body: JSON.parse(raw) as Record<string, unknown>, raw };
  }

  it('reports the env model name', async () => {
    process.env.OPENROUTER_IMAGE_MODEL = 'vendor/env-model';
    expect((await health()).body.imageModel).toBe('vendor/env-model');
  });

  it('reports the code default when the env is unset', async () => {
    delete process.env.OPENROUTER_IMAGE_MODEL;
    expect((await health()).body.imageModel).toBe(DEFAULT_IMAGE_MODEL);
  });

  it('never includes a key', async () => {
    process.env.OPENROUTER_IMAGE_MODEL = 'vendor/env-model';
    expect((await health()).raw).not.toContain('sk-test-must-not-appear');
  });
});
