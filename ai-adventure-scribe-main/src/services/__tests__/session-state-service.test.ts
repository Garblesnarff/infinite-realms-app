/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionStateService } from '../session-state-service';
import { supabase } from '@/integrations/supabase/client';
import { createDefaultSessionState } from '@/types/session-state';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('SessionStateService', () => {
  const sessionId = 'test-session-id';
  const now = '2024-05-24T12:00:00.000Z';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
  });

  describe('getState', () => {
    it('should return session state from Supabase if available', async () => {
      const mockState = { ...createDefaultSessionState(sessionId), scene: 'Current Scene' };

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { session_state: mockState }, error: null }),
      });
      (supabase.from as any).mockImplementation(mockFrom);

      const result = await SessionStateService.getState(sessionId);

      expect(result).toEqual(mockState);
      expect(supabase.from).toHaveBeenCalledWith('game_sessions');
    });

    it('should return default state if Supabase returns an error', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
      });
      (supabase.from as any).mockImplementation(mockFrom);

      const result = await SessionStateService.getState(sessionId);

      expect(result).toEqual(createDefaultSessionState(sessionId));
    });

    it('should return default state if session_state is null', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { session_state: null }, error: null }),
      });
      (supabase.from as any).mockImplementation(mockFrom);

      const result = await SessionStateService.getState(sessionId);

      expect(result).toEqual(createDefaultSessionState(sessionId));
    });

    it('should return default state if an exception is thrown', async () => {
      (supabase.from as any).mockImplementation(() => {
        throw new Error('Network error');
      });

      const result = await SessionStateService.getState(sessionId);

      expect(result).toEqual(createDefaultSessionState(sessionId));
    });
  });

  describe('updateState', () => {
    it('should merge partial updates and update lastUpdate timestamp', async () => {
      const currentState = createDefaultSessionState(sessionId);
      const partial = { scene: 'New Scene' };
      const expectedNext = {
        ...currentState,
        ...partial,
        lastUpdate: now,
      };

      // Mock getState
      vi.spyOn(SessionStateService, 'getState').mockResolvedValue(currentState);

      const mockFrom = vi.fn().mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        // session-state-service.ts doesn't call .single() on update, but the chain should handle it if it did
        // Actually looking at the source:
        /*
        const { error } = await supabase
        .from('game_sessions')
        .update({ session_state: next })
        .eq('id', sessionId);
        */
      });
      (supabase.from as any).mockImplementation(mockFrom);

      const result = await SessionStateService.updateState(sessionId, partial);

      expect(result).toEqual(expectedNext);
      expect(supabase.from).toHaveBeenCalledWith('game_sessions');
    });

    it('should return merged snapshot even if Supabase update fails', async () => {
       const currentState = createDefaultSessionState(sessionId);
      const partial = { scene: 'Failed Update Scene' };
      const expectedNext = {
        ...currentState,
        ...partial,
        lastUpdate: now,
      };

      vi.spyOn(SessionStateService, 'getState').mockResolvedValue(currentState);

      const mockFrom = vi.fn().mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      });
      // Mock update to return error
      (mockFrom() as any).update.mockReturnValueOnce({
        eq: vi.fn().mockResolvedValue({ error: { message: 'Update failed' } })
      });
      (supabase.from as any).mockImplementation(mockFrom);

      const result = await SessionStateService.updateState(sessionId, partial);

      expect(result).toEqual(expectedNext);
    });

    it('should handle exceptions during update by returning current state merged with partial', async () => {
      const currentState = createDefaultSessionState(sessionId);
      const partial = { scene: 'Exception Scene' };

      vi.spyOn(SessionStateService, 'getState').mockResolvedValue(currentState);

      (supabase.from as any).mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const result = await SessionStateService.updateState(sessionId, partial);

      expect(result.scene).toBe('Exception Scene');
      expect(result.lastUpdate).toBe(now);
    });
  });

  describe('appendCombatLog', () => {
    it('should append a timestamped entry to the combat log', async () => {
      const currentState = createDefaultSessionState(sessionId);
      const entry = 'Player deals 10 damage';

      vi.spyOn(SessionStateService, 'getState').mockResolvedValue(currentState);

      const updateSpy = vi.fn().mockReturnThis();
      const eqSpy = vi.fn().mockResolvedValue({ error: null });
      const mockFrom = vi.fn().mockReturnValue({
        update: updateSpy,
        eq: eqSpy,
      });
      (supabase.from as any).mockImplementation(mockFrom);

      await SessionStateService.appendCombatLog(sessionId, entry);

      const expectedUpdatedState = {
        ...currentState,
        combatLog: [{ timestamp: now, entry }],
        lastUpdate: now,
      };

      expect(supabase.from).toHaveBeenCalledWith('game_sessions');
      expect(updateSpy).toHaveBeenCalledWith({ session_state: expectedUpdatedState });
    });

    it('should trim the log when it exceeds maxEntries', async () => {
      const existingLog = Array.from({ length: 5 }, (_, i) => ({ timestamp: 'old', entry: `entry ${i}` }));
      const currentState = { ...createDefaultSessionState(sessionId), combatLog: existingLog };
      const entry = 'Newest entry';

      vi.spyOn(SessionStateService, 'getState').mockResolvedValue(currentState);

      const updateSpy = vi.fn().mockReturnThis();
      const eqSpy = vi.fn().mockResolvedValue({ error: null });
      const mockFrom = vi.fn().mockReturnValue({
        update: updateSpy,
        eq: eqSpy,
      });
      (supabase.from as any).mockImplementation(mockFrom);

      // Set maxEntries to 3
      await SessionStateService.appendCombatLog(sessionId, entry, 3);

      const expectedLog = [
        { timestamp: 'old', entry: 'entry 3' },
        { timestamp: 'old', entry: 'entry 4' },
        { timestamp: now, entry },
      ];

      const expectedUpdatedState = {
        ...currentState,
        combatLog: expectedLog,
        lastUpdate: now,
      };

      expect(updateSpy).toHaveBeenCalledWith({ session_state: expectedUpdatedState });
    });

    it('should fail silently if an exception occurs during append', async () => {
      const currentState = createDefaultSessionState(sessionId);
      vi.spyOn(SessionStateService, 'getState').mockResolvedValue(currentState);

      (supabase.from as any).mockImplementation(() => {
        throw new Error('Silent failure');
      });

      // Should not throw
      await expect(SessionStateService.appendCombatLog(sessionId, 'some entry')).resolves.not.toThrow();
    });

    it('should handle missing combatLog in current state', async () => {
      const currentState = createDefaultSessionState(sessionId);
      delete (currentState as any).combatLog;

      vi.spyOn(SessionStateService, 'getState').mockResolvedValue(currentState);

      const updateSpy = vi.fn().mockReturnThis();
      const eqSpy = vi.fn().mockResolvedValue({ error: null });
      const mockFrom = vi.fn().mockReturnValue({
        update: updateSpy,
        eq: eqSpy,
      });
      (supabase.from as any).mockImplementation(mockFrom);

      await SessionStateService.appendCombatLog(sessionId, 'new entry');

      const expectedUpdatedState = {
        ...currentState,
        combatLog: [{ timestamp: now, entry: 'new entry' }],
        lastUpdate: now,
      };

      expect(updateSpy).toHaveBeenCalledWith({ session_state: expectedUpdatedState });
    });
  });

  describe('appendRollEvent', () => {
    it('should delegate to appendCombatLog with formatted payload', async () => {
      const event = { kind: 'attack', payload: { roll: 15 } };
      const appendCombatLogSpy = vi.spyOn(SessionStateService, 'appendCombatLog').mockResolvedValue(undefined);

      await SessionStateService.appendRollEvent(sessionId, event);

      expect(appendCombatLogSpy).toHaveBeenCalledWith(sessionId, { kind: 'attack', payload: { roll: 15 } });
    });
  });
});
