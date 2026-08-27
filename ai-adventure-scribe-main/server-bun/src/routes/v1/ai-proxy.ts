import { Elysia, t } from 'elysia';

import { EMBEDDING_MAX_INPUT_CHARS } from '../../../../shared/embedding-limits.js';
import { authenticateRequest } from '../../lib/auth.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { AIUsageService } from '../../services/ai-usage-service.js';
import { EmbeddingError, generateEmbedding } from '../../services/embedding-service.js';

export const aiProxyRoutes = new Elysia({ prefix: '/v1/ai-proxy' }).use(planRateLimit('llm')).post(
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
);
