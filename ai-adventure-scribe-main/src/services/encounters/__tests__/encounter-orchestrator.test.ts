/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import generator from '../encounter-generator';
import { planAndValidateEncounter, concludeEncounter } from '../encounter-orchestrator';
import { loadMonsters } from '../srd-loader';
import { postEncounterTelemetry } from '../telemetry-client';

import { validateEncounterSpec } from '@/agents/rules/validators/encounter-validator';

// Mock dependencies
vi.mock('../encounter-generator', () => ({
  default: {
    generate: vi.fn(),
  },
}));

vi.mock('../srd-loader', () => ({
  loadMonsters: vi.fn(),
}));

vi.mock('../telemetry-client', () => ({
  postEncounterTelemetry: vi.fn(),
}));

vi.mock('@/agents/rules/validators/encounter-validator', () => ({
  validateEncounterSpec: vi.fn(),
}));

describe('encounter-orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('planAndValidateEncounter', () => {
    it('should generate, load monsters, and validate the encounter', async () => {
      // Arrange
      const mockInput = {
        party: { members: [{ level: 1 }] },
        world: { biome: 'forest' },
      } as any;

      const mockSpec = { id: 'mock-spec' } as any;
      const mockMonsters = [{ id: 'monster-1' }] as any;
      const mockValidation = { ok: true, issues: [], effectiveXp: 100 };

      (generator.generate as any).mockReturnValue(mockSpec);
      (loadMonsters as any).mockReturnValue(mockMonsters);
      (validateEncounterSpec as any).mockReturnValue(mockValidation);

      // Act
      const result = await planAndValidateEncounter(mockInput);

      // Assert
      expect(generator.generate).toHaveBeenCalledWith(mockInput);
      expect(loadMonsters).toHaveBeenCalled();
      expect(validateEncounterSpec).toHaveBeenCalledWith(mockSpec, mockMonsters, mockInput.party);
      expect(result).toEqual({
        spec: mockSpec,
        validation: mockValidation,
      });
    });
  });

  describe('concludeEncounter', () => {
    it('should post telemetry with correct data', async () => {
      // Arrange
      const mockParams = {
        sessionId: 'session-123',
        spec: { difficulty: 'hard' } as any,
        resourcesUsedEst: 0.5,
      };

      (postEncounterTelemetry as any).mockResolvedValue({ ok: true });

      // Act
      await concludeEncounter(mockParams);

      // Assert
      expect(postEncounterTelemetry).toHaveBeenCalledWith({
        sessionId: 'session-123',
        difficulty: 'hard',
        resourcesUsedEst: 0.5,
      });
    });

    it('should throw if telemetry fails', async () => {
      // Arrange
      const mockParams = {
        sessionId: 'session-123',
        spec: { difficulty: 'hard' } as any,
        resourcesUsedEst: 0.5,
      };

      (postEncounterTelemetry as any).mockRejectedValue(new Error('Telemetry failed'));

      // Act & Assert
      await expect(concludeEncounter(mockParams)).rejects.toThrow('Telemetry failed');
    });
  });
});
