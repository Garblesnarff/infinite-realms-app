/**
 * Proving test for #2664 step 1: every route deleted in this PR returns 404
 * through the real request pipeline app (createRequestPipelineApp).
 *
 * Deleted routes:
 * - POST /v1/llm/generate/stream (+ LLMProviderService.stream, client onStream)
 * - POST /v1/llm/extract (the LLMProviderService.extract method stays: the
 *   memory-extraction job calls it in-process)
 * - GET /v1/narrative-facts/history
 * - GET /v1/sessions/:id/messages/:messageId (+ SessionMessageService.messageExists)
 *
 * POST /v1/ai-proxy/embeddings is intentionally NOT asserted here: it was
 * mounted in app.ts (not in any of these routers), so a 404 through this
 * router-only app would pass on main too. Its proof is static: ai-proxy.ts
 * is deleted and app.ts no longer imports or mounts it (grep: 0 refs).
 */
import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'smoke-user', email: 'smoke@example.test', plan: 'free' },
    error: null,
  }),
}));
// session-messages.ts mounts requireAuth, which validates env at module load.
// The 404s below never reach a handler; the plugin is a no-op here.
mock.module('../../../middleware/auth.js', () => ({
  requireAuth: new Elysia({ name: 'test-require-auth' }),
}));
// The narrative-facts module imports the ledger service, which imports
// db/client (throws at module load without DATABASE_URL). The 404s below
// never reach a handler, but the import must not throw.
mock.module('../../../../../db/client', () => ({ db: {} }));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const { createNarrativeFactRoutes } = await import('../narrative-facts.js');
const { sessionMessageRoutes } = await import('../session-messages.js');

const app = createRequestPipelineApp()
  .use(llmRoutes)
  .use(createNarrativeFactRoutes({ ledger: {} as never }))
  .use(sessionMessageRoutes);

const request = (method: string, path: string, body?: unknown): Promise<Response> =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );

describe('#2664 step 1: deleted routes 404', () => {
  it('POST /v1/llm/generate/stream -> 404', async () => {
    const response = await request('POST', '/v1/llm/generate/stream', {
      prompt: 'hello',
      maxTokens: 100,
    });
    expect(response.status).toBe(404);
  });

  it('POST /v1/llm/extract -> 404', async () => {
    const response = await request('POST', '/v1/llm/extract', {
      prompt: 'extract memories',
      maxTokens: 1000,
    });
    expect(response.status).toBe(404);
  });

  it('GET /v1/narrative-facts/history -> 404', async () => {
    const response = await request(
      'GET',
      '/v1/narrative-facts/history?session_id=s1&subject_name=Goblin&predicate=allied_with',
    );
    expect(response.status).toBe(404);
  });

  it('GET /v1/sessions/:id/messages/:messageId -> 404', async () => {
    const response = await request('GET', '/v1/sessions/s1/messages/m1');
    expect(response.status).toBe(404);
  });

  it('the live neighbors still route (the deletions did not take the routers down)', async () => {
    // /v1/llm/generate exists but needs a valid body; a 422 proves the route
    // is still registered (not a 404).
    const generate = await request('POST', '/v1/llm/generate', { prompt: 42 });
    expect(generate.status).not.toBe(404);
    // /v1/sessions/:id/messages exists; GET is registered (auth/DB would be
    // next, but a 404 would mean the router itself broke).
    const list = await request('GET', '/v1/sessions/s1/messages');
    expect(list.status).not.toBe(404);
  });
});
