/**
 * Damage that is not an attack roll: a hazard, a trap, a DM-resolved blow, a client-computed
 * `damage_taken` roll (#2518, run D8 / #2622).
 *
 * Every writer that can bring a player to 0 HP goes through ONE dying transition. During a live
 * encounter that transition is `CombatHPService.applyDamage` (damage rules, the dying state, the
 * participant row and the character sheet in one transaction). Outside a fight it is
 * `CharacterVitalsService.applyDamage`, which uses the same rules. Both paths return the same
 * engine lines so the player reads, and the DM is told, what the engine did.
 */
import { and, desc, eq } from 'drizzle-orm';

import { db } from '../../../../db/client';
import {
  combatEncounters,
  combatParticipants,
  combatParticipantStatus,
} from '../../../../db/schema/index';
import { describeDamageAtZeroHp, describeInstantDeath } from '../../../../shared/death-save-lines';
import { CharacterVitalsService, type CharacterVitals } from '../character-vitals-service.js';
import { CombatHPService } from '../combat-hp-service.js';
import { describeGoingDown } from './death-saves-service.js';
import { instantDeathOutcome } from './hp-mechanics.js';
import { recordDmTacticalFact } from './tactical-action-service.js';

export interface NonAttackDamageResult {
  vitals: CharacterVitals;
  /** Player-visible engine lines, in order. The DM receives the same sentences as tactical facts. */
  engineLines: string[];
}

interface LiveParticipant {
  participantId: string;
  encounterId: string;
  sessionId: string;
  name: string | null;
  currentHp: number;
}

/** The character's seat in an encounter that is still running, if it has one. */
export async function findLiveParticipant(characterId: string): Promise<LiveParticipant | null> {
  const [row] = await db
    .select({
      participantId: combatParticipants.id,
      encounterId: combatParticipants.encounterId,
      sessionId: combatEncounters.sessionId,
      name: combatParticipants.name,
      currentHp: combatParticipantStatus.currentHp,
    })
    .from(combatParticipants)
    .innerJoin(combatEncounters, eq(combatEncounters.id, combatParticipants.encounterId))
    .innerJoin(
      combatParticipantStatus,
      eq(combatParticipantStatus.participantId, combatParticipants.id),
    )
    .where(
      and(
        eq(combatParticipants.characterId, characterId),
        eq(combatParticipants.isActive, true),
        eq(combatEncounters.status, 'active'),
      ),
    )
    .orderBy(desc(combatParticipants.createdAt))
    .limit(1);
  return row ?? null;
}

interface TransitionFacts {
  droppedToZero: boolean;
  instantDeath: boolean;
  failuresAdded: number;
  failures: number;
  /** Damage that remained after 0 HP, and the maximum it is judged against (#2640). */
  overflow?: number;
  hpMax?: number;
}

/** The engine sentences for what one piece of damage did to a player, most important first. */
export function nonAttackDamageLines(name: string, facts: TransitionFacts): string[] {
  if (facts.instantDeath) {
    return [describeInstantDeath(name, { overflow: facts.overflow, hpMax: facts.hpMax })];
  }
  if (facts.failuresAdded > 0) {
    return [describeDamageAtZeroHp(name, facts.failuresAdded, facts.failures)];
  }
  if (facts.droppedToZero) {
    return [describeGoingDown(name, { overflow: facts.overflow, hpMax: facts.hpMax })];
  }
  return [];
}

/**
 * Apply `amount` damage to a character from a source that is not an attack. In a live encounter
 * the participant row is the one written (and mirrored to the sheet); out of a fight the sheet is.
 */
export async function applyNonAttackDamage(
  characterId: string,
  userId: string,
  amount: number,
  sourceDescription = 'non-attack damage',
  options: { critical?: boolean } = {},
): Promise<NonAttackDamageResult> {
  const live = amount > 0 ? await findLiveParticipant(characterId) : null;

  if (!live) {
    const before = await CharacterVitalsService.getVitals(characterId, userId);
    const vitals = await CharacterVitalsService.applyDamage(characterId, userId, amount, options);
    const name = 'The character';
    // The same truncation computeVitalsAfterDamage applies, so the line is judged on the number
    // the sheet actually took, and the verdict is the one instantDeathOutcome gave it.
    const damage = Math.max(0, Math.trunc(amount));
    const outcome = instantDeathOutcome(
      before.currentHitPoints,
      Math.max(0, damage - before.temporaryHitPoints),
      before.maxHitPoints,
    );
    const alreadyDead = before.vitalState === 'dead';
    const dropped = before.currentHitPoints > 0 && vitals.currentHitPoints === 0;
    const failuresAdded =
      before.currentHitPoints === 0 && !alreadyDead
        ? Math.max(0, vitals.deathSavesFailures - before.deathSavesFailures)
        : 0;
    return {
      vitals,
      engineLines: alreadyDead
        ? []
        : nonAttackDamageLines(name, {
            droppedToZero: dropped && !outcome.massiveDamage,
            instantDeath: outcome.massiveDamage,
            failuresAdded: outcome.massiveDamage ? 0 : failuresAdded,
            failures: vitals.deathSavesFailures,
            overflow: outcome.overflow,
            hpMax: before.maxHitPoints,
          }),
    };
  }

  const result = await CombatHPService.applyDamage(
    live.participantId,
    live.encounterId,
    {
      damageAmount: amount,
      sourceDescription,
      uncapped: true,
      isCriticalHit: options.critical === true,
    },
    userId,
  );
  const name = live.name ?? 'The character';
  const engineLines = nonAttackDamageLines(name, {
    droppedToZero: live.currentHp > 0 && result.newCurrentHp === 0 && !result.isDead,
    instantDeath: result.massiveDamage === true,
    failuresAdded: result.deathSaveFailuresAdded ?? 0,
    failures: result.newDeathSavesFailures,
    overflow: result.overflow,
    hpMax: result.hpMaximum,
  });
  for (const line of engineLines) await recordDmTacticalFact(live.sessionId, line);

  return { vitals: await CharacterVitalsService.getVitals(characterId, userId), engineLines };
}
