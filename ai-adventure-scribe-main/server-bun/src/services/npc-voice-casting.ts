import { Issue1784DataService } from './issue-1784-data-service.js';
import {
  IR_VOICES,
  canonicalIrVoice,
  normalizeSpeaker,
  pickNpcVoice,
  type CastingSegment,
  type CastSegment,
} from '../../../shared/npc-voices.js';
import { sql } from '../lib/db.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

type Npc = {
  id: string;
  name: string;
  voice_id: string | null;
  race: string | null;
  occupation: string | null;
  personality: string | null;
  description: string | null;
};
const playerLabels = new Set(['you', 'player', 'player character', 'pc']);

export async function castNpcVoices(
  sessionId: string,
  userId: string,
  segments: CastingSegment[],
): Promise<CastSegment[]> {
  await Issue1784DataService.assertSessionOwnership(sessionId, userId);
  return sql.begin(async (tx) => {
    const [scope] = await tx`SELECT campaign_id FROM game_sessions WHERE id = ${sessionId}`;
    if (!scope?.campaign_id) throw new NotFoundError('Campaign');
    const campaignId = String(scope.campaign_id);
    // Cross-session serialization covers provisional NPC creation and write-once casts.
    await tx`SELECT id FROM campaigns WHERE id = ${campaignId} FOR UPDATE`;
    const [session] = await tx`
      SELECT c.name AS player_name FROM game_sessions gs
      LEFT JOIN characters c ON c.id = gs.character_id WHERE gs.id = ${sessionId}
    `;
    const [scene] =
      await tx`SELECT id FROM scenes WHERE campaign_id = ${campaignId} AND is_active ORDER BY updated_at DESC, id LIMIT 1`;
    // The header description changes after every reply. Only the active scene ID is
    // a scene boundary; without one, conservatively reserve voices for this session.
    const sceneKey = scene?.id ? `scene:${scene.id}` : `session:${sessionId}`;
    const npcs = await tx<
      Npc[]
    >`SELECT id, name, voice_id, race, occupation, personality, description FROM npcs WHERE campaign_id = ${campaignId} ORDER BY id`;
    const configKey = `npc-voice-scene:${sceneKey}`;
    const previous = await tx`
      SELECT sc.config_value->'npc_ids' AS npc_ids FROM session_config sc
      JOIN game_sessions gs ON gs.id = sc.session_id
      WHERE gs.campaign_id = ${campaignId} AND sc.config_key = ${configKey}
    `;
    const sceneNpcIds = new Set<string>(
      previous.flatMap((row) => (Array.isArray(row.npc_ids) ? row.npc_ids.map(String) : [])),
    );
    const resolved: Array<Npc | null> = [];
    const muted = new Set<number>();
    const ambiguous = new Set<number>();
    for (const [index, segment] of segments.entries()) {
      if (segment.type !== 'character') {
        resolved.push(null);
        continue;
      }
      const name = segment.character?.trim() || 'Unknown NPC';
      const normalized = normalizeSpeaker(name);
      if (
        playerLabels.has(normalized) ||
        (session.player_name && normalized === normalizeSpeaker(String(session.player_name)))
      ) {
        resolved.push(null);
        muted.add(index);
        continue;
      }
      let npc: Npc | undefined;
      if (segment.npc_id) {
        npc = npcs.find((row) => row.id === segment.npc_id);
        if (!npc) throw new NotFoundError('NPC', segment.npc_id);
      } else {
        const matches = npcs.filter((row) => normalizeSpeaker(row.name) === normalized);
        if (matches.length > 1) {
          // Without an NPC id the line cannot be attributed; it keeps its category voice.
          logger.warn({ msg: 'NPC_VOICE_AMBIGUOUS_SPEAKER', session_id: sessionId, index });
          resolved.push(null);
          ambiguous.add(index);
          continue;
        }
        npc = matches[0];
      }
      if (!npc) {
        const [created] = await tx<Npc[]>`
          INSERT INTO npcs (campaign_id, name, description)
          VALUES (${campaignId}, ${name}, 'Provisional NPC created from spoken dialogue')
          RETURNING id, name, voice_id, race, occupation, personality, description
        `;
        npc = created;
        npcs.push(npc);
      }
      sceneNpcIds.add(npc.id);
      resolved.push(npc);
    }
    // Reserve returning speakers first, even if their line follows a new speaker's line.
    const sceneNpcs = npcs.filter((npc) => sceneNpcIds.has(npc.id));
    const used = new Set<string>();
    for (const npc of sceneNpcs) {
      if (!npc.voice_id) continue;
      const canonical = canonicalIrVoice(npc.voice_id);
      if (!canonical || canonical === 'narrator')
        throw new ConflictError(
          'NPC has an incompatible locked voice; explicit voice repair is required',
        );
      npc.voice_id = canonical;
      if (used.has(npc.voice_id))
        throw new ConflictError(
          'Scene NPCs have conflicting locked voices; explicit voice repair is required',
        );
      used.add(npc.voice_id);
    }
    const legacy = await tx`
      SELECT m.character_name, m.voice_id FROM character_voice_mappings m
      JOIN game_sessions gs ON gs.id = m.session_id WHERE gs.campaign_id = ${campaignId}
      ORDER BY (gs.id = ${sessionId}) DESC, m.created_at NULLS LAST, m.id
    `;
    for (const npc of sceneNpcs.sort((a, b) => a.id.localeCompare(b.id))) {
      if (npc.voice_id) continue;
      const hint = segments.find((_, index) => resolved[index]?.id === npc.id)?.voice_category;
      const traits = [npc.race, npc.occupation, npc.personality, npc.description, hint]
        .filter(Boolean)
        .join(' ');
      const saved = legacy.find(
        (row) => normalizeSpeaker(String(row.character_name)) === normalizeSpeaker(npc.name),
      );
      const fallback =
        saved &&
        Object.entries(IR_VOICES).find(
          ([id, voice]) =>
            id !== 'narrator' &&
            !used.has(id) &&
            (id === saved.voice_id || voice.premium === saved.voice_id),
        )?.[0];
      const voiceId = fallback || pickNpcVoice(campaignId, npc.id, traits, used);
      if (!voiceId)
        throw new ConflictError('Scene voice pool exhausted; no unique voice is available');
      await tx`UPDATE npcs SET voice_id = ${voiceId}, updated_at = now() WHERE id = ${npc.id} AND voice_id IS NULL`;
      npc.voice_id = voiceId;
      used.add(voiceId);
    }
    // Keep every scene's reservation in server-owned config rows. Ordinary session
    // PATCHes replace session_state, and must not erase casts or earlier scenes.
    const occupancy = tx.json({ npc_ids: [...sceneNpcIds] });
    await tx`
      INSERT INTO session_config (session_id, config_key, config_value)
      VALUES (${sessionId}, ${configKey}, ${occupancy})
      ON CONFLICT (session_id, config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = now()
    `;
    return segments.map((segment, index) => ({
      ...segment,
      character: resolved[index]?.name ?? segment.character,
      npc_id: resolved[index]?.id ?? null,
      voice_id:
        muted.has(index) || ambiguous.has(index) ? null : (resolved[index]?.voice_id ?? 'narrator'),
      voice_muted: muted.has(index),
    }));
  });
}
