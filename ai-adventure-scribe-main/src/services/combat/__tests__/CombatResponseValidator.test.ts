 
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CombatResponseValidator, type CombatStateProvider } from '../CombatResponseValidator';

describe('CombatResponseValidator', () => {
  let validator: CombatResponseValidator;
  let mockStateProvider: CombatStateProvider;

  beforeEach(() => {
    mockStateProvider = {
      hasPendingAttack: vi.fn().mockReturnValue(false),
      hasInitiativeBeenRolled: vi.fn().mockReturnValue(false),
      isCombatActive: vi.fn().mockReturnValue(false),
      isInitiativePhaseComplete: vi.fn().mockReturnValue(false),
      isAwaitingDamage: vi.fn().mockReturnValue(false),
    };
    validator = new CombatResponseValidator(mockStateProvider);
    vi.clearAllMocks();
  });

  describe('Direct Damage Validation', () => {
    it('should return error when direct damage is detected without a pending attack', () => {
      const response = 'You take 10 damage from the trap.';
      const result = validator.validate(response);

      expect(result.isValid).toBe(false);
      const error = result.errors.find(e => e.type === 'missing_attack_roll');
      expect(error).toBeDefined();
      expect(error?.severity).toBe('critical');
    });

    it('should be valid when direct damage is detected and there is a pending attack', () => {
      mockStateProvider.hasPendingAttack = vi.fn().mockReturnValue(true);
      const response = 'You take 10 points of damage.';
      const result = validator.validate(response);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Combat Start Validation', () => {
    it('should return error when combat starts without initiative being rolled', () => {
      const combatId = 'test-combat';
      mockStateProvider.hasInitiativeBeenRolled = vi.fn().mockReturnValue(false);

      const response = 'Combat begins! The orcs charge towards you.';
      const result = validator.validate(response, combatId);

      expect(result.isValid).toBe(false);
      const error = result.errors.find(e => e.type === 'missing_initiative');
      expect(error).toBeDefined();
      expect(error?.severity).toBe('critical');
    });

    it('should be valid when combat starts and initiative has been rolled', () => {
      const combatId = 'test-combat';
      mockStateProvider.hasInitiativeBeenRolled = vi.fn().mockReturnValue(true);

      const response = 'Combat begins!';
      const result = validator.validate(response, combatId);

      expect(result.isValid).toBe(true);
    });
  });

  describe('Sequence Validation', () => {
    it('should return error when action is attempted before initiative is complete', () => {
      const combatId = 'test-combat';
      mockStateProvider.isCombatActive = vi.fn().mockReturnValue(true);
      mockStateProvider.isInitiativePhaseComplete = vi.fn().mockReturnValue(false);

      const response = 'Make an attack roll with your sword.';
      const result = validator.validate(response, combatId);

      expect(result.isValid).toBe(false);
      const error = result.errors.find(e => e.type === 'wrong_sequence');
      expect(error).toBeDefined();
      expect(error?.severity).toBe('critical');
    });

    it('should be valid when action is attempted and initiative is complete', () => {
      const combatId = 'test-combat';
      mockStateProvider.isCombatActive = vi.fn().mockReturnValue(true);
      mockStateProvider.isInitiativePhaseComplete = vi.fn().mockReturnValue(true);

      // We also need AC for a valid attack request
      const response = 'Roll an attack against AC 15.';
      const result = validator.validate(response, combatId);

      expect(result.isValid).toBe(true);
    });
  });

  describe('Attack Request Validation', () => {
    it('should return error when attack is requested without target AC', () => {
      const response = 'Make an attack roll with your bow.';
      const result = validator.validate(response);

      expect(result.isValid).toBe(false);
      const error = result.errors.find(e => e.type === 'missing_ac');
      expect(error).toBeDefined();
      expect(error?.severity).toBe('high');
    });

    it('should be valid when attack is requested with target AC', () => {
      const response = 'Make an attack against AC 14.';
      const result = validator.validate(response);

      expect(result.isValid).toBe(true);
    });
  });

  describe('Skill Check Validation', () => {
    it('should return error when skill check is requested without DC', () => {
      const response = 'Roll an Athletics check.';
      const result = validator.validate(response);

      expect(result.isValid).toBe(false);
      const error = result.errors.find(e => e.type === 'missing_dc');
      expect(error).toBeDefined();
      expect(error?.severity).toBe('high');
    });

    it('should be valid when skill check is requested with DC', () => {
      const response = 'Make a Perception check (DC 15).';
      const result = validator.validate(response);

      expect(result.isValid).toBe(true);
    });
  });

  describe('Damage Request Validation', () => {
    it('should return warning when damage is requested without modifier', () => {
      // Mock pending attack so it doesn't fail on missing_attack_roll
      mockStateProvider.hasPendingAttack = vi.fn().mockReturnValue(true);

      const response = 'Roll 1d8 damage.';
      const result = validator.validate(response);

      expect(result.isValid).toBe(true);
      const warning = result.warnings.find(w => w.type === 'missing_modifier');
      expect(warning).toBeDefined();
      expect(warning?.severity).toBe('medium');
    });

    it('should be valid when damage is requested with modifier', () => {
      mockStateProvider.hasPendingAttack = vi.fn().mockReturnValue(true);

      const response = 'Roll 1d8+3 damage.';
      const result = validator.validate(response);

      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('Next Action and Suggested Response', () => {
    it('should suggest requesting initiative when needed', () => {
      const combatId = 'test-combat';
      mockStateProvider.isCombatActive = vi.fn().mockReturnValue(true);
      mockStateProvider.hasInitiativeBeenRolled = vi.fn().mockReturnValue(false);

      const result = validator.validate('Hello', combatId);
      expect(result.requiredNextAction).toBe('request_initiative');
    });

    it('should suggest requesting damage when awaiting damage', () => {
      const combatId = 'test-combat';
      mockStateProvider.isCombatActive = vi.fn().mockReturnValue(true);
      mockStateProvider.hasInitiativeBeenRolled = vi.fn().mockReturnValue(true);
      mockStateProvider.isAwaitingDamage = vi.fn().mockReturnValue(true);

      const result = validator.validate('That hits!', combatId);
      expect(result.requiredNextAction).toBe('request_damage');
    });

    it('should provide suggested response for errors', () => {
      const response = 'Roll an Athletics check.';
      const result = validator.validate(response);

      expect(result.suggestedResponse).toBeDefined();
      expect(result.suggestedResponse).toContain('DC [number]');
    });
  });
});
