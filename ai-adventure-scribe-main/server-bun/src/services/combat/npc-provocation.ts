import { and, eq } from 'drizzle-orm';

import { recordDmTacticalFact } from './tactical-action-service.js';
import { db } from '../../../../db/client';
import { combatParticipants, sessionCompanions } from '../../../../db/schema/index';
import { combatLogger, logger } from '../../lib/logger.js';

const PROVOKE_LINE = (name: string) => `⚙️ Engine: ${name} turns hostile.`;

type ParticipantLike = {
  id: string;
  name?: string | null;
  participantType?: string | null;
  characterId?: string | null;
  encounter?: { sessionId?: string | null } | null;
  sessionId?: string | null;
};

type ProvocationInput = {
  encounterId: string;
  source: ParticipantLike;
  target: ParticipantLike;
  damage: number;
};

const normalizedType = (participant: ParticipantLike): string =>
  participant.participantType?.trim().toLowerCase() ?? '';

const isExplicitAlly = (participant: ParticipantLike): boolean =>
  new Set(['ally', 'companion']).has(normalizedType(participant));

async function isPartyCompanion(participant: ParticipantLike): Promise<boolean> {
  const sessionId = participant.encounter?.sessionId ?? participant.sessionId;
  if (!sessionId || !participant.characterId) return false;

  const [companion] = await db
    .select({ id: sessionCompanions.id })
    .from(sessionCompanions)
    .where(
      and(
        eq(sessionCompanions.sessionId, sessionId),
        eq(sessionCompanions.characterId, participant.characterId),
        eq(sessionCompanions.status, 'active'),
      ),
    )
    .limit(1);
  return Boolean(companion);
}

function isPlayerSource(participant: ParticipantLike): boolean {
  return normalizedType(participant) === 'player';
}

function shouldIgnoreAsAlly(participant: ParticipantLike, partyCompanion: boolean): boolean {
  return isExplicitAlly(participant) || partyCompanion;
}

function logIgnoredAlly({
  encounterId,
  participant,
  sourceParticipantId,
}: {
  encounterId: string;
  participant: ParticipantLike;
  sourceParticipantId: string;
}): void {
  combatLogger.info({
    msg: 'NPC_PROVOKE_IGNORED_ALLY',
    encounterId,
    participantId: participant.id,
    participantName: participant.name ?? participant.id,
    sourceParticipantId,
  });
}

/**
 * Record the encounter-only disposition change caused by player damage.
 *
 * The guarded UPDATE is both the state transition and the idempotency gate: concurrent hits can
 * never produce two hostility lines. The caller has already authenticated and resolved both
 * participants through the attack path, so this helper only scopes the write to the encounter.
 */
export async function markPlayerDamageProvocation({
  encounterId,
  source,
  target,
  damage,
}: ProvocationInput): Promise<string[]> {
  if (damage <= 0 || !isPlayerSource(source)) return [];

  const sourcePartyCompanion = await isPartyCompanion(source);
  if (sourcePartyCompanion) {
    logIgnoredAlly({
      encounterId,
      participant: source,
      sourceParticipantId: source.id,
    });
    return [];
  }

  const partyCompanion =
    normalizedType(target) === 'player' ? await isPartyCompanion(target) : false;
  if (shouldIgnoreAsAlly(target, partyCompanion)) {
    logIgnoredAlly({
      encounterId,
      participant: target,
      sourceParticipantId: source.id,
    });
    return [];
  }

  // A player character is not an NPC whose disposition can flip. This also keeps friendly-fire
  // between ordinary player participants from being reported as an NPC transition.
  if (normalizedType(target) === 'player') return [];

  const [updated] = await db
    .update(combatParticipants)
    .set({ provoked: true, updatedAt: new Date() })
    .where(
      and(
        eq(combatParticipants.id, target.id),
        eq(combatParticipants.encounterId, encounterId),
        eq(combatParticipants.provoked, false),
      ),
    )
    .returning({ id: combatParticipants.id });

  if (!updated) return [];

  const line = PROVOKE_LINE(target.name ?? target.id);
  const sessionId = target.encounter?.sessionId ?? target.sessionId;
  if (sessionId) {
    try {
      await recordDmTacticalFact(sessionId, line);
    } catch (error) {
      // The state transition is authoritative. A missing/closed tactical board must not turn a
      // successful hit into a failed attack, but it is still useful evidence for operators.
      logger.warn({
        msg: 'NPC_PROVOKE_TRANSCRIPT_WRITE_FAILED',
        encounterId,
        participantId: target.id,
        error,
      });
    }
  }
  return [line];
}
