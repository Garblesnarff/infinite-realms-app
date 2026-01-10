/**
 * Conditions Service
 *
 * Handles D&D 5E condition management for combat participants.
 * Implements all 13 core conditions with mechanical effects tracking,
 * duration management, and saving throw logic.
 *
 * @module server/services/conditions-service
 */

import { db } from '../../../db/client.js';
import { sql } from 'drizzle-orm';
import type {
  Condition,
  ConditionLibraryEntry,
  ParticipantCondition,
  ParticipantConditionWithDetails,
  NewParticipantCondition,
  MechanicalEffects,
  AggregatedMechanicalEffects,
  ConditionConflict,
  ConditionDurationType,
  SaveAbility,
} from '../types/combat.js';
import { NotFoundError, ValidationError, BusinessLogicError } from '../lib/errors.js';

/**
 * Conditions that include or supersede other conditions
 */
const CONDITION_HIERARCHY: Record<string, string[]> = {
  'Paralyzed': ['Incapacitated'],
  'Petrified': ['Incapacitated'],
  'Stunned': ['Incapacitated'],
  'Unconscious': ['Incapacitated', 'Prone'],
};

/**
 * Mutually incompatible conditions
 */
const INCOMPATIBLE_CONDITIONS: Record<string, string[]> = {
  'Invisible': ['Blinded'], // Being invisible doesn't help if you're blind
  'Prone': ['Flying'], // Can't be prone while flying (if we add flying status)
};

export class ConditionsService {
  /**
   * Apply a condition to a combat participant
   */
  static async applyCondition(
    participantId: string,
    conditionName: string,
    durationType: ConditionDurationType,
    durationValue?: number,
    saveDC?: number,
    saveAbility?: SaveAbility,
    source?: string,
    currentRound?: number
  ): Promise<{ condition: ParticipantConditionWithDetails; warnings: string[] }> {
    const warnings: string[] = [];

    // Get condition from library
    const conditionLibrary = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM conditions_library WHERE name = ${conditionName} LIMIT 1`
    );

    if (!conditionLibrary || conditionLibrary.length === 0) {
      throw new NotFoundError('Condition', conditionName);
    }

    const conditionEntry = conditionLibrary[0] as unknown as ConditionLibraryEntry;

    // Get participant to get current round
    const participantResult = await db.execute<Record<string, unknown>>(
      sql`SELECT encounter_id FROM combat_participants WHERE id = ${participantId} LIMIT 1`
    );

    if (!participantResult || participantResult.length === 0) {
      throw new NotFoundError('Participant', participantId);
    }

    // Get current round from encounter if not provided
    let appliedAtRound = currentRound || 1;
    if (!currentRound) {
      const encounterResult = await db.execute<Record<string, unknown>>(
        sql`SELECT current_round FROM combat_encounters WHERE id = ${participantResult[0]!.encounter_id} LIMIT 1`
      );
      if (encounterResult && encounterResult.length > 0) {
        appliedAtRound = encounterResult[0]!.current_round as number;
      }
    }

    // Calculate expiry round
    let expiresAtRound: number | null = null;
    if (durationType === 'rounds' && durationValue) {
      expiresAtRound = appliedAtRound + durationValue;
    } else if (durationType === 'minutes' && durationValue) {
      // 1 minute = 10 rounds (60 seconds / 6 seconds per round)
      expiresAtRound = appliedAtRound + (durationValue * 10);
    } else if (durationType === 'hours' && durationValue) {
      // 1 hour = 600 rounds
      expiresAtRound = appliedAtRound + (durationValue * 600);
    }

    // Check for conflicts
    const conflicts = await this.checkConditionConflicts(participantId, conditionName);
    conflicts.forEach(conflict => {
      warnings.push(conflict.message);
      // Auto-remove superseded conditions
      if (conflict.conflictType === 'superseded') {
        this.removeCondition(conflict.existingCondition.id).catch(err => {
          console.error('Failed to remove superseded condition:', err);
        });
      }
    });

    // Insert the condition
    const result = await db.execute<Record<string, unknown>>(
      sql`
        INSERT INTO combat_participant_conditions (
          participant_id,
          condition_id,
          duration_type,
          duration_value,
          save_dc,
          save_ability,
          applied_at_round,
          expires_at_round,
          source_description,
          is_active
        ) VALUES (
          ${participantId},
          ${conditionEntry.id},
          ${durationType},
          ${durationValue || null},
          ${saveDC || null},
          ${saveAbility || null},
          ${appliedAtRound},
          ${expiresAtRound},
          ${source || null},
          true
        )
        RETURNING *
      `
    );

    const participantCondition = result[0] as unknown as ParticipantCondition;

    // Parse mechanical effects
    const condition = this.parseCondition(conditionEntry);

    return {
      condition: {
        ...participantCondition,
        condition,
      },
      warnings,
    };
  }

  /**
   * Remove a condition from a participant
   */
  static async removeCondition(conditionId: string): Promise<boolean> {
    const result = await db.execute<Record<string, unknown>>(
      sql`
        UPDATE combat_participant_conditions
        SET is_active = false
        WHERE id = ${conditionId}
        RETURNING id
      `
    );

    return result ? result.length > 0 : false;
  }

  /**
   * Attempt a saving throw against a condition
   */
  static async attemptSave(
    conditionId: string,
    saveRoll: number
  ): Promise<{ saved: boolean; conditionRemoved: boolean; message: string }> {
    // Get the condition
    const result = await db.execute<Record<string, unknown>>(
      sql`
        SELECT * FROM combat_participant_conditions
        WHERE id = ${conditionId} AND is_active = true
        LIMIT 1
      `
    );

    if (!result || result.length === 0) {
      throw new NotFoundError('Active condition', conditionId);
    }

    const condition = result[0] as unknown as ParticipantCondition;

    if (!condition.saveDc || !condition.saveAbility) {
      throw new BusinessLogicError('This condition does not require a saving throw', { conditionId });
    }

    const saved = saveRoll >= condition.saveDc;
    let conditionRemoved = false;
    let message = '';

    if (saved) {
      // Remove the condition
      await this.removeCondition(conditionId);
      conditionRemoved = true;
      message = `Saving throw successful (${saveRoll})! Condition removed.`;
    } else {
      message = `Saving throw failed (${saveRoll}). Condition persists.`;
    }

    return { saved, conditionRemoved, message };
  }

  /**
   * Get all active conditions for a participant
   */
  static async getActiveConditions(participantId: string): Promise<ParticipantConditionWithDetails[]> {
    const result = await db.execute<Record<string, unknown>>(
      sql`
        SELECT
          cpc.*,
          cl.name as condition_name,
          cl.description as condition_description,
          cl.mechanical_effects,
          cl.icon_name
        FROM combat_participant_conditions cpc
        JOIN conditions_library cl ON cl.id = cpc.condition_id
        WHERE cpc.participant_id = ${participantId}
          AND cpc.is_active = true
        ORDER BY cpc.applied_at_round DESC
      `
    );

    return (result || []).map((row: any) => {
      const mechanicalEffects = this.parseMechanicalEffects(row.mechanical_effects);

      return {
        id: row.id,
        participantId: row.participant_id,
        conditionId: row.condition_id,
        durationType: row.duration_type as ConditionDurationType,
        durationValue: row.duration_value,
        saveDc: row.save_dc,
        saveAbility: row.save_ability as SaveAbility | null,
        appliedAtRound: row.applied_at_round,
        expiresAtRound: row.expires_at_round,
        sourceDescription: row.source_description,
        isActive: row.is_active,
        createdAt: new Date(row.created_at),
        condition: {
          id: row.condition_id,
          name: row.condition_name,
          description: row.condition_description,
          mechanicalEffects,
          iconName: row.icon_name,
          createdAt: new Date(row.created_at),
        },
      };
    });
  }

  /**
   * Get aggregated mechanical effects for a participant from all active conditions
   */
  static async getMechanicalEffects(participantId: string): Promise<AggregatedMechanicalEffects> {
    const conditions = await this.getActiveConditions(participantId);

    const aggregated = {
      appliedConditions: [] as string[],
    } as AggregatedMechanicalEffects;

    // Merge all mechanical effects
    for (const condition of conditions) {
      aggregated.appliedConditions.push(condition.condition.name);
      const effects = condition.condition.mechanicalEffects;

      // Merge effects - most restrictive wins
      for (const [key, value] of Object.entries(effects)) {
        if (key === 'appliedConditions') continue;

        if (!aggregated[key]) {
          aggregated[key] = value;
        } else {
          // Apply precedence rules
          aggregated[key] = this.mergeEffectValues(aggregated[key], value, key);
        }
      }
    }

    return aggregated;
  }

  /**
   * Advance condition durations at the end of a round
   */
  static async advanceConditionDurations(
    encounterId: string,
    currentRound: number
  ): Promise<{
    expiredConditions: ParticipantConditionWithDetails[];
    savingThrowsNeeded: Array<{ participantId: string; conditionId: string; saveAbility: SaveAbility; saveDc: number }>;
  }> {
    // Get all active conditions for this encounter's participants
    const result = await db.execute<Record<string, unknown>>(
      sql`
        SELECT
          cpc.*,
          cl.name as condition_name,
          cl.description as condition_description,
          cl.mechanical_effects,
          cl.icon_name,
          cp.id as participant_id
        FROM combat_participant_conditions cpc
        JOIN conditions_library cl ON cl.id = cpc.condition_id
        JOIN combat_participants cp ON cp.id = cpc.participant_id
        WHERE cp.encounter_id = ${encounterId}
          AND cpc.is_active = true
      `
    );

    const expiredConditions: ParticipantConditionWithDetails[] = [];
    const savingThrowsNeeded: Array<{ participantId: string; conditionId: string; saveAbility: SaveAbility; saveDc: number }> = [];

    for (const rowData of (result || [])) {
      const row = rowData as any;
      // Check if condition has expired
      if (row.expires_at_round && row.expires_at_round <= currentRound) {
        await this.removeCondition(row.id);

        const mechanicalEffects = this.parseMechanicalEffects(row.mechanical_effects);
        expiredConditions.push({
          id: row.id,
          participantId: row.participant_id,
          conditionId: row.condition_id,
          durationType: row.duration_type as ConditionDurationType,
          durationValue: row.duration_value,
          saveDc: row.save_dc,
          saveAbility: row.save_ability as SaveAbility | null,
          appliedAtRound: row.applied_at_round,
          expiresAtRound: row.expires_at_round,
          sourceDescription: row.source_description,
          isActive: false,
          createdAt: new Date(row.created_at),
          condition: {
            id: row.condition_id,
            name: row.condition_name,
            description: row.condition_description,
            mechanicalEffects,
            iconName: row.icon_name,
            createdAt: new Date(row.created_at),
          },
        });
      }
      // Check if condition requires a saving throw
      else if (row.duration_type === 'until_save' && row.save_dc && row.save_ability) {
        savingThrowsNeeded.push({
          participantId: row.participant_id,
          conditionId: row.id,
          saveAbility: row.save_ability as SaveAbility,
          saveDc: row.save_dc,
        });
      }
    }

    return { expiredConditions, savingThrowsNeeded };
  }

  /**
   * Check for condition conflicts before applying
   */
  static async checkConditionConflicts(
    participantId: string,
    newConditionName: string
  ): Promise<ConditionConflict[]> {
    const activeConditions = await this.getActiveConditions(participantId);
    const conflicts: ConditionConflict[] = [];

    for (const existingCondition of activeConditions) {
      const existingName = existingCondition.condition.name;

      // Check for duplicate
      if (existingName === newConditionName) {
        conflicts.push({
          existingCondition,
          newConditionName,
          conflictType: 'duplicate',
          message: `${newConditionName} is already applied to this participant`,
        });
      }

      // Check if new condition supersedes existing
      if (CONDITION_HIERARCHY[newConditionName]?.includes(existingName)) {
        conflicts.push({
          existingCondition,
          newConditionName,
          conflictType: 'superseded',
          message: `${newConditionName} includes ${existingName}, which will be removed`,
        });
      }

      // Check if existing condition supersedes new
      if (CONDITION_HIERARCHY[existingName]?.includes(newConditionName)) {
        conflicts.push({
          existingCondition,
          newConditionName,
          conflictType: 'superseded',
          message: `${existingName} already includes the effects of ${newConditionName}`,
        });
      }

      // Check for incompatibilities
      if (INCOMPATIBLE_CONDITIONS[newConditionName]?.includes(existingName)) {
        conflicts.push({
          existingCondition,
          newConditionName,
          conflictType: 'incompatible',
          message: `${newConditionName} is incompatible with ${existingName}`,
        });
      }
    }

    return conflicts;
  }

  /**
   * Get all available conditions from the library
   */
  static async getConditionsLibrary(): Promise<Condition[]> {
    const result = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM conditions_library ORDER BY name ASC`
    );

    return (result || []).map((row: any) => this.parseCondition(row as ConditionLibraryEntry));
  }

  /**
   * Parse a condition from the library
   */
  private static parseCondition(entry: ConditionLibraryEntry | any): Condition {
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      mechanicalEffects: this.parseMechanicalEffects(entry.mechanicalEffects || entry.mechanical_effects),
      iconName: entry.iconName || entry.icon_name || null,
      createdAt: new Date(entry.createdAt || entry.created_at),
    };
  }

  /**
   * Parse mechanical effects JSON string
   */
  private static parseMechanicalEffects(effectsJson: string): MechanicalEffects {
    try {
      return JSON.parse(effectsJson);
    } catch (error) {
      console.error('Failed to parse mechanical effects:', error);
      return {};
    }
  }

  // ==========================================
  // D&D 5E Combat Integration Methods
  // ==========================================

  /**
   * Get attack roll modifiers for an attacker based on their conditions
   * Returns sources of advantage and disadvantage on the attacker's rolls
   */
  static async getAttackerModifiers(attackerId: string): Promise<{
    hasAdvantage: boolean;
    hasDisadvantage: boolean;
    reasons: string[];
  }> {
    const effects = await this.getMechanicalEffects(attackerId);
    const reasons: string[] = [];

    let hasAdvantage = false;
    let hasDisadvantage = false;

    // Check attacker's own conditions affecting their attacks
    if (effects.attack_rolls === 'disadvantage') {
      hasDisadvantage = true;
      reasons.push(`Attacker has disadvantage from: ${effects.appliedConditions.join(', ')}`);
    } else if (effects.attack_rolls === 'advantage') {
      hasAdvantage = true;
      reasons.push(`Attacker has advantage from: ${effects.appliedConditions.join(', ')}`);
    }

    // Blinded attackers have disadvantage
    if (effects.appliedConditions.includes('Blinded')) {
      hasDisadvantage = true;
      if (!reasons.some(r => r.includes('Blinded'))) {
        reasons.push('Attacker is Blinded (disadvantage on attacks)');
      }
    }

    // Poisoned attackers have disadvantage
    if (effects.appliedConditions.includes('Poisoned')) {
      hasDisadvantage = true;
      if (!reasons.some(r => r.includes('Poisoned'))) {
        reasons.push('Attacker is Poisoned (disadvantage on attacks)');
      }
    }

    // Prone attackers have disadvantage on attacks
    if (effects.appliedConditions.includes('Prone')) {
      hasDisadvantage = true;
      if (!reasons.some(r => r.includes('Prone'))) {
        reasons.push('Attacker is Prone (disadvantage on attacks)');
      }
    }

    // Restrained attackers have disadvantage
    if (effects.appliedConditions.includes('Restrained')) {
      hasDisadvantage = true;
      if (!reasons.some(r => r.includes('Restrained'))) {
        reasons.push('Attacker is Restrained (disadvantage on attacks)');
      }
    }

    return { hasAdvantage, hasDisadvantage, reasons };
  }

  /**
   * Get attack modifiers against a target based on target's conditions
   * Returns sources of advantage/disadvantage when attacking the target
   */
  static async getTargetModifiers(
    targetId: string,
    attackType: 'melee' | 'ranged' | 'spell',
    distanceInFeet?: number
  ): Promise<{
    hasAdvantage: boolean;
    hasDisadvantage: boolean;
    isAutoCrit: boolean;
    reasons: string[];
  }> {
    const effects = await this.getMechanicalEffects(targetId);
    const reasons: string[] = [];

    let hasAdvantage = false;
    let hasDisadvantage = false;
    let isAutoCrit = false;

    const isWithin5Feet = distanceInFeet === undefined || distanceInFeet <= 5;
    const isMelee = attackType === 'melee' || isWithin5Feet;

    // Check target's conditions that affect attacks against them
    if (effects.attacks_against === 'advantage') {
      hasAdvantage = true;
      reasons.push(`Advantage from target conditions: ${effects.appliedConditions.join(', ')}`);
    } else if (effects.attacks_against === 'disadvantage') {
      hasDisadvantage = true;
      reasons.push(`Disadvantage from target conditions: ${effects.appliedConditions.join(', ')}`);
    }

    // Blinded targets: Attackers have advantage
    if (effects.appliedConditions.includes('Blinded')) {
      hasAdvantage = true;
      reasons.push('Target is Blinded (advantage on attacks vs)');
    }

    // Restrained targets: Attackers have advantage
    if (effects.appliedConditions.includes('Restrained')) {
      hasAdvantage = true;
      reasons.push('Target is Restrained (advantage on attacks vs)');
    }

    // Stunned targets: Attackers have advantage
    if (effects.appliedConditions.includes('Stunned')) {
      hasAdvantage = true;
      reasons.push('Target is Stunned (advantage on attacks vs)');
    }

    // Prone targets: melee within 5ft = advantage, ranged = disadvantage
    if (effects.appliedConditions.includes('Prone')) {
      if (isMelee && isWithin5Feet) {
        hasAdvantage = true;
        reasons.push('Target is Prone (advantage on melee attacks within 5ft)');
      } else if (attackType === 'ranged' && !isWithin5Feet) {
        hasDisadvantage = true;
        reasons.push('Target is Prone (disadvantage on ranged attacks beyond 5ft)');
      }
    }

    // Paralyzed/Unconscious within 5ft: Auto-crit
    if (effects.attacks_against_within_5ft === 'critical_on_hit' && isWithin5Feet) {
      isAutoCrit = true;
      reasons.push('Target is Paralyzed/Unconscious within 5ft (auto-crit on hit)');
    }

    // Direct check for paralyzed/unconscious (redundant but explicit)
    if (
      (effects.appliedConditions.includes('Paralyzed') ||
        effects.appliedConditions.includes('Unconscious')) &&
      isWithin5Feet
    ) {
      isAutoCrit = true;
      hasAdvantage = true;
      if (!reasons.some(r => r.includes('auto-crit'))) {
        reasons.push('Target is Paralyzed/Unconscious within 5ft (auto-crit on hit, advantage)');
      }
    }

    return { hasAdvantage, hasDisadvantage, isAutoCrit, reasons };
  }

  /**
   * Get saving throw modifiers for a participant
   * Returns auto-fail or advantage/disadvantage for a specific save type
   */
  static async getSaveModifiers(
    participantId: string,
    saveAbility: SaveAbility
  ): Promise<{
    autoFail: boolean;
    hasAdvantage: boolean;
    hasDisadvantage: boolean;
    reasons: string[];
  }> {
    const effects = await this.getMechanicalEffects(participantId);
    const reasons: string[] = [];

    let autoFail = false;
    let hasAdvantage = false;
    let hasDisadvantage = false;

    // Map save ability to mechanical effect key
    const saveKey = `saving_throws_${saveAbility.slice(0, 3).toLowerCase()}` as keyof MechanicalEffects;
    const saveEffect = effects[saveKey];

    if (saveEffect === 'auto_fail') {
      autoFail = true;
      reasons.push(`Auto-fail ${saveAbility.toUpperCase()} saves from: ${effects.appliedConditions.join(', ')}`);
    } else if (saveEffect === 'disadvantage') {
      hasDisadvantage = true;
      reasons.push(`Disadvantage on ${saveAbility.toUpperCase()} saves from: ${effects.appliedConditions.join(', ')}`);
    } else if (saveEffect === 'advantage') {
      hasAdvantage = true;
      reasons.push(`Advantage on ${saveAbility.toUpperCase()} saves from: ${effects.appliedConditions.join(', ')}`);
    }

    // Paralyzed: Auto-fail STR and DEX saves
    if (
      effects.appliedConditions.includes('Paralyzed') &&
      (saveAbility === 'strength' || saveAbility === 'dexterity')
    ) {
      autoFail = true;
      if (!reasons.some(r => r.includes('Paralyzed'))) {
        reasons.push('Paralyzed (auto-fail STR/DEX saves)');
      }
    }

    // Unconscious: Auto-fail STR and DEX saves
    if (
      effects.appliedConditions.includes('Unconscious') &&
      (saveAbility === 'strength' || saveAbility === 'dexterity')
    ) {
      autoFail = true;
      if (!reasons.some(r => r.includes('Unconscious'))) {
        reasons.push('Unconscious (auto-fail STR/DEX saves)');
      }
    }

    // Stunned: Auto-fail STR and DEX saves
    if (
      effects.appliedConditions.includes('Stunned') &&
      (saveAbility === 'strength' || saveAbility === 'dexterity')
    ) {
      autoFail = true;
      if (!reasons.some(r => r.includes('Stunned'))) {
        reasons.push('Stunned (auto-fail STR/DEX saves)');
      }
    }

    // Restrained: Disadvantage on DEX saves
    if (effects.appliedConditions.includes('Restrained') && saveAbility === 'dexterity') {
      hasDisadvantage = true;
      if (!reasons.some(r => r.includes('Restrained'))) {
        reasons.push('Restrained (disadvantage on DEX saves)');
      }
    }

    return { autoFail, hasAdvantage, hasDisadvantage, reasons };
  }

  /**
   * Get ability check modifiers for a participant
   */
  static async getAbilityCheckModifiers(participantId: string): Promise<{
    hasDisadvantage: boolean;
    reasons: string[];
  }> {
    const effects = await this.getMechanicalEffects(participantId);
    const reasons: string[] = [];
    let hasDisadvantage = false;

    // Poisoned: Disadvantage on ability checks
    if (effects.appliedConditions.includes('Poisoned')) {
      hasDisadvantage = true;
      reasons.push('Poisoned (disadvantage on ability checks)');
    }

    // General ability check effects
    if (effects.ability_checks === 'disadvantage') {
      hasDisadvantage = true;
      reasons.push(`Disadvantage on ability checks from: ${effects.appliedConditions.join(', ')}`);
    }

    return { hasDisadvantage, reasons };
  }

  /**
   * Check if participant can take actions
   */
  static async canTakeActions(participantId: string): Promise<{
    canAct: boolean;
    canReact: boolean;
    reasons: string[];
  }> {
    const effects = await this.getMechanicalEffects(participantId);
    const reasons: string[] = [];

    let canAct = true;
    let canReact = true;

    // Check for incapacitated conditions
    const incapacitatingConditions = ['Incapacitated', 'Paralyzed', 'Petrified', 'Stunned', 'Unconscious'];
    for (const condition of incapacitatingConditions) {
      if (effects.appliedConditions.includes(condition)) {
        canAct = false;
        canReact = false;
        reasons.push(`${condition} (cannot take actions or reactions)`);
        break;
      }
    }

    // Check explicit action restrictions
    if (effects.actions === 'none') {
      canAct = false;
      reasons.push('Cannot take actions');
    }

    if (effects.reactions === 'none') {
      canReact = false;
      reasons.push('Cannot take reactions');
    }

    return { canAct, canReact, reasons };
  }

  /**
   * Get speed modifiers for a participant
   */
  static async getSpeedModifiers(participantId: string): Promise<{
    speedMultiplier: number;
    speedOverride?: number;
    reasons: string[];
  }> {
    const effects = await this.getMechanicalEffects(participantId);
    const reasons: string[] = [];

    let speedMultiplier = 1;
    let speedOverride: number | undefined;

    // Check for speed = 0 conditions
    if (
      effects.appliedConditions.includes('Paralyzed') ||
      effects.appliedConditions.includes('Petrified') ||
      effects.appliedConditions.includes('Stunned') ||
      effects.appliedConditions.includes('Unconscious') ||
      effects.appliedConditions.includes('Grappled') ||
      effects.appliedConditions.includes('Restrained')
    ) {
      speedOverride = 0;
      reasons.push('Speed reduced to 0 by condition');
    }

    // Prone: Must use crawl (costs extra movement)
    if (effects.appliedConditions.includes('Prone')) {
      speedMultiplier = 0.5; // Crawling costs double movement
      reasons.push('Prone (crawling costs extra movement)');
    }

    // Explicit speed value
    if (typeof effects.speed === 'number') {
      speedOverride = effects.speed;
      reasons.push(`Speed set to ${effects.speed} by condition`);
    }

    return { speedMultiplier, speedOverride, reasons };
  }

  /**
   * Merge two effect values, choosing the most restrictive
   */
  private static mergeEffectValues(
    current: string | number | boolean | undefined,
    incoming: string | number | boolean | undefined,
    key: string
  ): string | number | boolean | undefined {
    // For auto_fail, that always takes precedence
    if (current === 'auto_fail' || incoming === 'auto_fail') {
      return 'auto_fail';
    }

    // For advantage/disadvantage, disadvantage takes precedence
    if (
      (current === 'disadvantage' || incoming === 'disadvantage') &&
      (key.includes('attack') || key.includes('check') || key.includes('save'))
    ) {
      return 'disadvantage';
    }

    // For speed, the lowest (most restrictive) wins
    if (key === 'speed' && typeof current === 'number' && typeof incoming === 'number') {
      return Math.min(current, incoming);
    }

    // For actions/reactions 'none', that takes precedence
    if (current === 'none' || incoming === 'none') {
      return 'none';
    }

    // For boolean flags, true (more restrictive) takes precedence
    if (typeof current === 'boolean' && typeof incoming === 'boolean') {
      if (key.includes('cannot') || key.includes('negated')) {
        return current || incoming; // Either restriction applies
      }
    }

    // Default: incoming overrides
    return incoming;
  }
}
