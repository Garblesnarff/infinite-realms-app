/**
 * #2233: the encounter tracker's Cast Spell button threw "Cannot read properties of undefined
 * (reading 'spellSlots')" — `castSpell` is async and its Promise was destructured unawaited.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleSpellCast, NO_SPELL_CHOSEN_GUIDANCE } from '../action-handlers';

import type { CombatParticipant } from '@/types/combat';

import { castSpell } from '@/utils/spell-management';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/utils/spell-management', () => ({ castSpell: vi.fn() }));

const apprentice = {
  id: 'the-apprentice',
  name: 'The Apprentice',
  participantType: 'player',
  spellSlots: { 1: { max: 2, current: 2 } },
  activeConcentration: null,
} as unknown as CombatParticipant;

describe('handleSpellCast (encounter tracker Cast Spell)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('explains where to cast when the button carries no spell, and spends nothing', async () => {
    const result = await handleSpellCast(
      { description: 'The Apprentice attempts to cast_spell' },
      apprentice,
    );

    expect(result.success).toBe(false);
    expect(result.participantUpdates).toEqual({});
    expect(result.actionUpdates.description).toContain(NO_SPELL_CHOSEN_GUIDANCE);
    expect(result.actionUpdates.description).not.toMatch(/Cannot read properties/);
    expect(castSpell).not.toHaveBeenCalled();
  });

  it('awaits the cast and applies its slot update', async () => {
    vi.mocked(castSpell).mockResolvedValue({
      updatedParticipant: {
        ...apprentice,
        spellSlots: { 1: { max: 2, current: 1 } },
      } as CombatParticipant,
      updatedAction: { description: 'Cast Burning Hands using level 1 slot' } as never,
    });

    const result = await handleSpellCast(
      { spellName: 'burning-hands', spellLevel: 1, description: 'The Apprentice casts' },
      apprentice,
    );

    expect(result.success).toBe(true);
    expect(result.participantUpdates.spellSlots).toEqual({ 1: { max: 2, current: 1 } });
  });
});
