/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAppendRollEvent } = vi.hoisted(() => ({
  mockAppendRollEvent: vi.fn().mockResolvedValue(undefined),
}));

const { mockRecordRollResult, mockRecordRollRequest } = vi.hoisted(() => ({
  mockRecordRollResult: vi.fn().mockResolvedValue(undefined),
  mockRecordRollRequest: vi.fn().mockResolvedValue(undefined),
}));

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/services/session-state-service', () => ({
  SessionStateService: {
    appendRollEvent: mockAppendRollEvent,
  },
}));

vi.mock('@/services/roll-manager', () => ({
  RollManager: {
    recordRollResult: mockRecordRollResult,
    recordRollRequest: mockRecordRollRequest,
  },
}));

vi.mock('@/lib/logger', () => ({
  default: mockLogger,
  logger: mockLogger,
}));

import {
  logDiceRollResult,
  logTextRollResult,
  logIncomingRolls,
  logRollRequests,
} from '../session-logger';

describe('session-logger', () => {
  const sessionId = 'test-session-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('logDiceRollResult', () => {
    it('should log a structured dice roll to session state and roll manager', async () => {
      const diceRoll = {
        formula: '1d20+5',
        total: 15,
        naturalRoll: 10,
        advantage: false,
        disadvantage: false,
        results: [10],
        requestType: 'skill_check',
        description: 'Athletics Check',
        dc: 16,
        success: false,
      };

      await logDiceRollResult(sessionId, diceRoll);

      expect(mockAppendRollEvent).toHaveBeenCalledWith(sessionId, {
        kind: 'roll_result',
        payload: diceRoll,
      });

      expect(mockRecordRollResult).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId,
          kind: 'check',
          resultTotal: 15,
          resultNatural: 10,
          dc: 16,
          success: false,
        }),
      );
    });

    it('should handle missing numeric values with fallbacks', async () => {
      const diceRoll = { formula: '1d20' };
      await logDiceRollResult(sessionId, diceRoll);

      expect(mockRecordRollResult).toHaveBeenCalledWith(
        expect.objectContaining({
          resultTotal: 0,
          resultNatural: undefined,
        }),
      );
    });
  });

  describe('logTextRollResult', () => {
    it('should parse "I rolled 15" pattern', async () => {
      await logTextRollResult(sessionId, 'I rolled 15');
      expect(mockRecordRollResult).toHaveBeenCalledWith(
        expect.objectContaining({
          resultTotal: 15,
        }),
      );
    });

    it('should parse "rolled 12" pattern', async () => {
      await logTextRollResult(sessionId, 'someone rolled a 12 in the chat');
      expect(mockRecordRollResult).toHaveBeenCalledWith(
        expect.objectContaining({
          resultTotal: 12,
        }),
      );
    });

    it('should parse "total: 20" pattern', async () => {
      await logTextRollResult(sessionId, 'The total: 20 for my check');
      expect(mockRecordRollResult).toHaveBeenCalledWith(
        expect.objectContaining({
          resultTotal: 20,
        }),
      );
    });

    it('should parse "= 5" pattern', async () => {
      await logTextRollResult(sessionId, '1d20 + 4 = 5');
      expect(mockRecordRollResult).toHaveBeenCalledWith(
        expect.objectContaining({
          resultTotal: 5,
        }),
      );
    });

    it('should not log if no pattern matches', async () => {
      await logTextRollResult(sessionId, 'Hello world');
      expect(mockRecordRollResult).not.toHaveBeenCalled();
    });

    it('should handle empty text gracefully', async () => {
      await logTextRollResult(sessionId, '');
      expect(mockRecordRollResult).not.toHaveBeenCalled();
    });
  });

  describe('logIncomingRolls', () => {
    it('should log structured roll if intent is dice_roll', async () => {
      const message: any = {
        text: 'I rolled 15',
        context: {
          intent: 'dice_roll',
          diceRoll: { total: 15, formula: '1d20+5' },
        },
      };

      await logIncomingRolls(sessionId, message);

      expect(mockAppendRollEvent).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          kind: 'roll_result',
          payload: message.context.diceRoll,
        }),
      );
    });

    it('should fallback to text parsing if intent is not dice_roll', async () => {
      const message: any = {
        text: 'I rolled 15',
        context: {
          intent: 'response',
        },
      };

      await logIncomingRolls(sessionId, message);

      expect(mockRecordRollResult).toHaveBeenCalledWith(
        expect.objectContaining({
          resultTotal: 15,
        }),
      );
    });

    it('should handle missing text gracefully', async () => {
      const message: any = {
        text: null,
        context: {
          intent: 'response',
        },
      };

      await logIncomingRolls(sessionId, message);
      expect(mockRecordRollResult).not.toHaveBeenCalled();
    });

    it('should not throw on error', async () => {
      mockAppendRollEvent.mockRejectedValueOnce(new Error('DB Error'));
      const message: any = {
        text: 'I rolled 15',
        context: { intent: 'dice_roll', diceRoll: { total: 15 } },
      };

      await expect(logIncomingRolls(sessionId, message)).resolves.not.toThrow();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('logRollRequests', () => {
    it('should log multiple roll requests', async () => {
      const requests: any[] = [
        { type: 'check', purpose: 'Stealth', formula: '1d20+2' },
        { type: 'save', purpose: 'Dexterity', formula: '1d20+3', dc: 15 },
      ];

      await logRollRequests(sessionId, requests);

      // Verify SessionStateService was called
      expect(mockAppendRollEvent).toHaveBeenCalledWith(sessionId, {
        kind: 'roll_requests',
        payload: requests,
      });

      // Verify RollManager.recordRollRequest was called for each request
      expect(mockRecordRollRequest).toHaveBeenCalledTimes(2);
      expect(mockRecordRollRequest).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          kind: 'check',
          purpose: 'Stealth',
          formula: '1d20+2',
        }),
      );
      expect(mockRecordRollRequest).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          kind: 'save',
          purpose: 'Dexterity',
          formula: '1d20+3',
          dc: 15,
        }),
      );
    });

    it('should return early if no requests', async () => {
      await logRollRequests(sessionId, []);
      expect(mockAppendRollEvent).not.toHaveBeenCalled();
    });

    it('should handle unknown request types as "check"', async () => {
      const requests: any[] = [{ type: 'unknown', purpose: 'Testing' }];
      await logRollRequests(sessionId, requests);
      expect(mockRecordRollRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'check',
        }),
      );
    });

    it('should not throw on error', async () => {
      mockAppendRollEvent.mockRejectedValueOnce(new Error('DB Error'));
      const requests: any[] = [{ type: 'check', purpose: 'Stealth' }];

      await expect(logRollRequests(sessionId, requests)).resolves.not.toThrow();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });
});
