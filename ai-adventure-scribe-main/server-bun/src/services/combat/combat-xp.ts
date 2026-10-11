/**
 * #310: combat victory XP.
 *
 * Kills awarded nothing: the only XP writer was the story path (`xp_award` in the DM reply),
 * and in-combat turns skip it, so a won fight left the sheet untouched and the award (when the
 * model did emit one) arrived with no message. When an encounter concludes with the last
 * hostile defeated, each player character now earns XP (see combat-xp-mechanics.ts), and the
 * DM's victory narration is handed the exact award to state, so the gain is visible in chat.
 *
 * Every player participant with a character row shares alike — 2014 divides among the party,
 * not the conscious.
 *
 * Idempotency: `concludeEncounter`'s terminal claim is the boundary — only the claimer calls
 * this. The encounter row is locked and `experience_awarded` is checked and set inside the
 * same transaction as the per-character writes, so a retry cannot double-award.
 */

import { eq, sql } from 'drizzle-orm';

import { CombatEncounterService } from './combat-encounter-service.js';
import { combatVictoryXp } from './combat-xp-mechanics.js';
import { db } from '../../../../db/client';
import { combatEncounters } from '../../../../db/schema/combat';
import { characters, experienceEvents } from '../../../../db/schema/index';
import { alert } from '../../lib/alerting.js';
import { logger } from '../../lib/logger.js';

export interface CombatXpAward {
  characterId: string;
  name: string;
  xp: number;
}

/**
 * Awards victory XP for a concluded encounter. Never throws: a failed write must not break
 * combat conclusion — it logs and alerts, and the strategist sees the gap in the report.
 */
export async function awardCombatVictoryXp(input: {
  encounterId: string;
  sessionId: string;
  userId: string;
}): Promise<{ awarded: CombatXpAward[]; defeatedNames: string[] }> {
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
    const defeatedNames = state.participants
      .filter((p) => p.participantType !== 'player')
      .map((p) => p.name)
      .filter(Boolean);

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
        const xp = combatVictoryXp(row.level ?? 1, locked.difficulty);
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
          description: `Victory XP: ${defeatedNames.slice(0, 5).join(', ') || 'the encounter'}`,
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
