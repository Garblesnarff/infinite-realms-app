import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { llmFetch, llmFixtureKey } from '../llm-fixture-fetch.js';

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

describe('llm-fixture-fetch', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `llm-fixture-test-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
    delete process.env.LLM_FIXTURE_DIR;
    delete process.env.LLM_RECORD_DIR;
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('record mode writes fixture without headers/query/keys', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ test: 'value' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    globalThis.fetch = mockFetch as any;

    process.env.LLM_RECORD_DIR = tempDir;
    const url = 'https://openrouter.ai/api/v1/chat/completions?key=secret&other=param';
    const body = JSON.stringify({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hello' }],
    });

    const response = await llmFetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json',
      },
      body,
    });

    expect(response.status).toBe(200);
    const key = llmFixtureKey(url, JSON.parse(body));
    const fixturePath = join(tempDir, `${key}.json`);
    expect(existsSync(fixturePath)).toBe(true);

    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    expect(fixture.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(fixture.url).not.toContain('key=');
    expect(fixture.request).toEqual(JSON.parse(body));
    expect(fixture.request).not.toHaveProperty('Authorization');
    expect(fixture.body).toBe(JSON.stringify({ test: 'value' }));
    expect(readFileSync(fixturePath, 'utf8')).not.toContain('secret');
  });

  it('a recorded response replays byte-identical with no network call', async () => {
    const upstream = 'data: {"choices":[{"delta":{"content":"Hi \u00e9"}}]}\n\ndata: [DONE]\n\n';
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(upstream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      ) as any;
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/m:generateContent?key=secret';
    const init = {
      method: 'POST',
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
    };

    process.env.LLM_RECORD_DIR = tempDir;
    const recorded = await (await llmFetch(url, init)).text();
    delete process.env.LLM_RECORD_DIR;

    const noNetwork = vi.fn().mockImplementation(() => {
      throw new Error('should not be called');
    });
    globalThis.fetch = noNetwork as any;
    process.env.LLM_FIXTURE_DIR = tempDir;
    const replayed = await llmFetch(url, init);

    expect(await replayed.text()).toBe(recorded);
    expect(recorded).toBe(upstream);
    expect(replayed.status).toBe(200);
    expect(replayed.headers.get('content-type')).toBe('text/event-stream');
    expect(noNetwork).not.toHaveBeenCalled();
  });

  it('a recorded 429 replays its status and retry-after', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('rate limited', { status: 429, headers: { 'retry-after': '7' } }),
      ) as any;
    const url = 'https://openrouter.ai/api/v1/chat/completions';
    const init = { method: 'POST', body: JSON.stringify({ model: 'm', messages: [] }) };
    process.env.LLM_RECORD_DIR = tempDir;
    await llmFetch(url, init);
    delete process.env.LLM_RECORD_DIR;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      throw new Error('should not be called');
    }) as any;
    process.env.LLM_FIXTURE_DIR = tempDir;
    const replayed = await llmFetch(url, init);
    expect(replayed.status).toBe(429);
    expect(replayed.headers.get('retry-after')).toBe('7');
    expect(await replayed.text()).toBe('rate limited');
  });

  it('replay returns fixture and does not call fetch', async () => {
    const mockFetch = vi.fn().mockImplementation(() => {
      throw new Error('should not be called');
    });
    globalThis.fetch = mockFetch as any;

    const url = 'https://openrouter.ai/api/v1/chat/completions?key=secret';
    const body = {
      model: 'test/model',
      messages: [{ role: 'user', content: 'hello' }],
    };
    const requestBody = JSON.stringify(body);
    const key = llmFixtureKey(url, body);
    const fixturePath = join(tempDir, `${key}.json`);
    const fixture = {
      key,
      url: 'https://openrouter.ai/api/v1/chat/completions',
      request: body,
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ replayed: true }),
    };
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(fixturePath, JSON.stringify(fixture));

    process.env.LLM_FIXTURE_DIR = tempDir;
    const response = await llmFetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer token' },
      body: requestBody,
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe(JSON.stringify({ replayed: true }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('key ignores headers and query string but changes when user message changes', () => {
    const url1 = 'https://openrouter.ai/api/v1/chat/completions?key=abc&param=1';
    const url2 = 'https://openrouter.ai/api/v1/chat/completions?key=def&other=2';
    const body1 = {
      model: 'test/model',
      messages: [{ role: 'user', content: 'hello' }],
    };
    const body2 = {
      model: 'test/model',
      messages: [{ role: 'user', content: 'world' }],
    };

    const key1 = llmFixtureKey(url1, body1);
    const key2 = llmFixtureKey(url2, body1); // same except query/key in url, but we strip query
    const key3 = llmFixtureKey(url1, body2);

    expect(key1).toBe(key2); // query ignored
    expect(key1).not.toBe(key3); // message change matters
  });

  it('missing fixture throws', async () => {
    process.env.LLM_FIXTURE_DIR = tempDir;
    const url = 'https://openrouter.ai/api/v1/chat/completions';
    await expect(
      llmFetch(url, {
        method: 'POST',
        body: JSON.stringify({ model: 'x', messages: [] }),
      }),
    ).rejects.toThrow(/fixture not found/);
  });
});

describe('llm-fixture-fetch e2e', () => {
  let tempDir: string;
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tempDir = join(tmpdir(), `llm-fixture-e2e-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('LLMProviderService.generate returns recorded text without calling fetch', async () => {
    // Set up env like in other tests
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_TEXT_MODEL = 'test/model';
    delete process.env.OPENROUTER_FALLBACK_MODELS;

    const { LLMProviderService } = await import('../llm-provider-service.js');

    // Create a fixture for the request
    const url = 'https://openrouter.ai/api/v1/chat/completions';
    const requestBody = {
      model: 'test/model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 1000,
      temperature: 0.8,
      usage: { include: true },
      // #782 item 4: the provider path now sets this on every OpenRouter call.
      provider: { require_parameters: true },
    };
    const key = llmFixtureKey(url, requestBody);
    const fixturePath = join(tempDir, `${key}.json`);
    const fixture = {
      key,
      url,
      request: requestBody,
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: 'recorded response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    };
    writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));

    process.env.LLM_FIXTURE_DIR = tempDir;
    const mockFetch = vi.fn().mockImplementation(() => {
      throw new Error('fetch should not be called');
    });
    globalThis.fetch = mockFetch as any;

    const result = await LLMProviderService.generate({ prompt: 'hello' });

    expect(result.text).toBe('recorded response');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
