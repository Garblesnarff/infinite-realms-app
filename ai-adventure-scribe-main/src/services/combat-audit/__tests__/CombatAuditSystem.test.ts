import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CombatAuditSystem } from '../index';

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('CombatAuditSystem', () => {
  let auditSystem: CombatAuditSystem;
  const combatId = 'test-combat-123';

  beforeEach(() => {
    vi.clearAllMocks();
    auditSystem = CombatAuditSystem.getInstance();
    auditSystem.clearAuditData();
  });

  it('should be a singleton', () => {
    const instance1 = CombatAuditSystem.getInstance();
    const instance2 = CombatAuditSystem.getInstance();
    expect(instance1).toBe(instance2);
  });

  describe('startCombatAudit', () => {
    it('should initialize audit data for a combat encounter', () => {
      auditSystem.startCombatAudit(combatId);
      expect(auditSystem.getAuditTrail(combatId)).toEqual([]);
      expect(auditSystem.getViolations(combatId)).toEqual([]);
    });
  });

  describe('recordAction', () => {
    it('should record an action and trigger validation', () => {
      auditSystem.startCombatAudit(combatId);

      const actionId = auditSystem.recordAction({
        combatId,
        actorId: 'p1',
        actorName: 'Hero',
        actionType: 'attack_roll',
        phase: 'combat',
        data: { targetAC: 15, formula: '1d20+5' }
      });

      expect(actionId).toBeDefined();
      const trail = auditSystem.getAuditTrail(combatId);
      expect(trail).toHaveLength(1);
      expect(trail[0].actorName).toBe('Hero');

      // Should have a violation because initiative was not rolled
      const violations = auditSystem.getViolations(combatId);
      expect(violations).toHaveLength(1);
      expect(violations[0].violationType).toBe('missing_initiative');
    });

    it('should record initiative and not flag it', () => {
      auditSystem.startCombatAudit(combatId);

      auditSystem.recordAction({
        combatId,
        actorId: 'p1',
        actorName: 'Hero',
        actionType: 'initiative',
        phase: 'pre-combat',
        data: { formula: '1d20+2' }
      });

      const violations = auditSystem.getViolations(combatId);
      expect(violations).toHaveLength(0);
    });
  });

  describe('generateAuditReport', () => {
    it('should generate a report with compliance score', () => {
      auditSystem.startCombatAudit(combatId);

      // Record initiative (Valid)
      auditSystem.recordAction({
        combatId,
        actorId: 'p1',
        actorName: 'Hero',
        actionType: 'initiative',
        phase: 'pre-combat',
        data: { formula: '1d20+2' }
      });

      // Record attack (Valid)
      auditSystem.recordAction({
        combatId,
        actorId: 'p1',
        actorName: 'Hero',
        actionType: 'attack_roll',
        phase: 'combat',
        data: { targetAC: 15, formula: '1d20+5', success: true }
      });

      const report = auditSystem.generateAuditReport(combatId);
      expect(report.combatId).toBe(combatId);
      expect(report.totalActions).toBe(2);
      expect(report.complianceScore).toBe(100);
      expect(report.summary.initiativeCompliance).toBe(true);
    });

    it('should calculate lower compliance score for violations', () => {
      auditSystem.startCombatAudit(combatId);

      // Attack without initiative (Critical violation: -20)
      auditSystem.recordAction({
        combatId,
        actorId: 'p1',
        actorName: 'Hero',
        actionType: 'attack_roll',
        phase: 'combat',
        data: { targetAC: 15, formula: '1d20+5' }
      });

      const report = auditSystem.generateAuditReport(combatId);
      expect(report.complianceScore).toBe(80);
      expect(report.violations).toHaveLength(1);
    });
  });

  describe('endCombatAudit', () => {
    it('should end the audit and return final report', () => {
      auditSystem.startCombatAudit(combatId);
      const report = auditSystem.endCombatAudit(combatId);
      expect(report.endTime).toBeDefined();
    });
  });
});
