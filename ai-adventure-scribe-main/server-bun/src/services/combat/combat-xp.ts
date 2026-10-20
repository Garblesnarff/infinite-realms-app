/**
 * #310: combat victory XP.
 *
 * Kills awarded nothing: the only XP writer was the story path (`xp_award` in the DM reply),
 * and in-combat turns skip it, so a won fight left the sheet untouched and the award (when the
 * model did emit one) arrived with no message. When an encounter concludes with the last
 * hostile defeated, each player character now earns XP (see combat-xp-mechanics.ts), and the
 * engine posts the award as a deterministic chat line, so the gain is always visible.
 *
 * Every player participant with a character row shares alike — 2014 divides among the party,
 * not the conscious.
 *
 * Idempotency: `concludeEncounter`'s terminal claim is the boundary — only the claimer calls
 * this. The encounter row is locked and `experience_awarded` is checked and set inside the
 * same transaction as the per-character writes, so a retry cannot double-award. The visible
 * notice is recoverable separately (see `ensureCombatVictoryXpNotice`): a transient notice
 * write failure never loses the award, and a retry re-posts the notice from the stored
 * award without awarding again.
 */

import { and, eq, like, sql } from 'drizzle-orm';

import { CombatEncounterService } from './combat-encounter-service.js';
import { combatVictoryXp } from './combat-xp-mechanics.js';
import { db } from '../../../../db/client';
import { combatEncounters } from '../../../../db/schema/combat';
import { characters, experienceEvents } from '../../../../db/schema/index';
import { alert } from '../../lib/alerting.js';
import { logger } from '../../lib/logger.js';
import {
  engineChatLineExists,
  postEngineChatLine,
  type EngineChatLineWriter,
} from '../engine-chat-line.js';

export interface CombatXpAward {
  characterId: string;
  name: string;
  xp: number;
}

/**
 * Awards victory XP for a concluded encounter. Never throws: a failed write must not break
 * combat conclusion — it logs and alerts, and the strategist sees the gap in the report.
 *
 * The visible notice is ensured on every call (see `ensureCombatVictoryXpNotice`), so a
 * retry re-posts a lost notice from the stored award without awarding again.
 */
export async function awardCombatVictoryXp(
  input: {
    encounterId: string;
    sessionId: string;
    userId: string;
  },
  deps: { noticeWriter?: EngineChatLineWriter; postNotice?: boolean } = {},
): Promise<{ awarded: CombatXpAward[]; defeatedNames: string[] }> {
  const { encounterId, sessionId, userId } = input;
  try {
    const state = await CombatEncounterService.getCombatState(encounterId, userId);
    const playerIds = [
      ...new Set(
        state.participants
          .filter((p) => p.participantType === 'player' && p.characterId)
          .map((p) => p.characterId as string),
      ),
    ];
    if (!playerIds.length) return { awarded: [], defeatedNames: [] };
    // #310: victory XP requires enemies to have been defeated. An encounter that never
    // seated monsters (e.g. the end-check running before monsters arrive, or a malformed
    // encounter) is not a victory — awarding here is what put +25/+50/+75 on the sheet
    // the moment combat started, with no message. 'monster' is the hostile seat:
    // 'npc' seats are allies/bystanders and must not count (aligns with #425).
    const hostileCount = state.participants.filter((p) => p.participantType === 'monster').length;
    if (!hostileCount) return { awarded: [], defeatedNames: [] };
    // Hostiles are the 'monster' seats: 'npc' seats are allies/bystanders and must not
    // count toward the award or force the threshold fallback (their xp_value is NULL).
    const defeatedNames = state.participants
      .filter((p) => p.participantType === 'monster')
      .map((p) => p.name)
      .filter(Boolean);

    // #374: the exact 2014 award. Every defeated hostile's XP was persisted at seating;
    // when all of them carry one, the award is the sum split evenly among the player
    // characters — no encounter multiplier for awards (2014). Any NULL falls back to
    // the difficulty-threshold method below, with a log naming the gap.
    const defeatedHostiles = state.participants.filter(
      (p) => p.participantType === 'monster',
    );
    const seatedXp = defeatedHostiles.map((p) => p.xpValue ?? null);
    const missingXpCount = seatedXp.filter((v) => v == null).length;
    const exactTotal =
      defeatedHostiles.length > 0 && missingXpCount === 0
        ? seatedXp.reduce<number>((sum, v) => sum + (v ?? 0), 0)
        : null;
    if (missingXpCount > 0) {
      logger.info({
        msg: 'COMBAT_XP_FALLBACK',
        encounterId,
        sessionId,
        defeatedHostiles: defeatedHostiles.length,
        missingXpCount,
      });
    }

    const awarded = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({
          id: combatEncounters.id,
          difficulty: combatEncounters.difficulty,
          experienceAwarded: combatEncounters.experienceAwarded,
        })
        .from(combatEncounters)
        .where(eq(combatEncounters.id, encounterId))
        .for('update');
      if (!locked || locked.experienceAwarded != null) return [];
      const rows = await tx
        .select({ id: characters.id, name: characters.name, level: characters.level })
        .from(characters)
        .where(
          sql`${characters.id} IN (${sql.join(
            playerIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );
      const awards: CombatXpAward[] = [];
      for (const row of rows) {
        // #374: exact split of the seated-XP sum (floored: XP is integral); the threshold
        // method is the fallback when any defeated hostile lacks a seated value.
        const xp =
          exactTotal != null
            ? Math.floor(exactTotal / playerIds.length)
            : combatVictoryXp(row.level ?? 1, locked.difficulty);
        if (xp <= 0) continue;
        await tx
          .update(characters)
          .set({
            experiencePoints: sql`coalesce(${characters.experiencePoints}, 0) + ${xp}`,
            updatedAt: new Date(),
          })
          .where(eq(characters.id, row.id));
        await tx.insert(experienceEvents).values({
          characterId: row.id,
          sessionId,
          xpGained: xp,
          source: 'combat',
          // Encounter-scoped so a notice retry can re-read THIS victory's award
          // (`readStoredVictoryAward`) without re-awarding to repair the message.
          description: `Victory XP [${encounterId}]: ${defeatedNames.slice(0, 5).join(', ') || 'the encounter'}`,
        });
        awards.push({ characterId: row.id, name: row.name ?? 'the party', xp });
      }
      const total = awards.reduce((sum, a) => sum + a.xp, 0);
      await tx
        .update(combatEncounters)
        .set({ experienceAwarded: total, updatedAt: new Date() })
        .where(eq(combatEncounters.id, encounterId));
      return awards;
    });
    if (awarded.length) {
      logger.info({
        msg: 'DM_COMBAT_XP_AWARDED',
        encounterId,
        sessionId,
        total: awarded.reduce((sum, a) => sum + a.xp, 0),
        recipients: awarded.length,
      });
    }
    // The notice is recoverable, not fire-and-forget: on a retry (awarded empty because an
    // earlier call stored the award) this re-posts the lost notice from the stored award.
    // #570: a caller that still owes the chat a row for the killing action itself (the
    // intent pipeline) defers the notice so the blow's row is inserted first; it flushes
    // with `ensureCombatVictoryXpNotice` once the row exists, from this same stored award.
    if (deps.postNotice !== false) {
      await ensureCombatVictoryXpNotice({ encounterId, sessionId, userId }, deps.noticeWriter);
    }
    return { awarded, defeatedNames };
  } catch (error) {
    logger.warn({
      msg: 'DM_COMBAT_XP_AWARD_FAILED',
      encounterId,
      sessionId,
      error: error instanceof Error ? error.message : error,
    });
    alert('combat_xp_award_failed', { sessionId, error: `encounter=${encounterId}` });
    return { awarded: [], defeatedNames: [] };
  }
}

/**
 * #310: posts the visible victory-XP chat line, recoverably.
 *
 * Idempotent: skips when the notice row already exists. Reads the STORED award
 * (`experience_awarded` + the encounter-scoped combat events), so a retry whose award
 * was stored by an earlier call re-posts the notice without awarding again. A failed
 * write is caught and logged; the next call retries. Never throws.
 */
export async function ensureCombatVictoryXpNotice(
  input: { encounterId: string; sessionId: string; userId: string },
  writer: EngineChatLineWriter = postEngineChatLine,
): Promise<void> {
  const { encounterId, sessionId, userId } = input;
  const idSeed = `victory-xp:${encounterId}`;
  try {
    if (await engineChatLineExists(idSeed)) return;
    const award = await readStoredVictoryAward(encounterId, sessionId);
    if (!award) return;
    const breakdown = award.entries.map((entry) => `${entry.name}: +${entry.xp} XP`).join('; ');
    await writer({
      sessionId,
      userId,
      idSeed,
      text:
        `⚙️ Engine: Victory! The party gains ${award.total} XP` +
        (breakdown ? ` — ${breakdown}` : '') +
        '. Already on your character sheets.',
      context: {
        intent: 'combat_victory_xp',
        combatEncounterId: encounterId,
        combatEngineBlocks: [
          { sequence: 0, source: 'system', lines: [breakdown || `${award.total} XP`], cards: [] },
        ],
      },
    });
  } catch (error) {
    logger.warn({
      msg: 'COMBAT_XP_NOTICE_FAILED_WILL_RETRY',
      encounterId,
      sessionId,
      error: error instanceof Error ? error.message : error,
    });
  }
}

/** The stored victory award for an encounter, for notice retries. Null when not awarded. */
async function readStoredVictoryAward(
  encounterId: string,
  sessionId: string,
): Promise<{ total: number; entries: { name: string; xp: number }[] } | null> {
  const [encounter] = await db
    .select({ awarded: combatEncounters.experienceAwarded })
    .from(combatEncounters)
    .where(eq(combatEncounters.id, encounterId));
  if (encounter?.awarded == null) return null;
  const events = await db
    .select({ xp: experienceEvents.xpGained, name: characters.name })
    .from(experienceEvents)
    .innerJoin(characters, eq(experienceEvents.characterId, characters.id))
    .where(
      and(
        eq(experienceEvents.sessionId, sessionId),
        eq(experienceEvents.source, 'combat'),
        like(experienceEvents.description, `Victory XP [${encounterId}]:%`),
      ),
    );
  return {
    total: encounter.awarded,
    entries: events.map((event) => ({ name: event.name ?? 'the party', xp: event.xp })),
  };
}
