import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getParticipantStatus } from '../participant-status';

const mockSingle = vi.fn();
const mockEq = vi.fn().mockReturnThis();
const mockSelect = vi.fn().mockReturnThis();
const mockFrom = vi.fn().mockReturnValue({
  select: mockSelect,
  eq: mockEq,
  single: mockSingle
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => mockFrom(table)
  }
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

describe('getParticipantStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({
      select: mockSelect,
      eq: mockEq,
      single: mockSingle
    });
    mockSelect.mockReturnThis();
    mockEq.mockReturnThis();
  });

  it('should return participant status when found', async () => {
    const mockData = {
      damage_resistances: ['fire'],
      damage_immunities: ['cold'],
      damage_vulnerabilities: ['acid'],
      combat_participant_status: {
        current_hp: 10,
        max_hp: 20,
        temp_hp: 5,
        is_conscious: true
      }
    };

    mockSingle.mockResolvedValue({ data: mockData, error: null });

    const result = await getParticipantStatus('test-id');

    expect(result).toEqual({
      current_hp: 10,
      max_hp: 20,
      temp_hp: 5,
      is_conscious: true,
      damage_resistances: ['fire'],
      damage_immunities: ['cold'],
      damage_vulnerabilities: ['acid']
    });
    expect(mockFrom).toHaveBeenCalledWith('combat_participants');
  });

  it('should return null when PGRST116 error occurs (not found)', async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: 'PGRST116', message: 'Not found' }
    });

    const result = await getParticipantStatus('test-id');

    expect(result).toBeNull();
  });

  it('should return null and log error for other database errors', async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: 'OTHER', message: 'Some database error' }
    });

    const result = await getParticipantStatus('test-id');

    expect(result).toBeNull();
  });

  it('should handle null resistances/immunities/vulnerabilities by returning empty arrays', async () => {
    const mockData = {
      damage_resistances: null,
      damage_immunities: null,
      damage_vulnerabilities: null,
      combat_participant_status: {
        current_hp: 10,
        max_hp: 20,
        temp_hp: 5,
        is_conscious: true
      }
    };

    mockSingle.mockResolvedValue({ data: mockData, error: null });

    const result = await getParticipantStatus('test-id');

    expect(result?.damage_resistances).toEqual([]);
    expect(result?.damage_immunities).toEqual([]);
    expect(result?.damage_vulnerabilities).toEqual([]);
  });

  it('should return null if participant data is null', async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });

    const result = await getParticipantStatus('test-id');

    expect(result).toBeNull();
  });

  it('should return null if combat_participant_status is missing', async () => {
    const mockData = {
      damage_resistances: [],
      damage_immunities: [],
      damage_vulnerabilities: [],
      combat_participant_status: null
    };

    mockSingle.mockResolvedValue({ data: mockData, error: null });

    const result = await getParticipantStatus('test-id');

    expect(result).toBeNull();
  });
});
