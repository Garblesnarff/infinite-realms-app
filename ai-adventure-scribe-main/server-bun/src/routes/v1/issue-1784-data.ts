/* eslint-disable max-lines */
import { Elysia, t } from 'elysia';

import { mapAppRouteError } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import {
  Issue1784DataService,
  type CharacterCreationMetricInput,
  type SafetyAuditInput,
  type SessionConfigRow,
  type VoiceMappingInput,
  type VoiceProfileInput,
} from '../../services/issue-1784-data-service.js';

const resourceIdParams = t.Object({
  id: t.String({ minLength: 1, maxLength: 255 }),
});

const voiceMappingBody = t.Object({
  character_name: t.String({ minLength: 1, maxLength: 255 }),
  voice_category: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
  voice_id: t.String({ minLength: 1, maxLength: 255 }),
  appearance_count: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 1_000_000 }))),
  metadata: t.Optional(t.Nullable(t.Record(t.String(), t.Any()))),
});

const voiceMappingUpdateBody = t.Object({
  appearance_count: t.Number({ minimum: 0, maximum: 1_000_000 }),
});

const voiceProfileBody = t.Object({
  voice_style: t.Optional(t.String({ maxLength: 500 })),
  speech_patterns: t.Optional(t.Array(t.String({ maxLength: 500 }), { maxItems: 100 })),
  vocabulary_level: t.Optional(
    t.Union([
      t.Literal('simple'),
      t.Literal('average'),
      t.Literal('advanced'),
      t.Literal('archaic'),
    ]),
  ),
  tone: t.Optional(t.String({ maxLength: 500 })),
  quirks: t.Optional(t.Array(t.String({ maxLength: 500 }), { maxItems: 100 })),
  example_phrases: t.Optional(t.Array(t.String({ maxLength: 2_000 }), { maxItems: 100 })),
  consistency_score: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
});

const characterCreationMetricBody = t.Object({
  flow: t.Optional(t.Union([t.Literal('legacy'), t.Literal('new')])),
  creation_method: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
  character_id: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 255 }))),
  campaign_id: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 255 }))),
  time_to_create_seconds: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 10_000_000 }))),
  steps_completed: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 10_000 }))),
  ai_suggestions_used: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 10_000 }))),
  manual_edits: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 10_000 }))),
  template_used: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
  completed: t.Optional(t.Nullable(t.Boolean())),
  abandoned_at_step: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
});

const safetyEventBody = t.Object({
  action_type: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  event_type: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  triggered_by: t.Optional(t.String({ maxLength: 100 })),
  trigger_word: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
  player_message: t.Optional(t.Nullable(t.String({ maxLength: 1_000 }))),
  ai_response: t.Optional(t.Nullable(t.String({ maxLength: 1_000 }))),
  context_snippet: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
  auto_triggered: t.Optional(t.Boolean()),
  confidence_score: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 1 }))),
  system_response: t.Optional(t.Nullable(t.String({ maxLength: 1_000 }))),
  action_taken: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
  was_paused_before: t.Optional(t.Nullable(t.Boolean())),
  is_paused_after: t.Optional(t.Nullable(t.Boolean())),
  session_turn_number: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 10_000_000 }))),
  content_flagged: t.Optional(t.Nullable(t.String({ maxLength: 1_000 }))),
  filter_applied: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
  severity_level: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
  timestamp: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
});

const defaultSessionConfig = {
  x_card_enabled: true,
  veil_enabled: true,
  pause_enabled: true,
  auto_pause_on_trigger: true,
  custom_x_card_triggers: [] as string[],
  custom_veil_triggers: [] as string[],
  custom_pause_triggers: [] as string[],
  strict_mode_triggers: false,
  content_warnings: [] as string[],
  hard_boundaries: [] as string[],
  comfort_level: 'pg13' as const,
};

const asStringArray = (value: unknown, fallback: string[]): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : fallback;

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const asString = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

const mapSessionConfig = (
  sessionId: string,
  row: SessionConfigRow | null,
): Record<string, unknown> => {
  const value = row?.config_value || {};
  const boundaries = row?.custom_boundaries || [];

  return {
    ...defaultSessionConfig,
    ...(row || {}),
    session_id: sessionId,
    x_card_enabled: asBoolean(value.x_card_enabled, defaultSessionConfig.x_card_enabled),
    veil_enabled: asBoolean(value.veil_enabled, defaultSessionConfig.veil_enabled),
    pause_enabled: asBoolean(value.pause_enabled, defaultSessionConfig.pause_enabled),
    auto_pause_on_trigger: asBoolean(
      value.auto_pause_on_trigger,
      defaultSessionConfig.auto_pause_on_trigger,
    ),
    custom_x_card_triggers: asStringArray(
      value.custom_x_card_triggers,
      defaultSessionConfig.custom_x_card_triggers,
    ),
    custom_veil_triggers: asStringArray(
      value.custom_veil_triggers,
      defaultSessionConfig.custom_veil_triggers,
    ),
    custom_pause_triggers: asStringArray(
      value.custom_pause_triggers,
      defaultSessionConfig.custom_pause_triggers,
    ),
    strict_mode_triggers: asBoolean(
      value.strict_mode_triggers,
      defaultSessionConfig.strict_mode_triggers,
    ),
    content_warnings: asStringArray(value.content_warnings, defaultSessionConfig.content_warnings),
    hard_boundaries: asStringArray(value.hard_boundaries, boundaries),
    comfort_level: asString(value.comfort_level, row?.content_filter_level || 'pg13') as
      | 'pg'
      | 'pg13'
      | 'r'
      | 'custom',
  };
};

const handleRouteError = (set: { status?: unknown }, error: unknown, fallback: string) =>
  mapAppRouteError(set, error, fallback, [404], 'Not found', undefined, false, true);

/** Authenticated replacement paths for the six browser-facing legacy tables in #1784. */
export const issue1784DataRoutes = new Elysia({ name: 'issue-1784-data-routes' })
  .use(planRateLimit('default'))
  .use(requireAuth)
  .get(
    '/v1/characters/:id/equipment',
    async ({ params, user, set }) => {
      try {
        return await Issue1784DataService.getCharacterEquipment(params.id, user.userId);
      } catch (error) {
        return handleRouteError(set, error, 'Failed to fetch character equipment');
      }
    },
    { params: resourceIdParams },
  )
  .get(
    '/v1/characters/:id/voice-profile',
    async ({ params, user, set }) => {
      try {
        return await Issue1784DataService.getVoiceProfile(params.id, user.userId);
      } catch (error) {
        return handleRouteError(set, error, 'Failed to fetch voice profile');
      }
    },
    { params: resourceIdParams },
  )
  .put(
    '/v1/characters/:id/voice-profile',
    async ({ params, body, user, set }) => {
      try {
        return await Issue1784DataService.upsertVoiceProfile(
          params.id,
          user.userId,
          body as VoiceProfileInput,
        );
      } catch (error) {
        return handleRouteError(set, error, 'Failed to save voice profile');
      }
    },
    { params: resourceIdParams, body: voiceProfileBody },
  )
  .get(
    '/v1/sessions/:id/voice-mappings',
    async ({ params, user, set }) => {
      try {
        return await Issue1784DataService.getSessionMappings(params.id, user.userId);
      } catch (error) {
        return handleRouteError(set, error, 'Failed to fetch voice mappings');
      }
    },
    { params: resourceIdParams },
  )
  .post(
    '/v1/sessions/:id/voice-mappings',
    async ({ params, body, user, set }) => {
      try {
        return await Issue1784DataService.upsertVoiceMapping(
          params.id,
          user.userId,
          body as VoiceMappingInput,
        );
      } catch (error) {
        return handleRouteError(set, error, 'Failed to save voice mapping');
      }
    },
    { params: resourceIdParams, body: voiceMappingBody },
  )
  .patch(
    '/v1/voice-mappings/:id',
    async ({ params, body, user, set }) => {
      try {
        return await Issue1784DataService.updateVoiceMapping(
          params.id,
          user.userId,
          body.appearance_count,
        );
      } catch (error) {
        return handleRouteError(set, error, 'Failed to update voice mapping');
      }
    },
    { params: resourceIdParams, body: voiceMappingUpdateBody },
  )
  .post(
    '/v1/sessions/:id/safety-events',
    async ({ params, body, user, set }) => {
      try {
        const result = await Issue1784DataService.recordSafetyEvent(
          params.id,
          user.userId,
          body as SafetyAuditInput,
        );
        set.status = 201;
        return { ok: true, ...result };
      } catch (error) {
        return handleRouteError(set, error, 'Failed to record safety event');
      }
    },
    { params: resourceIdParams, body: safetyEventBody },
  )
  .get(
    '/v1/sessions/:id/config',
    async ({ params, user, set }) => {
      try {
        const row = await Issue1784DataService.getSessionConfig(params.id, user.userId);
        return mapSessionConfig(params.id, row);
      } catch (error) {
        return handleRouteError(set, error, 'Failed to fetch session config');
      }
    },
    { params: resourceIdParams },
  )
  .post(
    '/v1/telemetry/character-creation-flow',
    async ({ body, user, set }) => {
      try {
        await Issue1784DataService.recordCharacterCreationMetric(
          user.userId,
          body as CharacterCreationMetricInput,
        );
        set.status = 204;
        return new Response(null, { status: 204 });
      } catch (error) {
        return handleRouteError(set, error, 'Failed to record character creation flow');
      }
    },
    { body: characterCreationMetricBody },
  );
