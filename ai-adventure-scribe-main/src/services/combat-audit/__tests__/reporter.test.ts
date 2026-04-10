import { describe, it, expect } from 'vitest';

import { generateAuditReport } from '../reporter';

import type { CombatAction, RuleViolation } from '../types';

describe('combat-audit reporter', () => {
  const combatId = 'test-combat';

  const createMockAction = (overrides: Partial<CombatAction> = {}): CombatAction => ({
    id: 'a1',
    combatId,
    timestamp: Date.now(),
    actorId: 'p1',
    actorName: 'Player 1',
    actionType: 'attack_roll',
    phase: 'turn',
    data: { description: 'attack' },
    ...overrides,
  });

  const createMockViolation = (overrides: Partial<RuleViolation> = {}): RuleViolation => ({
    id: 'v1',
    combatId,
    timestamp: Date.now(),
    violationType: 'missing_initiative',
    severity: 'critical',
    description: 'missing initiative',
    suggestion: 'roll initiative',
    ruleReference: 'PHB p.189',
    autoFixable: true,
    ...overrides,
  });

  it('should generate a report with no violations', () => {
    const actions = [createMockAction()];
    const report = generateAuditReport(combatId, actions, [], false);

    expect(report.complianceScore).toBe(100);
    expect(report.recommendations).toContain('✅ Excellent D&D 5e rule compliance! No major issues found.');
  });

  it('should calculate compliance score based on violation severity', () => {
    const violations = [
      createMockViolation({ severity: 'critical' }), // -20
      createMockViolation({ severity: 'high', violationType: 'missing_ac' }), // -10
      createMockViolation({ severity: 'medium', violationType: 'invalid_formula' }), // -5
    ];

    const report = generateAuditReport(combatId, [], violations, false);
    expect(report.complianceScore).toBe(65);
  });

  it('should generate correct recommendations based on violations', () => {
    const violations = [
      createMockViolation({ violationType: 'missing_initiative' }),
      createMockViolation({ violationType: 'damage_without_attack' }),
      createMockViolation({ violationType: 'missing_modifiers' }),
      createMockViolation({ violationType: 'missing_ac' }),
      createMockViolation({ violationType: 'missing_dc' }),
    ];

    const report = generateAuditReport(combatId, [], violations, false);

    expect(report.recommendations).toContain('🎲 Always start combat with initiative rolls (1d20+dex modifier) for all participants.');
    expect(report.recommendations).toContain('⚔️ Follow proper attack sequence: Attack roll → Hit confirmation → Damage roll.');
    expect(report.recommendations).toContain('🎯 Include modifiers in dice formulas: "1d20+5" not "1d20", "1d8+3" not "1d8".');
    expect(report.recommendations).toContain('🛡️ Always specify target AC when requesting attack rolls.');
    expect(report.recommendations).toContain('🎲 Always specify a DC for saving throws or skill checks.');
    expect(report.recommendations).toContain('🚨 Address critical rule violations first, as they break core game mechanics.');
  });

  it('should handle ongoing combat with no end time', () => {
    const actions = [createMockAction()];
    const report = generateAuditReport(combatId, actions, [], true);
    expect(report.endTime).toBeUndefined();
  });

  it('should handle empty actions list', () => {
    const report = generateAuditReport(combatId, [], [], false);
    expect(report.totalActions).toBe(0);
    expect(report.complianceScore).toBe(100);
  });
});
