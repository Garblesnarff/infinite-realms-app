import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { RightSheet } from './RightSheet';
import { buildSpellCastContext, buildSpellCastMessage } from './spell-view-model';
import { useOverhaulViewModel } from './useOverhaulViewModel';

import type { SpellCastHandlerRef } from '../spell-cast-handler';
import type { SpellVM } from './types';

import { useCharacter } from '@/contexts/CharacterContext';
import { characterSpellService } from '@/services/characterSpellApi';

/**
 * Live-wired character sheet rail, reading from the character / combat contexts.
 * Used as the "Character" view of the right game panel.
 */
export const RightSheetLive: React.FC<{
  sessionId?: string;
  isInCombat?: boolean;
  spellCastHandlerRef?: SpellCastHandlerRef;
}> = React.memo(({ sessionId, isInCombat = false, spellCastHandlerRef }) => {
  const { state: characterState, dispatch } = useCharacter();
  const vm = useOverhaulViewModel();
  const character = characterState.character;
  const [preparedOverrides, setPreparedOverrides] = useState<Record<string, boolean>>({});
  const [pendingSpellId, setPendingSpellId] = useState<string>();
  const [spellActionError, setSpellActionError] = useState<string>();

  useEffect(() => {
    setPreparedOverrides({});
    setSpellActionError(undefined);
  }, [character?.id]);

  const sheet = useMemo(() => {
    const known = vm.character.spells.known.map((spell) => ({
      ...spell,
      isPrepared: preparedOverrides[spell.id] ?? spell.isPrepared,
    }));

    return {
      ...vm.character,
      spells: {
        ...vm.character.spells,
        known,
        prepared: known.filter((spell) => spell.isPrepared),
      },
    };
  }, [preparedOverrides, vm.character]);

  const handleTogglePrepared = useCallback(
    async (spellId: string, isPrepared: boolean): Promise<void> => {
      if (!character?.id) {
        setSpellActionError('Spell preparation is unavailable until the character is loaded.');
        return;
      }

      setPendingSpellId(spellId);
      setSpellActionError(undefined);
      try {
        await characterSpellService.updateSpellPreparation(character.id, spellId, isPrepared);
        setPreparedOverrides((current) => ({ ...current, [spellId]: isPrepared }));
        const preparedSpells = new Set(character.preparedSpells ?? []);
        if (isPrepared) preparedSpells.add(spellId);
        else preparedSpells.delete(spellId);
        dispatch({
          type: 'UPDATE_CHARACTER',
          payload: { preparedSpells: [...preparedSpells] },
        });
      } catch (error) {
        setSpellActionError(
          error instanceof Error ? error.message : 'Unable to update prepared spells.',
        );
      } finally {
        setPendingSpellId(undefined);
      }
    },
    [character, dispatch],
  );

  const handleCastSpell = useCallback(
    async (spell: SpellVM): Promise<void> => {
      // In combat as well as out of it (#2233): the cast goes through the ordinary turn, where
      // the engine resolves it from the same catalog the sheet lists. The encounter tracker's
      // local Cast Spell button never reached the engine, so this is the in-combat cast path.
      const handler = spellCastHandlerRef?.current;
      if (!handler) {
        setSpellActionError('The turn is still loading. Try casting again in a moment.');
        return;
      }

      setSpellActionError(undefined);
      try {
        await handler(buildSpellCastMessage(spell), buildSpellCastContext(spell));
      } catch (error) {
        setSpellActionError(error instanceof Error ? error.message : 'Unable to cast spell.');
      }
    },
    [spellCastHandlerRef],
  );

  return (
    <RightSheet
      c={sheet}
      sessionId={sessionId}
      isInCombat={isInCombat}
      pendingSpellId={pendingSpellId}
      spellActionError={spellActionError}
      onCastSpell={handleCastSpell}
      onTogglePrepared={handleTogglePrepared}
    />
  );
});

RightSheetLive.displayName = 'RightSheetLive';
