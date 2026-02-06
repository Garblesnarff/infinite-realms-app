/**
 * Image Generation Routes for Elysia
 *
 * Provides image generation API endpoints:
 * - GET /v1/images/quota - Get current quota status
 * - POST /v1/images/generate - Generate image via OpenRouter
 * - PATCH /v1/images/message/:id/images - Append image to message
 *
 * Ported from /server/src/routes/v1/images.ts
 */

import { Elysia, t } from 'elysia';
import { authenticateRequest } from '../../lib/auth.js';
import { AIUsageService } from '../../services/ai-usage-service.js';
import { getCircuitBreaker, CircuitOpenError } from '../../utils/circuit-breaker.js';
import { logger } from '../../lib/logger.js';
import { sql } from '../../lib/db.js';

/**
 * Helper to find URL-like string
 */
const firstUrlLike = (val: any): string | null => {
  if (!val) return null;
  if (typeof val === 'string' && /^https?:\/\//i.test(val)) return val;
  if (typeof val === 'object' && typeof val.url === 'string') return val.url;
  return null;
};

/**
 * Helper to find data URI
 */
const firstDataUriLike = (val: any): string | null => {
  if (typeof val === 'string' && val.startsWith('data:image/')) return val;
  return null;
};

/**
 * Extract image from OpenRouter response message
 */
const extractFromMessage = (msg: any): string | null => {
  if (!msg) return null;

  // If array, try each
  if (Array.isArray(msg)) {
    for (const it of msg) {
      const nested = extractFromMessage(it);
      if (nested) return nested;
    }
  }

  // images array
  if (Array.isArray(msg?.images)) {
    for (const it of msg.images) {
      const u = firstUrlLike(it?.image_url) || firstUrlLike(it?.url) || firstDataUriLike(it?.image) || firstDataUriLike(it?.data);
      if (u) return u;
    }
  }

  // content array
  if (Array.isArray(msg?.content)) {
    for (const p of msg.content) {
      if (p && typeof p === 'object') {
        if (['image', 'image_url', 'output_image'].includes(String(p.type || '').toLowerCase())) {
          const u = firstUrlLike(p?.image_url) || firstUrlLike(p?.url) || firstDataUriLike(p?.image) || firstDataUriLike(p?.data);
          if (u) return u;
        }
        const nested = extractFromMessage(p);
        if (nested) return nested;
      } else if (typeof p === 'string') {
        const d = firstDataUriLike(p);
        if (d) return d;
        const m = p.match(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif)/i);
        if (m) return m[0];
      }
    }
  }

  // string content
  if (typeof msg?.content === 'string') {
    const d = firstDataUriLike(msg.content);
    if (d) return d;
    const m = msg.content.match(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif)/i);
    if (m) return m[0];
  }

  // simple fields
  const simple = firstUrlLike(msg?.image_url) || firstDataUriLike(msg?.image) || firstUrlLike(msg?.url);
  if (simple) return simple;

  // tool calls / attachments / nested
  if (Array.isArray(msg?.tool_calls)) {
    for (const tc of msg.tool_calls) {
      const nested = extractFromMessage(tc);
      if (nested) return nested;
    }
  }
  if (Array.isArray(msg?.attachments)) {
    for (const a of msg.attachments) {
      const nested = extractFromMessage(a);
      if (nested) return nested;
    }
  }

  return null;
};

export const imageRoutes = new Elysia({ prefix: '/v1/images' })

  /**
   * Get image quota status
   * GET /v1/images/quota
   */
  .get('/quota', async ({ request, set }) => {
    // Direct auth check - bypasses Elysia plugin context issues
    const { user, error } = await authenticateRequest(request);
    if (error || !user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }

    try {
      const quotaStatus = await AIUsageService.getQuotaStatus({ userId: user.userId, plan: user.plan, type: 'image' });
      return quotaStatus;
    } catch (err) {
      logger.error({ msg: 'IMAGE_QUOTA_ERROR', error: err });
      set.status = 500;
      return { error: 'Failed to fetch quota status' };
    }
  })

  /**
   * Generate image via OpenRouter
   * POST /v1/images/generate
   */
  .post(
    '/generate',
    async ({ request, body, set }) => {
      // Direct auth check - bypasses Elysia plugin context issues
      const { user, error: authError } = await authenticateRequest(request);
      if (authError || !user) {
        set.status = 401;
        return { error: authError || 'Unauthorized' };
      }

      const { prompt, referenceImages, model, quality } = body || {};

      if (!prompt || typeof prompt !== 'string') {
        set.status = 400;
        return { error: 'Missing prompt' };
      }

      const userId = user.userId;
      const plan = user.plan;

      // Quota check
      const quota = await AIUsageService.checkQuotaAndConsume({ userId, plan, type: 'image', units: 1 });
      if (!quota.allowed) {
        set.status = 402;
        set.headers['Retry-After'] = String(Math.max(1, Math.ceil((new Date(quota.resetAt).getTime() - Date.now()) / 1000)));
        return { error: 'AI quota exceeded', remaining: quota.remaining, resetAt: quota.resetAt };
      }

      try {
        const breaker = getCircuitBreaker('images:openrouter');
        try {
          breaker.allowOrThrow();
        } catch (e) {
          if (e instanceof CircuitOpenError) {
            set.status = 503;
            set.headers['Retry-After'] = String(Math.max(1, e.retryAfterSec));
            return { error: 'Provider temporarily unavailable' };
          }
          throw e;
        }

        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
          set.status = 500;
          return { error: 'Server not configured for image generation' };
        }

        // If caller passed an OpenAI image model, pick a valid OpenRouter image-capable default instead
        const isOpenAIModel = typeof model === 'string' && /^gpt-image/i.test(model);
        const imageModel = (!model || isOpenAIModel)
          ? (process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image')
          : model;

        // Build message content based on whether we have reference images
        let content: any = prompt;
        if (referenceImages && Array.isArray(referenceImages) && referenceImages.length > 0) {
          content = [
            { type: 'text', text: prompt },
            ...referenceImages.map((img: string) => ({
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${img}` }
            }))
          ];
        }

        const reqBody = {
          model: imageModel,
          messages: [{ role: 'user', content }],
          modalities: ['image', 'text'],
          max_tokens: 2048,
          temperature: 0.7,
        } as any;

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.APP_ORIGIN || 'http://localhost:3000',
            'X-Title': 'AI Adventure Scribe',
          },
          body: JSON.stringify(reqBody),
        });

        if (!response.ok) {
          const errText = await response.text();
          const status = response.status;
          logger.error({ msg: 'IMAGE_OPENROUTER_ERROR', status, errText });
          breaker.onFailure();
          set.status = status;
          return { error: 'Image request failed', details: errText };
        }

        breaker.onSuccess();

        // OpenRouter image-capable chat completion response (robust extraction)
        type ORImageResp = { choices?: { message?: any }[]; [k: string]: any };
        const data = (await response.json()) as ORImageResp;

        const choice = data.choices?.[0];
        let imageRef = extractFromMessage(choice?.message) || extractFromMessage(data);

        if (!imageRef) {
          logger.warn({ msg: 'IMAGE_NO_DATA', details: 'OpenRouter parsing found no image fields' });
          set.status = 502;
          return { error: 'No image data in provider response' };
        }

        // Normalize to base64
        if (imageRef.startsWith('data:image/')) {
          const idx = imageRef.indexOf('base64,');
          const base64 = idx !== -1 ? imageRef.substring(idx + 7) : '';
          return { image: base64 };
        }

        // Otherwise assume remote URL; fetch and convert
        try {
          const r2 = await fetch(imageRef);
          if (!r2.ok) {
            logger.warn({ msg: 'IMAGE_FETCH_FAILED', url: imageRef, status: r2.status });
            set.status = 502;
            return { error: 'Failed to fetch image from provider' };
          }
          const buf = Buffer.from(await r2.arrayBuffer());
          return { image: buf.toString('base64') };
        } catch (fetchErr) {
          logger.error({ msg: 'IMAGE_FETCH_ERROR', url: imageRef, error: fetchErr });
          set.status = 502;
          return { error: 'Error retrieving image from provider' };
        }
      } catch (e) {
        logger.error({ msg: 'IMAGE_ERROR', error: e });
        if (e instanceof CircuitOpenError) {
          set.status = 503;
          set.headers['Retry-After'] = String(Math.max(1, e.retryAfterSec));
          return { error: 'Provider temporarily unavailable' };
        }
        set.status = 500;
        return { error: 'Image generation failed' };
      }
    },
    {
      body: t.Object({
        prompt: t.String(),
        model: t.Optional(t.String()),
        referenceImages: t.Optional(t.Array(t.String())),
        quality: t.Optional(t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high')])),
      }),
    }
  )

  /**
   * Append a generated image record to a dialogue_history message
   * PATCH /v1/images/message/:id/images
   */
  .patch(
    '/message/:id/images',
    async ({ request, params, body, set }) => {
      // Direct auth check - bypasses Elysia plugin context issues
      const { user, error: authError } = await authenticateRequest(request);
      if (authError || !user) {
        set.status = 401;
        return { error: authError || 'Unauthorized' };
      }

      const { id } = params;
      const userId = user.userId;

      const image = {
        url: String(body?.url || ''),
        prompt: typeof body?.prompt === 'string' ? body.prompt : undefined,
        model: typeof body?.model === 'string' ? body.model : undefined,
        quality: typeof body?.quality === 'string' ? body.quality : undefined,
        createdAt: new Date().toISOString(),
      } as any;

      if (!id || !image.url) {
        set.status = 400;
        return { error: 'Missing id or image url' };
      }

      try {
        logger.info({ msg: 'IMAGE_PATCH_START', messageId: id, userId });

        // Step 1: Fetch message only
        const existing = await sql`
          SELECT id, images, session_id
          FROM dialogue_history
          WHERE id = ${id}
          LIMIT 1
        `;

        if (!existing || existing.length === 0) {
          logger.error({ msg: 'IMAGE_PATCH_NOT_FOUND', messageId: id });
          set.status = 404;
          return { error: 'Message not found' };
        }

        const message = existing[0];
        logger.info({ msg: 'IMAGE_PATCH_FOUND', sessionId: message.session_id });

        // Step 2: Verify ownership through session (if session exists)
        if (message.session_id) {
          const sessionData = await sql`
            SELECT
              gs.campaign_id,
              gs.character_id,
              c.user_id as campaign_owner,
              ch.user_id as character_owner
            FROM game_sessions gs
            LEFT JOIN campaigns c ON c.id = gs.campaign_id
            LEFT JOIN characters ch ON ch.id = gs.character_id
            WHERE gs.id = ${message.session_id}
            LIMIT 1
          `;

          if (sessionData && sessionData.length > 0) {
            const session = sessionData[0];
            if (session.campaign_owner !== userId && session.character_owner !== userId) {
              logger.warn({ msg: 'IMAGE_PATCH_ACCESS_DENIED', userId });
              set.status = 404;
              return { error: 'Message not found' };
            }
            logger.info({ msg: 'IMAGE_PATCH_OWNERSHIP_VERIFIED' });
          } else {
            logger.warn({ msg: 'IMAGE_PATCH_SESSION_NOT_FOUND' });
            set.status = 404;
            return { error: 'Message not found' };
          }
        }

        // Prepare updated images array (max 5)
        const currentImages = Array.isArray(message.images) ? message.images : [];
        const updated = [...currentImages, image].slice(-5);

        // Update the message
        const result = await sql`
          UPDATE dialogue_history
          SET images = ${JSON.stringify(updated)}::jsonb, updated_at = NOW()
          WHERE id = ${id}
          RETURNING images
        `;

        logger.info({ msg: 'IMAGE_PATCH_SUCCESS' });
        return { images: result[0]?.images || [] };
      } catch (e) {
        logger.error({ msg: 'IMAGE_PATCH_ERROR', error: e });
        set.status = 500;
        return { error: 'Failed to append image' };
      }
    },
    {
      body: t.Object({
        url: t.String(),
        prompt: t.Optional(t.String()),
        model: t.Optional(t.String()),
        quality: t.Optional(t.String()),
      }),
    }
  );
