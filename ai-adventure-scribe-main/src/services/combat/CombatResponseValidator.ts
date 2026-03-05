import {
  detectsDirectDamage,
  detectsCombatStart,
  detectsAttackRequest,
  detectsSkillCheck,
  detectsDamageRequest,
  containsAC,
  containsDC,
  containsModifier,
} from '@/services/combat/dm-response-patterns';

export interface CombatValidationError {
  type:
    | 'missing_initiative'
    | 'missing_attack_roll'
    | 'missing_damage_roll'
    | 'missing_ac'
    | 'missing_dc'
    | 'missing_modifier'
    | 'wrong_sequence';
  message: string;
  suggestion: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface CombatValidationResult {
  isValid: boolean;
  errors: CombatValidationError[];
  warnings: CombatValidationError[];
  requiredNextAction?: string;
  suggestedResponse?: string;
}

export interface CombatStateProvider {
  hasPendingAttack(combatId?: string): boolean;
  hasInitiativeBeenRolled(combatId: string): boolean;
  isCombatActive(combatId: string): boolean;
  isInitiativePhaseComplete(combatId: string): boolean;
  isAwaitingDamage(combatId?: string): boolean;
}

export class CombatResponseValidator {
  constructor(private stateProvider: CombatStateProvider) {}

  /**
   * Validate a DM response for combat rule compliance
   */
  validate(response: string, combatId?: string): CombatValidationResult {
    const errors: CombatValidationError[] = [];
    const warnings: CombatValidationError[] = [];

    // Check for direct damage without attack roll
    if (detectsDirectDamage(response) && !this.stateProvider.hasPendingAttack(combatId)) {
      errors.push({
        type: 'missing_attack_roll',
        message: 'Damage roll requested without preceding attack roll',
        suggestion:
          'Request attack roll first: "Make an attack roll with your [weapon] (1d20+bonus) against AC [number]"',
        severity: 'critical',
      });
    }

    // Check for combat start without initiative
    if (
      detectsCombatStart(response) &&
      combatId &&
      !this.stateProvider.hasInitiativeBeenRolled(combatId)
    ) {
      errors.push({
        type: 'missing_initiative',
        message: 'Combat started without initiative roll',
        suggestion:
          'Request initiative first: "Combat begins! Roll initiative (1d20+dex modifier)"',
        severity: 'critical',
      });
    }

    // Check for actions attempted before turn order is established
    if (combatId && this.stateProvider.isCombatActive(combatId)) {
      if (
        !this.stateProvider.isInitiativePhaseComplete(combatId) &&
        (detectsAttackRequest(response) || detectsSkillCheck(response))
      ) {
        errors.push({
          type: 'wrong_sequence',
          message: 'Action attempted before initiative order is established',
          suggestion:
            'Complete initiative phase first: "Roll initiative (1d20+dex modifier) to determine turn order"',
          severity: 'critical',
        });
      }
    }

    // Check for attack without AC
    if (detectsAttackRequest(response) && !containsAC(response)) {
      errors.push({
        type: 'missing_ac',
        message: 'Attack roll requested without target AC',
        suggestion: 'Include target AC: "Make an attack roll against AC [number]"',
        severity: 'high',
      });
    }

    // Check for skill check without DC
    if (detectsSkillCheck(response) && !containsDC(response)) {
      errors.push({
        type: 'missing_dc',
        message: 'Skill check requested without DC',
        suggestion: 'Include DC: "Make a [skill] check (DC [number])"',
        severity: 'high',
      });
    }

    // Check for damage roll without modifier
    if (detectsDamageRequest(response) && !containsModifier(response)) {
      warnings.push({
        type: 'missing_modifier',
        message: 'Damage roll missing ability modifier',
        suggestion: 'Include modifier: "Roll 1d8+STR modifier" or "Roll 1d6+3"',
        severity: 'medium',
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      requiredNextAction: this.determineNextAction(combatId),
      suggestedResponse: this.generateSuggestedResponse(errors),
    };
  }

  private determineNextAction(combatId?: string): string | undefined {
    if (combatId && this.stateProvider.isCombatActive(combatId)) {
      if (!this.stateProvider.hasInitiativeBeenRolled(combatId)) {
        return 'request_initiative';
      }
      if (this.stateProvider.isAwaitingDamage(combatId)) {
        return 'request_damage';
      }
    }
    return undefined;
  }

  private generateSuggestedResponse(errors: CombatValidationError[]): string | undefined {
    if (errors.length === 0) return undefined;

    const primaryError = errors[0];
    switch (primaryError.type) {
      case 'missing_attack_roll':
        return 'Make an attack roll with your weapon (1d20+attack bonus) against AC [number]';
      case 'missing_initiative':
        return 'Combat begins! Roll initiative (1d20+dex modifier)';
      case 'missing_ac':
        return 'Make an attack roll with your weapon (1d20+bonus) against AC [target number]';
      case 'missing_dc':
        return 'Make a [skill] check (1d20+modifier, DC [number])';
      default:
        return primaryError.suggestion;
    }
  }
}
