/**
 * Rest Service
 *
 * Implements D&D 5E rest mechanics including short rests, long rests, and hit dice management.
 * Follows PHB pg. 186 rules for resting and recovery.
 *
 * @module server/services/rest-service
 */

/* eslint-disable max-lines */
import { and, desc, eq, exists, or, sql } from 'drizzle-orm';

import { db } from '../../../db/client';
import {
  characters,
  characterStats,
  combatParticipants,
  restEvents,
  type Character,
  type CharacterHitDice,
  type CharacterStats,
  type RestEvent,
} from '../../../db/schema/index';
import { NotFoundError } from '../lib/errors.js';
import { RestHitDiceService } from './rest/rest-hit-dice-service.js';
import { RestMechanics } from './rest/rest-mechanics.js';
import { ExhaustionService } from './exhaustion-service.js';
import { ClassFeaturesService } from './class-features-service.js';

import type {
  HitDieType,
  LongRestResult,
  RestorableResource,
  RestType,
  ShortRestResult,
  SpendHitDiceResult,
} from '../types/rest.js';

/**
 * Rest Service
 */
export class RestService {
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

    const hitDice = character.hitDice || [];

    // Spend hit dice if requested
    let hpRestored = 0;
    let hitDiceSpent = 0;
    let updatedHitDice = hitDice;

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
    const updatedClassFeatures = RestMechanics.restoreClassFeatures(character.classFeatures, 'short');
    await db
      .update(characters)
      .set({
        pactSlots: updatedPactSlots,
        classFeatures: updatedClassFeatures,
        updatedAt: new Date(),
      })
      .where(eq(characters.id, characterId));
    await ClassFeaturesService.restoreFeatures({ characterId, restType: 'short', userId });

    // Create rest event
    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
    const [restEvent] = await db
      .insert(restEvents)
      .select(
        db
          .select({
            characterId: sql`${characterId}`,
            sessionId: sql`${sessionId || null}`,
            restType: sql`'short'`,
            startedAt: sql`NOW()`,
            completedAt: sql`NOW()`,
            hpRestored: sql`${hpRestored}`,
            hitDiceSpent: sql`${hitDiceSpent}`,
            resourcesRestored: sql`${JSON.stringify(resourcesRestored)}`,
            interrupted: sql`false`,
            notes: sql`${notes || null}`,
          })
          .from(characters)
          .where(
            and(
              eq(characters.id, characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
            ),
          ),
      )
      .returning();

    if (!restEvent) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Character', characterId);
    }

    return {
      characterId,
      restType: 'short',
      hpRestored,
      hitDiceSpent,
      hitDiceRemaining: updatedHitDice,
      resourcesRestored,
      spellSlots: character.spellSlots as Record<string, { max?: number; current?: number }> | null,
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

    const hitDice = character.hitDice || [];

    const hpRestored = character.stats
      ? Math.max(0, character.stats.maxHitPoints - character.stats.currentHitPoints)
      : 0;

    if (character.stats) {
      await db
        .update(characterStats)
        .set({ currentHitPoints: character.stats.maxHitPoints, updatedAt: new Date() })
        .where(eq(characterStats.characterId, characterId));
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
    const updatedSpellSlots = RestMechanics.restoreSpellSlots(
      character.spellSlots as Record<string, { max?: number; current?: number }> | null,
    );
    const updatedPactSlots = pactSlots
      ? { ...pactSlots, current: pactSlots.maximum ?? pactSlots.max ?? pactSlots.current }
      : pactSlots;
    const updatedClassFeatures = RestMechanics.restoreClassFeatures(character.classFeatures, 'long');
    await db
      .update(characters)
      .set({
        spellSlots: updatedSpellSlots,
        pactSlots: updatedPactSlots,
        classFeatures: updatedClassFeatures,
        updatedAt: new Date(),
      })
      .where(eq(characters.id, characterId));
    await ClassFeaturesService.restoreFeatures({ characterId, restType: 'long', userId });

    const participants = await db.query.combatParticipants.findMany({
      where: eq(combatParticipants.characterId, characterId),
      columns: { id: true },
    });
    await Promise.all(
      participants.map((participant) =>
        ExhaustionService.reduceExhaustion(participant.id, userId).catch(() => undefined),
      ),
    );

    // Create rest event
    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
    const [restEvent] = await db
      .insert(restEvents)
      .select(
        db
          .select({
            characterId: sql`${characterId}`,
            sessionId: sql`${sessionId || null}`,
            restType: sql`'long'`,
            startedAt: sql`NOW()`,
            completedAt: sql`NOW()`,
            hpRestored: sql`${hpRestored}`,
            hitDiceSpent: sql`0`,
            resourcesRestored: sql`${JSON.stringify(resourcesRestored)}`,
            interrupted: sql`false`,
            notes: sql`${notes || null}`,
          })
          .from(characters)
          .where(
            and(
              eq(characters.id, characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
            ),
          ),
      )
      .returning();

    if (!restEvent) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Character', characterId);
    }

    return {
      characterId,
      restType: 'long',
      hpRestored,
      hitDiceRestored,
      hitDiceRemaining: updatedHitDice,
      resourcesRestored,
      spellSlots: updatedSpellSlots,
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
