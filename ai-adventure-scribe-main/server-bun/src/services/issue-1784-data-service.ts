/* eslint-disable max-lines */
import { sql } from '../lib/db.js';
import { NotFoundError } from '../lib/errors.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CharacterEquipmentInput {
  id?: string;
  item_name: string;
  item_type?: string | null;
  quantity?: number | null;
  equipped?: boolean | null;
  is_magic?: boolean | null;
  magic_bonus?: number | null;
  magic_properties?: string | string[] | null;
  requires_attunement?: boolean | null;
  is_attuned?: boolean | null;
  attunement_requirements?: string | null;
  magic_item_type?: string | null;
  magic_item_rarity?: string | null;
  magic_effects?: unknown;
}

export interface CharacterEquipmentRow {
  id: string;
  character_id: string;
  item_name: string;
  item_type: string | null;
  quantity: number | null;
  equipped: boolean | null;
  is_magic: boolean | null;
  magic_bonus: number | null;
  magic_properties: string | null;
  requires_attunement: boolean | null;
  is_attuned: boolean | null;
  attunement_requirements: string | null;
  magic_item_type: string | null;
  magic_item_rarity: string | null;
  magic_effects: unknown;
  created_at: string | null;
  updated_at: string | null;
}

export interface VoiceMappingInput {
  character_name: string;
  voice_category?: string | null;
  voice_id: string;
  appearance_count?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface VoiceMappingRow {
  id: string;
  session_id: string;
  character_name: string;
  voice_id: string;
  voice_category: string | null;
  appearance_count: number | null;
  first_appearance: string | null;
  last_used: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface VoiceProfileInput {
  voice_style?: string;
  speech_patterns?: string[];
  vocabulary_level?: 'simple' | 'average' | 'advanced' | 'archaic';
  tone?: string;
  quirks?: string[];
  example_phrases?: string[];
  consistency_score?: number;
}

export interface VoiceProfileRow {
  id: string;
  character_id: string | null;
  voice_style: string | null;
  speech_patterns: string[] | null;
  vocabulary_level: string | null;
  tone: string | null;
  quirks: string[] | null;
  example_phrases: string[] | null;
  consistency_score: number | string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CharacterCreationMetricInput {
  flow?: 'legacy' | 'new';
  creation_method?: string | null;
  character_id?: string | null;
  time_to_create_seconds?: number | null;
  steps_completed?: number | null;
  ai_suggestions_used?: number | null;
  manual_edits?: number | null;
  template_used?: string | null;
  completed?: boolean | null;
  abandoned_at_step?: string | null;
}

export interface SafetyAuditInput {
  action_type?: string;
  event_type?: string;
  triggered_by?: string;
  trigger_word?: string | null;
  player_message?: string | null;
  ai_response?: string | null;
  context_snippet?: string | null;
  auto_triggered?: boolean;
  confidence_score?: number | null;
  system_response?: string | null;
  action_taken?: string | null;
  was_paused_before?: boolean | null;
  is_paused_after?: boolean | null;
  session_turn_number?: number | null;
  content_flagged?: string | null;
  filter_applied?: string | null;
  severity_level?: string | null;
  timestamp?: string | null;
}

export interface SessionConfigRow {
  id: string;
  session_id: string;
  config_key: string;
  config_value: Record<string, unknown> | null;
  content_filter_level: string | null;
  allow_violence: boolean | null;
  allow_romance: boolean | null;
  allow_horror: boolean | null;
  custom_boundaries: string[] | null;
  created_at: string | null;
  updated_at: string | null;
}

const selectEquipment = sql`
  SELECT
    id,
    character_id,
    item_name,
    item_type,
    quantity,
    equipped,
    is_magic,
    magic_bonus,
    magic_properties,
    requires_attunement,
    is_attuned,
    attunement_requirements,
    magic_item_type,
    magic_item_rarity,
    magic_effects,
    created_at,
    updated_at
  FROM public.character_equipment
`;

const selectVoiceMappingColumns = sql`
  SELECT
    id,
    session_id,
    character_name,
    voice_id,
    voice_category,
    appearance_count,
    first_appearance,
    last_used,
    metadata,
    created_at,
    updated_at
  FROM public.character_voice_mappings
`;

const selectVoiceProfileColumns = sql`
  SELECT
    id,
    character_id,
    voice_style,
    speech_patterns,
    vocabulary_level,
    tone,
    quirks,
    example_phrases,
    consistency_score,
    created_at,
    updated_at
  FROM public.character_voice_profiles
`;

const isUuid = (value: string | undefined): value is string =>
  Boolean(value && UUID_PATTERN.test(value));

const uuidOrNull = (value: string): string | null => (isUuid(value) ? value : null);

const jsonbValue = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value);
};

const equipmentTextValue = (value: string | string[] | null | undefined): string | null => {
  if (value === undefined || value === null) return null;
  return Array.isArray(value) ? JSON.stringify(value) : value;
};

export class Issue1784DataService {
  static async assertCharacterOwnership(characterId: string, userId: string): Promise<void> {
    const rows = await sql`
      SELECT user_id, owner_id
      FROM public.characters
      WHERE id = ${characterId}
      LIMIT 1
    `;
    const character = rows[0] as { user_id: string; owner_id: string | null } | undefined;
    if (!character || (character.user_id !== userId && character.owner_id !== userId)) {
      throw new NotFoundError('Character', characterId);
    }
  }

  static async assertSessionOwnership(sessionId: string, userId: string): Promise<void> {
    const rows = await sql`
      SELECT
        gs.id,
        COALESCE(
          c.user_id = ${userId}
          OR c.owner_id = ${userId}
          OR ca.user_id = ${userId},
          false
        ) AS owned
      FROM public.game_sessions AS gs
      LEFT JOIN public.characters AS c ON c.id = gs.character_id
      LEFT JOIN public.campaigns AS ca ON ca.id = gs.campaign_id
      WHERE gs.id = ${sessionId}
      LIMIT 1
    `;
    const session = rows[0] as { id: string; owned: boolean } | undefined;
    if (!session || !session.owned) throw new NotFoundError('Session', sessionId);
  }

  static async getCharacterEquipment(
    characterId: string,
    userId: string,
  ): Promise<CharacterEquipmentRow[]> {
    await this.assertCharacterOwnership(characterId, userId);
    const rows = await sql`
      ${selectEquipment}
      WHERE character_id = ${characterId}
      ORDER BY created_at NULLS LAST, id
    `;
    // postgres.js resolves to a RowList (an Array subclass). Elysia <= 1.4.22 does not
    // JSON-serialize a subclass and sends "[object Object]..." with status 200 (#2150).
    return [...rows] as unknown as CharacterEquipmentRow[];
  }

  static async upsertCharacterEquipment(
    characterId: string,
    userId: string,
    equipment: CharacterEquipmentInput[],
  ): Promise<CharacterEquipmentRow[]> {
    await this.assertCharacterOwnership(characterId, userId);

    await sql.begin(async (tx) => {
      for (const item of equipment) {
        const itemName = item.item_name.trim();
        const validItemId = isUuid(item.id);
        let existing = validItemId
          ? await tx`
              SELECT id
              FROM public.character_equipment
              WHERE id = ${item.id} AND character_id = ${characterId}
              LIMIT 1
            `
          : [];

        if (!existing[0]) {
          existing = await tx`
            SELECT id
            FROM public.character_equipment
            WHERE character_id = ${characterId} AND item_name = ${itemName}
            ORDER BY created_at NULLS LAST, id
            LIMIT 1
            FOR UPDATE
          `;
        }

        const itemType = item.item_type ?? 'equipment';
        const quantity = item.quantity == null ? 1 : Math.trunc(item.quantity);
        const equipped = item.equipped ?? false;
        const isMagic = item.is_magic ?? false;
        const magicBonus = item.magic_bonus == null ? 0 : Math.trunc(item.magic_bonus);
        const magicProperties = equipmentTextValue(item.magic_properties);
        const requiresAttunement = item.requires_attunement ?? false;
        const isAttuned = item.is_attuned ?? false;
        const magicEffects = jsonbValue(item.magic_effects);

        if (existing[0]) {
          await tx`
            UPDATE public.character_equipment
            SET
              item_name = ${itemName},
              item_type = ${itemType},
              quantity = ${quantity},
              equipped = ${equipped},
              is_magic = ${isMagic},
              magic_bonus = ${magicBonus},
              magic_properties = ${magicProperties},
              requires_attunement = ${requiresAttunement},
              is_attuned = ${isAttuned},
              attunement_requirements = ${item.attunement_requirements ?? null},
              magic_item_type = ${item.magic_item_type ?? null},
              magic_item_rarity = ${item.magic_item_rarity ?? 'common'},
              magic_effects = ${magicEffects}::jsonb,
              updated_at = now()
            WHERE id = ${existing[0].id} AND character_id = ${characterId}
          `;
        } else {
          await tx`
            INSERT INTO public.character_equipment (
              character_id,
              item_name,
              item_type,
              quantity,
              equipped,
              is_magic,
              magic_bonus,
              magic_properties,
              requires_attunement,
              is_attuned,
              attunement_requirements,
              magic_item_type,
              magic_item_rarity,
              magic_effects
            ) VALUES (
              ${characterId},
              ${itemName},
              ${itemType},
              ${quantity},
              ${equipped},
              ${isMagic},
              ${magicBonus},
              ${magicProperties},
              ${requiresAttunement},
              ${isAttuned},
              ${item.attunement_requirements ?? null},
              ${item.magic_item_type ?? null},
              ${item.magic_item_rarity ?? 'common'},
              ${magicEffects}::jsonb
            )
          `;
        }
      }
    });

    return this.getCharacterEquipment(characterId, userId);
  }

  static async getSessionMappings(sessionId: string, userId: string): Promise<VoiceMappingRow[]> {
    await this.assertSessionOwnership(sessionId, userId);
    const rows = await sql`
      ${selectVoiceMappingColumns}
      WHERE session_id = ${sessionId}
      ORDER BY created_at NULLS LAST, id
    `;
    // Plain array for the same reason as getCharacterEquipment (#2150).
    return [...rows] as unknown as VoiceMappingRow[];
  }

  static async upsertVoiceMapping(
    sessionId: string,
    userId: string,
    input: VoiceMappingInput,
  ): Promise<VoiceMappingRow> {
    await this.assertSessionOwnership(sessionId, userId);
    const characterName = input.character_name.trim();
    const voiceId = input.voice_id.trim();
    const row = await sql.begin(async (tx) => {
      const existing = await tx`
        SELECT id, voice_category, voice_id, appearance_count, metadata
        FROM public.character_voice_mappings
        WHERE session_id = ${sessionId} AND character_name = ${characterName}
        ORDER BY created_at NULLS LAST, id
        LIMIT 1
        FOR UPDATE
      `;

      let mappingId: string;
      if (existing[0]) {
        mappingId = String(existing[0].id);
        await tx`
          UPDATE public.character_voice_mappings
          SET
            voice_id = ${voiceId || existing[0].voice_id},
            voice_category = ${input.voice_category ?? existing[0].voice_category ?? null},
            appearance_count = ${input.appearance_count ?? existing[0].appearance_count ?? 1},
            metadata = ${JSON.stringify(input.metadata ?? existing[0].metadata ?? {})}::jsonb,
            last_used = now(),
            updated_at = now()
          WHERE id = ${mappingId} AND session_id = ${sessionId}
        `;
      } else {
        const inserted = await tx`
          INSERT INTO public.character_voice_mappings (
            session_id,
            character_name,
            voice_id,
            voice_category,
            appearance_count,
            first_appearance,
            last_used,
            metadata
          ) VALUES (
            ${sessionId},
            ${characterName},
            ${voiceId},
            ${input.voice_category ?? null},
            ${input.appearance_count ?? 1},
            now(),
            now(),
            ${JSON.stringify(input.metadata ?? {})}::jsonb
          )
          RETURNING id
        `;
        const insertedRow = inserted[0];
        if (!insertedRow) throw new Error('Voice mapping insert returned no row');
        mappingId = String(insertedRow.id);
      }

      const [updated] = await tx`
        ${selectVoiceMappingColumns}
        WHERE id = ${mappingId} AND session_id = ${sessionId}
        LIMIT 1
      `;
      return updated as unknown as VoiceMappingRow;
    });

    return row;
  }

  static async updateVoiceMapping(
    mappingId: string,
    userId: string,
    appearanceCount: number,
  ): Promise<VoiceMappingRow> {
    const rows = await sql`
      SELECT
        m.id,
        m.session_id,
        COALESCE(
          c.user_id = ${userId}
          OR c.owner_id = ${userId}
          OR ca.user_id = ${userId},
          false
        ) AS owned
      FROM public.character_voice_mappings AS m
      JOIN public.game_sessions AS gs ON gs.id = m.session_id
      LEFT JOIN public.characters AS c ON c.id = gs.character_id
      LEFT JOIN public.campaigns AS ca ON ca.id = gs.campaign_id
      WHERE m.id = ${mappingId}
      LIMIT 1
    `;
    const mapping = rows[0] as { id: string; session_id: string; owned: boolean } | undefined;
    if (!mapping || !mapping.owned) throw new NotFoundError('Voice mapping', mappingId);

    const [updated] = await sql`
      UPDATE public.character_voice_mappings AS m
      SET appearance_count = ${Math.trunc(appearanceCount)}, last_used = now(), updated_at = now()
      WHERE m.id = ${mappingId}
        AND EXISTS (
          SELECT 1
          FROM public.game_sessions AS gs
          LEFT JOIN public.characters AS c ON c.id = gs.character_id
          LEFT JOIN public.campaigns AS ca ON ca.id = gs.campaign_id
          WHERE gs.id = m.session_id
            AND (
              c.user_id = ${userId}
              OR c.owner_id = ${userId}
              OR ca.user_id = ${userId}
            )
        )
      RETURNING m.id, m.session_id, m.character_name, m.voice_id, m.voice_category,
        m.appearance_count, m.first_appearance, m.last_used, m.metadata, m.created_at, m.updated_at
    `;
    if (!updated) throw new NotFoundError('Voice mapping', mappingId);
    return updated as unknown as VoiceMappingRow;
  }

  static async getVoiceProfile(
    characterId: string,
    userId: string,
  ): Promise<VoiceProfileRow | null> {
    await this.assertCharacterOwnership(characterId, userId);
    const [row] = await sql`
      ${selectVoiceProfileColumns}
      WHERE character_id = ${characterId}
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
      LIMIT 1
    `;
    return (row as unknown as VoiceProfileRow | undefined) ?? null;
  }

  static async upsertVoiceProfile(
    characterId: string,
    userId: string,
    input: VoiceProfileInput,
  ): Promise<VoiceProfileRow> {
    await this.assertCharacterOwnership(characterId, userId);
    const values = {
      voiceStyle: input.voice_style ?? '',
      speechPatterns: input.speech_patterns ?? [],
      vocabularyLevel: input.vocabulary_level ?? 'average',
      tone: input.tone ?? '',
      quirks: input.quirks ?? [],
      examplePhrases: input.example_phrases ?? [],
      consistencyScore: Math.max(0, Math.min(1, input.consistency_score ?? 0)),
    };

    const [existing] = await sql`
      SELECT id
      FROM public.character_voice_profiles
      WHERE character_id = ${characterId}
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
      LIMIT 1
    `;

    if (existing) {
      const [updated] = await sql`
        UPDATE public.character_voice_profiles
        SET
          voice_style = ${values.voiceStyle},
          speech_patterns = ${values.speechPatterns},
          vocabulary_level = ${values.vocabularyLevel},
          tone = ${values.tone},
          quirks = ${values.quirks},
          example_phrases = ${values.examplePhrases},
          consistency_score = ${values.consistencyScore},
          updated_at = now()
        WHERE id = ${existing.id} AND character_id = ${characterId}
        RETURNING id, character_id, voice_style, speech_patterns, vocabulary_level, tone,
          quirks, example_phrases, consistency_score, created_at, updated_at
      `;
      return updated as unknown as VoiceProfileRow;
    }

    const [created] = await sql`
      INSERT INTO public.character_voice_profiles (
        character_id,
        voice_style,
        speech_patterns,
        vocabulary_level,
        tone,
        quirks,
        example_phrases,
        consistency_score
      ) VALUES (
        ${characterId},
        ${values.voiceStyle},
        ${values.speechPatterns},
        ${values.vocabularyLevel},
        ${values.tone},
        ${values.quirks},
        ${values.examplePhrases},
        ${values.consistencyScore}
      )
      RETURNING id, character_id, voice_style, speech_patterns, vocabulary_level, tone,
        quirks, example_phrases, consistency_score, created_at, updated_at
    `;
    return created as unknown as VoiceProfileRow;
  }

  static async recordCharacterCreationMetric(
    userId: string,
    input: CharacterCreationMetricInput,
  ): Promise<{ id: string }> {
    if (input.character_id) {
      await this.assertCharacterOwnership(input.character_id, userId);
    }

    const [created] = await sql`
      INSERT INTO public.character_creation_metrics (
        character_id,
        user_id,
        creation_method,
        time_to_create_seconds,
        steps_completed,
        ai_suggestions_used,
        manual_edits,
        template_used,
        completed,
        abandoned_at_step
      ) VALUES (
        ${input.character_id ?? null},
        ${uuidOrNull(userId)},
        ${input.creation_method ?? input.flow ?? null},
        ${input.time_to_create_seconds == null ? null : Math.trunc(input.time_to_create_seconds)},
        ${input.steps_completed == null ? null : Math.trunc(input.steps_completed)},
        ${input.ai_suggestions_used == null ? 0 : Math.trunc(input.ai_suggestions_used)},
        ${input.manual_edits == null ? 0 : Math.trunc(input.manual_edits)},
        ${input.template_used ?? null},
        ${input.completed ?? false},
        ${input.abandoned_at_step ?? null}
      )
      RETURNING id
    `;
    const createdRow = created[0];
    if (!createdRow) throw new Error('Character creation metric insert returned no row');
    return { id: String(createdRow.id) };
  }

  static async recordSafetyEvent(
    sessionId: string,
    userId: string,
    input: SafetyAuditInput,
  ): Promise<{ id: string }> {
    await this.assertSessionOwnership(sessionId, userId);

    const { user_id: _ignoredUserId, ...clientDetails } = input as SafetyAuditInput & {
      user_id?: unknown;
    };
    const actionDetails = {
      ...clientDetails,
      auth_user_id: userId,
    };
    const actionType = input.action_type || input.event_type || 'safety_event';

    const [created] = await sql`
      INSERT INTO public.safety_audit_trail (
        session_id,
        user_id,
        action_type,
        action_details,
        content_flagged,
        filter_applied,
        severity_level
      ) VALUES (
        ${sessionId},
        ${uuidOrNull(userId)},
        ${actionType},
        ${JSON.stringify(actionDetails)}::jsonb,
        ${input.content_flagged ?? input.trigger_word ?? null},
        ${input.filter_applied ?? input.action_taken ?? null},
        ${input.severity_level ?? (input.auto_triggered ? 'medium' : 'high')}
      )
      RETURNING id
    `;
    const createdRow = created[0];
    if (!createdRow) throw new Error('Safety audit insert returned no row');
    return { id: String(createdRow.id) };
  }

  static async getSessionConfig(
    sessionId: string,
    userId: string,
  ): Promise<SessionConfigRow | null> {
    await this.assertSessionOwnership(sessionId, userId);
    const [row] = await sql`
      SELECT
        id,
        session_id,
        config_key,
        config_value,
        content_filter_level,
        allow_violence,
        allow_romance,
        allow_horror,
        custom_boundaries,
        created_at,
        updated_at
      FROM public.session_config
      WHERE session_id = ${sessionId}
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
      LIMIT 1
    `;
    return (row as unknown as SessionConfigRow | undefined) ?? null;
  }
}
