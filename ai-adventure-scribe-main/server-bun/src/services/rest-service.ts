/**
 * Rest Service
 *
 * Implements D&D 5E rest mechanics including short rests, long rests, and hit dice management.
 * Follows PHB pg. 186 rules for resting and recovery.
 *
 * @module server/services/rest-service
 */

/* eslint-disable max-lines */
import { and, desc, eq, exists, gte, inArray, or, sql } from 'drizzle-orm';

import { CharacterVitalsService } from './character-vitals-service.js';
import { ClassFeaturesService } from './class-features-service.js';
import { CombatHPService } from './combat-hp-service.js';
import { ExhaustionService } from './exhaustion-service.js';
import { RestHitDiceService } from './rest/rest-hit-dice-service.js';
import { SpellSlotMechanics } from './spell-slots/spell-slot-mechanics.js';
import { db } from '../../../db/client';
import {
  characterConditions,
  characters,
  combatParticipantConditions,
  combatParticipants,
  conditionsLibrary,
  restEvents,
  type Character,
  type CharacterHitDice,
  type CharacterStats,
  type RestEvent,
} from '../../../db/schema/index';
import { BusinessLogicError, NotFoundError } from '../lib/errors.js';
import { RestMechanics } from './rest/rest-mechanics.js';
import { SpellSlotsService } from './spell-slots-service.js';
import { StoryRestAlreadyRecorded } from './story-rest-already-recorded.js';

import type {
  HitDieType,
  HitDice,
  LongRestResult,
  RestorableResource,
  RestType,
  ShortRestResult,
  SpendHitDiceResult,
} from '../types/rest.js';
import type { SpellSlot } from '../types/spell-slots.js';

/**
 * Convert engine spell-slot table rows to the rest result's spellSlots wire
 * shape (#2598). `current` is derived as max − used, the same mapping the
 * sheet overlay uses. Returns null when the character has no slot rows; the
 * client treats null as "leave the sheet's slots alone", which matches the
 * old null-JSONB case.
 */
function toRestSpellSlots(
  slots: SpellSlot[],
): Record<string, { max: number; current: number }> | null {
  if (slots.length === 0) return null;
  return Object.fromEntries(
    slots.map((slot) => [
      String(slot.spellLevel),
      { max: slot.totalSlots, current: slot.totalSlots - slot.usedSlots },
    ]),
  );
}

/**
 * Rest Service
 */
export class RestService {
  /**
   * #180 (2014 PHB): a character needs at least 1 hit point at the start of a
   * long rest to gain its benefits, and a dying or dead character cannot take
   * either rest. A stable character at 0 HP may still short rest (spending hit
   * dice can heal), but a long rest grants them nothing, so it is refused
   * outright rather than recorded as a rest that did nothing. Characters with
   * no stats row predate the vitals system; without hit points to read, the
   * guard cannot fire and the legacy behavior stands.
   */
  private static assertRestAllowed(stats: CharacterStats | null, restType: RestType): void {
    if (!stats) return;
    if (stats.vitalState === 'dead') {
      throw new BusinessLogicError(`Cannot take a ${restType} rest while dead.`);
    }
    if (stats.vitalState === 'dying') {
      throw new BusinessLogicError(`Cannot take a ${restType} rest while dying.`);
    }
    if (restType === 'long' && stats.currentHitPoints < 1) {
      throw new BusinessLogicError(
        'A long rest requires at least 1 hit point to grant its benefits.',
      );
    }
  }

  /**
   * #777: the story once-per-message claim. Locks the character, re-checks
   * rest_events for this character, session, and player message, and inserts
   * the event on that transaction before any restore. A second caller waits
   * on the lock, sees the event, and does not restore.
   */
  private static async claimStoryRest(input: {
    characterId: string;
    sessionId: string;
    since: Date;
    restType: RestType;
    notes?: string;
  }): Promise<string> {
    const { characterId, sessionId, since, restType, notes } = input;
    return db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: characters.id })
        .from(characters)
        .where(eq(characters.id, characterId))
        .for('update');
      if (!locked) throw new NotFoundError('Character', characterId);
      const [existing] = await tx
        .select({ id: restEvents.id })
        .from(restEvents)
        .where(
          and(
            eq(restEvents.characterId, characterId),
            eq(restEvents.sessionId, sessionId),
            gte(restEvents.startedAt, since),
          ),
        )
        .limit(1);
      if (existing) throw new StoryRestAlreadyRecorded();
      // started_at is the re-check key, compared to dialogue_history.created_at.
      // Both must be the database clock. new Date() can fall before that row,
      // and the waiter would insert a second event.
      const [restEvent] = await tx
        .insert(restEvents)
        .values({
          characterId,
          sessionId,
          restType,
          startedAt: sql`now()`,
          completedAt: sql`now()`,
          hpRestored: 0,
          hitDiceSpent: 0,
          resourcesRestored: '[]',
          interrupted: false,
          notes: notes || null,
        })
        .returning();
      if (!restEvent) throw new NotFoundError('Character', characterId);
      return restEvent.id;
    });
  }

  /** Fill the claimed event, or insert one for a sheet rest that has no claim. */
  private static async finishRestEvent(
    claimedEventId: string | undefined,
    values: {
      characterId: string;
      sessionId?: string;
      restType: RestType;
      hpRestored: number;
      hitDiceSpent: number;
      resourcesRestored: string;
      notes?: string;
    },
  ): Promise<RestEvent> {
    const now = new Date();
    if (claimedEventId) {
      const [restEvent] = await db
        .update(restEvents)
        .set({
          hpRestored: values.hpRestored,
          hitDiceSpent: values.hitDiceSpent,
          resourcesRestored: values.resourcesRestored,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(restEvents.id, claimedEventId))
        .returning();
      if (!restEvent) throw new NotFoundError('Character', values.characterId);
      return restEvent;
    }
    const [restEvent] = await db
      .insert(restEvents)
      .values({
        characterId: values.characterId,
        sessionId: values.sessionId || null,
        restType: values.restType,
        startedAt: now,
        completedAt: now,
        hpRestored: values.hpRestored,
        hitDiceSpent: values.hitDiceSpent,
        resourcesRestored: values.resourcesRestored,
        interrupted: false,
        notes: values.notes || null,
      })
      .returning();
    if (!restEvent) throw new NotFoundError('Character', values.characterId);
    return restEvent;
  }

  /**
   * #170: the conditions a long rest ends, cleared server-side so the sheet
   * path and the combat path share one ruleset. Mirrors the client's
   * `applyLongRestSemantics` name set (unconscious ends when hit points are
   * restored; prone is not carried through eight hours of rest). Deactivates
   * the character's own rows and the rows of participants in active
   * encounters; ended encounters keep their state, the same rule the healing
   * below follows.
   */
  private static async clearLongRestConditions(
    characterId: string,
    participantIds: string[],
  ): Promise<void> {
    const clearable = await db
      .select({ id: conditionsLibrary.id })
      .from(conditionsLibrary)
      .where(inArray(sql`lower(${conditionsLibrary.name})`, ['unconscious', 'prone']));
    const clearableIds = clearable.map((row) => row.id);
    if (clearableIds.length === 0) return;

    await db
      .update(characterConditions)
      .set({ isActive: false })
      .where(
        and(
          eq(characterConditions.characterId, characterId),
          eq(characterConditions.isActive, true),
          inArray(characterConditions.conditionId, clearableIds),
        ),
      );

    if (participantIds.length > 0) {
      await db
        .update(combatParticipantConditions)
        .set({ isActive: false })
        .where(
          and(
            inArray(combatParticipantConditions.participantId, participantIds),
            eq(combatParticipantConditions.isActive, true),
            inArray(combatParticipantConditions.conditionId, clearableIds),
          ),
        );
    }
  }

  /**
   * Calculate Constitution modifier from ability score
   */
  private static calculateConModifier(constitution: number): number {
    return RestMechanics.calculateConModifier(constitution);
  }

  /**
   * Roll a hit die
   */
  private static rollHitDie(dieType: HitDieType): number {
    return RestMechanics.rollHitDie(dieType);
  }

  /**
   * Get hit die type for a class
   */
  static getHitDieType(className: string): HitDieType {
    return RestHitDiceService.getHitDieType(className);
  }

  /**
   * Verify user owns character (direct owner or shared owner field).
   * Throws NOT_FOUND to avoid disclosing character existence.
   */
  private static async verifyCharacterOwnership(
    characterId: string,
    userId: string,
  ): Promise<void> {
    return RestHitDiceService.verifyCharacterOwnership(characterId, userId);
  }

  /**
   * #264: create hit-dice rows for a character that has none (lazy init).
   * Passes the row's class_levels through so multiclass characters get one
   * row per class instead of a single row at total level.
   */
  static async ensureHitDice(
    characterId: string,
    userId: string,
    className: string | null,
    level: number,
    classLevels?: unknown,
  ): Promise<CharacterHitDice[]> {
    return RestHitDiceService.ensureHitDice(characterId, userId, className, level, classLevels);
  }

  /**
   * Initialize hit dice for a character based on their class and level
   */
  static async initializeHitDice(
    characterId: string,
    userId: string,
    className: string,
    level: number,
  ): Promise<CharacterHitDice> {
    return RestHitDiceService.initializeHitDice(characterId, userId, className, level);
  }

  /**
   * Get all hit dice for a character
   */
  static async getHitDice(characterId: string, userId: string): Promise<CharacterHitDice[]> {
    return RestHitDiceService.getHitDice(characterId, userId);
  }

  /**
   * Get available (unspent) hit dice count
   */
  static async getAvailableHitDiceCount(characterId: string, userId: string): Promise<number> {
    return RestHitDiceService.getAvailableHitDiceCount(characterId, userId);
  }

  /**
   * Spend hit dice to recover HP
   * PHB pg. 186: Roll hit die + CON modifier (minimum 1 HP per die)
   */
  static async spendHitDice(
    characterId: string,
    userId: string,
    count: number,
    preRolledValues?: number[],
    preFetchedData?: {
      character: Character & { stats: CharacterStats | null };
      hitDice: CharacterHitDice[];
    },
  ): Promise<SpendHitDiceResult> {
    return RestHitDiceService.spendHitDice(
      characterId,
      userId,
      count,
      preRolledValues,
      preFetchedData,
    );
  }

  /**
   * Restore hit dice (used during long rest)
   * PHB pg. 186: Restore up to half total hit dice (minimum 1)
   */
  static async restoreHitDice(
    characterId: string,
    userId: string,
    count?: number,
    preFetchedHitDice?: CharacterHitDice[],
  ): Promise<{ restoredCount: number; updatedHitDice: CharacterHitDice[] }> {
    return RestHitDiceService.restoreHitDice(characterId, userId, count, preFetchedHitDice);
  }

  /**
   * Get restorable resources for a rest type
   */
  static async getRestorableResources(
    characterId: string,
    userId: string,
    restType: RestType,
    preVerified: boolean = false,
  ): Promise<RestorableResource[]> {
    if (!preVerified) {
      await this.verifyCharacterOwnership(characterId, userId);
    }

    // Delegated to RestMechanics
    return RestMechanics.getRestorableResources(restType);
  }

  /**
   * Take a short rest
   * PHB pg. 186: 1 hour rest, can spend hit dice to recover HP
   */
  static async takeShortRest(
    characterId: string,
    userId: string,
    hitDiceToSpend: number = 0,
    sessionId?: string,
    notes?: string,
    /** Story once-per-message key. Sheet rests omit it. */
    since?: Date,
  ): Promise<ShortRestResult> {
    // ⚡ Bolt: Consolidated character ownership verification, stats fetching, and hit dice retrieval
    // into a single database round-trip. This reduces sequential latency from 3-4 down to 1.
    const character = (await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
      ),
      with: {
        stats: true,
        hitDice: true,
      },
    })) as (Character & { stats: CharacterStats | null; hitDice: CharacterHitDice[] }) | undefined;

    if (!character) {
      throw new NotFoundError('Character', characterId);
    }

    // #180: refuse before anything is spent or written. A refused rest is not a claim.
    this.assertRestAllowed(character.stats, 'short');
    const claimedEventId =
      since && sessionId
        ? await this.claimStoryRest({
            characterId,
            sessionId,
            since,
            restType: 'short',
            notes,
          })
        : undefined;

    // #264: characters predating the rest system have no hit-dice rows; create
    // them lazily so the sheet has dice to see and the rest has dice to spend.
    let hitDice = character.hitDice || [];
    if (hitDice.length === 0) {
      hitDice = await RestHitDiceService.ensureHitDice(
        characterId,
        userId,
        character.class,
        character.level ?? 1,
        character.classLevels,
      );
    }

    // Spend hit dice if requested
    let hpRestored = 0;
    let hitDiceSpent = 0;
    let updatedHitDice: HitDice[] = hitDice;

    if (hitDiceToSpend > 0) {
      const result = await this.spendHitDice(characterId, userId, hitDiceToSpend, undefined, {
        character,
        hitDice,
      });
      hpRestored = result.hpRestored;
      hitDiceSpent = result.hitDiceSpent;
      updatedHitDice = result.hitDiceRemaining;
    }

    // Get restorable resources
    const resourcesRestored = await this.getRestorableResources(characterId, userId, 'short', true);

    const pactSlots = character.pactSlots as {
      maximum?: number;
      max?: number;
      current?: number;
    } | null;
    const updatedPactSlots = pactSlots
      ? { ...pactSlots, current: pactSlots.maximum ?? pactSlots.max ?? pactSlots.current }
      : pactSlots;
    const updatedClassFeatures = RestMechanics.restoreClassFeatures(
      character.classFeatures,
      'short',
    );
    await db
      .update(characters)
      .set({
        pactSlots: updatedPactSlots,
        classFeatures: updatedClassFeatures,
        updatedAt: new Date(),
      })
      .where(eq(characters.id, characterId));
    // #397: a single-class warlock's engine-table rows are pact slots, which
    // recover on a short rest (2014 PHB pg. 107). The legacy
    // characters.pactSlots JSONB restore above is unchanged; the engine rows
    // are restored here.
    if (SpellSlotMechanics.isPactSlotCharacter(character.class, character.classLevels)) {
      await SpellSlotsService.restoreSpellSlots({ characterId }, userId);
    }
    await ClassFeaturesService.restoreFeatures({ characterId, restType: 'short', userId });

    // Story rests already inserted the claim. Sheet rests insert here.
    // Reaching this line already proves ownership (the lookup at the top).
    const restEvent = await this.finishRestEvent(claimedEventId, {
      characterId,
      sessionId,
      restType: 'short',
      hpRestored,
      hitDiceSpent,
      resourcesRestored: JSON.stringify(resourcesRestored),
      notes,
    });

    return {
      characterId,
      restType: 'short',
      hpRestored,
      hitDiceSpent,
      hitDiceRemaining: updatedHitDice,
      resourcesRestored,
      // The engine's slot table is the single source of truth (#2598): the
      // result serves the table's rows, never the legacy JSONB. A short rest
      // restores only pact rows (single-class warlocks, #397); other rows are
      // read as-is.
      spellSlots: toRestSpellSlots(
        (await SpellSlotsService.getCharacterSpellSlots(characterId, userId)).slots,
      ),
      pactSlots: updatedPactSlots,
      classFeatures: updatedClassFeatures,
      restEventId: restEvent.id,
    };
  }

  /**
   * Take a long rest
   * PHB pg. 186: 8 hours rest, restore all HP, spell slots, and half hit dice
   */
  static async takeLongRest(
    characterId: string,
    userId: string,
    sessionId?: string,
    notes?: string,
    /** Story once-per-message key. Sheet rests omit it. */
    since?: Date,
  ): Promise<LongRestResult> {
    // ⚡ Bolt: Consolidated character ownership verification, stats fetching, and hit dice retrieval
    // into a single database round-trip. This reduces sequential latency from 3-4 down to 1.
    const character = (await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
      ),
      with: {
        stats: true,
        hitDice: true,
      },
    })) as (Character & { stats: CharacterStats | null; hitDice: CharacterHitDice[] }) | undefined;

    if (!character) {
      throw new NotFoundError('Character', characterId);
    }

    // #180: refuse before anything is healed, restored, or recorded.
    this.assertRestAllowed(character.stats, 'long');
    const claimedEventId =
      since && sessionId
        ? await this.claimStoryRest({
            characterId,
            sessionId,
            since,
            restType: 'long',
            notes,
          })
        : undefined;

    // #264: same lazy hit-dice creation as takeShortRest above.
    let hitDice = character.hitDice || [];
    if (hitDice.length === 0) {
      hitDice = await RestHitDiceService.ensureHitDice(
        characterId,
        userId,
        character.class,
        character.level ?? 1,
        character.classLevels,
      );
    }

    const hpRestored = character.stats
      ? Math.max(0, character.stats.maxHitPoints - character.stats.currentHitPoints)
      : 0;

    if (character.stats) {
      // #2600: heal through CharacterVitalsService so vitalState, isConscious
      // and the death-save tallies move with the HP (#2618) instead of a raw
      // currentHitPoints update that left the sheet saying "dying" at full HP.
      // Dead characters are left alone by heal.
      await CharacterVitalsService.heal(characterId, userId, hpRestored);
    }

    // Restore hit dice (half total, minimum 1)
    const { restoredCount: hitDiceRestored, updatedHitDice } = await this.restoreHitDice(
      characterId,
      userId,
      undefined,
      hitDice,
    );

    // Get restorable resources
    const resourcesRestored = await this.getRestorableResources(characterId, userId, 'long', true);

    const pactSlots = character.pactSlots as {
      maximum?: number;
      max?: number;
      current?: number;
    } | null;
    const updatedPactSlots = pactSlots
      ? { ...pactSlots, current: pactSlots.maximum ?? pactSlots.max ?? pactSlots.current }
      : pactSlots;
    const updatedClassFeatures = RestMechanics.restoreClassFeatures(
      character.classFeatures,
      'long',
    );
    await db
      .update(characters)
      .set({
        pactSlots: updatedPactSlots,
        classFeatures: updatedClassFeatures,
        // #170: a long rest ends concentration, server-side, so the sheet path
        // and the combat path end it persistently — not just in local state.
        activeConcentration: null,
        updatedAt: new Date(),
      })
      .where(eq(characters.id, characterId));
    // The engine's slot table is the single source the sheet reads (#2459), so
    // a long rest resets it here. The legacy characters.spell_slots JSONB is
    // neither read nor written anymore (#2598).
    await SpellSlotsService.restoreSpellSlots({ characterId }, userId);
    // Serve the restored table rows in the result, not the stale JSONB.
    const spellSlots = toRestSpellSlots(
      (await SpellSlotsService.getCharacterSpellSlots(characterId, userId)).slots,
    );
    await ClassFeaturesService.restoreFeatures({ characterId, restType: 'long', userId });

    const participants = await db.query.combatParticipants.findMany({
      where: eq(combatParticipants.characterId, characterId),
      columns: { id: true, encounterId: true },
      with: {
        status: {
          columns: { maxHp: true },
        },
        encounter: {
          columns: { status: true },
        },
      },
    });
    // #2600: only heal participants in ACTIVE encounters. Ended encounters
    // have stale status.maxHp (e.g., from before a level-up); healing them
    // would mirror the stale HP onto the sheet via CharacterVitalsService.
    // The sheet is the source of truth for ended encounters.
    const activeParticipants = participants.filter(
      (participant) => participant.encounter?.status === 'active',
    );
    // #170: clear the conditions a long rest clears, server-side, so both
    // rest paths clear the same conditions.
    await this.clearLongRestConditions(
      characterId,
      activeParticipants.map((participant) => participant.id),
    );
    await Promise.all(
      activeParticipants.map((participant) =>
        ExhaustionService.reduceExhaustion(participant.id, userId).catch((error: unknown) => {
          console.warn(
            `[rest-service] reduceExhaustion failed for participant ${participant.id}:`,
            error,
          );
        }),
      ),
    );

    // #2600: heal each active participant through CombatHPService so HP,
    // isConscious and death-save tallies move together (#2618) instead of a
    // raw tally reset that left the participant "dying" at 0 HP. Dead
    // participants are left alone by the heal. Ended encounters are skipped
    // (see above) — healing them is not harmless, because the write-through
    // mirror would overwrite the sheet HP with the stale encounter max.
    // Healed sequentially (not in Promise.all) so the sheet write order is
    // fixed and does not depend on which heal lands last.
    for (const participant of activeParticipants) {
      try {
        await CombatHPService.healDamage(
          participant.id,
          participant.encounterId,
          participant.status?.maxHp ?? 0,
          'long rest',
          userId,
        );
      } catch (error: unknown) {
        console.warn(`[rest-service] healDamage failed for participant ${participant.id}:`, error);
      }
    }

    // Story rests already inserted the claim. Sheet rests insert here.
    const restEvent = await this.finishRestEvent(claimedEventId, {
      characterId,
      sessionId,
      restType: 'long',
      hpRestored,
      hitDiceSpent: 0,
      resourcesRestored: JSON.stringify(resourcesRestored),
      notes,
    });

    return {
      characterId,
      restType: 'long',
      hpRestored,
      hitDiceRestored,
      hitDiceRemaining: updatedHitDice,
      resourcesRestored,
      spellSlots,
      pactSlots: updatedPactSlots,
      classFeatures: updatedClassFeatures,
      restEventId: restEvent.id,
    };
  }

  /**
   * Get rest history for a character
   */
  static async getRestHistory(
    characterId: string,
    userId: string,
    sessionId?: string,
    limit: number = 50,
  ): Promise<RestEvent[]> {
    const conditions = [
      eq(restEvents.characterId, characterId),
      exists(
        db
          .select()
          .from(characters)
          .where(
            and(
              eq(characters.id, characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
            ),
          ),
      ),
    ];

    if (sessionId) {
      conditions.push(eq(restEvents.sessionId, sessionId));
    }

    const history = await db.query.restEvents.findMany({
      where: and(...conditions),
      orderBy: [desc(restEvents.startedAt)],
      limit,
    });

    return history;
  }

  /**
   * Calculate hit dice for a class at a given level
   */
  static calculateHitDiceForClass(
    className: string,
    level: number,
  ): {
    dieType: HitDieType;
    count: number;
  } {
    return RestHitDiceService.calculateHitDiceForClass(className, level);
  }
}
