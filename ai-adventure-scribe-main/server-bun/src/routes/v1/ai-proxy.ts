import { Elysia, t } from 'elysia';

import { EMBEDDING_MAX_INPUT_CHARS } from '../../../../shared/embedding-limits.js';
import { authenticateRequest } from '../../lib/auth.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { AIUsageService } from '../../services/ai-usage-service.js';
import { EmbeddingError, generateEmbedding } from '../../services/embedding-service.js';

const VOICE_TIMEOUT_MS = 120_000;

export const aiProxyRoutes = new Elysia({ prefix: '/v1/ai-proxy' })
  .use(planRateLimit('llm'))
  .post(
    '/embeddings',
    async ({ request, body, set }) => {
      const { user, error } = await authenticateRequest(request);
      if (error || !user) {
        set.status = 401;
        return { error: error || 'Unauthorized' };
      }
      const quota = await AIUsageService.checkQuotaAndConsume({
        userId: user.userId,
        plan: user.plan,
        type: 'llm_system',
      });
      if (!quota.allowed) {
        set.status = 429;
        return { error: 'AI quota exceeded' };
      }
      // Generation moved to services/embedding-service.ts (#1822) so the memory write path
      // can embed in-process instead of calling this endpoint. Auth, quota and the exact
      // status codes below are unchanged; the route is now the HTTP face of that function.
      try {
        return { embedding: await generateEmbedding(body.text, 'RETRIEVAL_QUERY') };
      } catch (embeddingError) {
        if (embeddingError instanceof EmbeddingError) {
          set.status = embeddingError.status;
          return { error: embeddingError.message };
        }
        throw embeddingError;
      }
    },
    { body: t.Object({ text: t.String({ minLength: 1, maxLength: EMBEDDING_MAX_INPUT_CHARS }) }) },
  )
  .post(
    '/voice/:voiceId',
    async ({ request, params, body, set }) => {
      const { user, error } = await authenticateRequest(request);
      if (error || !user) {
        set.status = 401;
        return { error: error || 'Unauthorized' };
      }
      const quota = await AIUsageService.checkQuotaAndConsume({
        userId: user.userId,
        plan: user.plan,
        type: 'voice',
      });
      if (!quota.allowed) {
        set.status = 429;
        return { error: 'Voice quota exceeded' };
      }
      const apiKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;
      if (!apiKey) {
        set.status = 503;
        return { error: 'Voice service unavailable' };
      }
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(params.voiceId)}/stream`,
        {
          method: 'POST',
          headers: {
            Accept: 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
          },
          signal: AbortSignal.timeout(VOICE_TIMEOUT_MS),
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        set.status = response.status >= 500 ? 503 : 502;
        return { error: 'Voice request failed' };
      }
      return new Response(response.body, {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=3600' },
      });
    },
    {
      body: t.Object({
        text: t.String({ minLength: 1, maxLength: 5000 }),
        model_id: t.Optional(t.String()),
        voice_settings: t.Optional(t.Record(t.String(), t.Number())),
      }),
    },
  );
