import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { RightSheet } from './RightSheet';
import { buildSpellCastContext, buildSpellCastMessage } from './spell-view-model';
import { useOverhaulViewModel } from './useOverhaulViewModel';

import type { SpellCastHandlerRef } from '../spell-cast-handler';
import type { InventoryItemVM, SpellVM } from './types';

import { useCharacter } from '@/contexts/CharacterContext';
import { equipCharacterItem } from '@/services/character-equipment-api';
import { characterSpellService } from '@/services/characterSpellApi';
import {
  beginSheetCast,
  finishSheetCast,
  useSheetCastProgress,
} from '@/services/combat/sheet-cast-progress';

/**
 * Live-wired character sheet rail, reading from the character / combat contexts.
 * Used as the "Character" view of the right game panel.
 */
export const RightSheetLive: React.FC<{
  sessionId?: string;
  isInCombat?: boolean;
  spellCastHandlerRef?: SpellCastHandlerRef;
  onCastStart?: () => void;
}> = React.memo(({ sessionId, isInCombat = false, spellCastHandlerRef, onCastStart }) => {
  const { state: characterState, dispatch } = useCharacter();
  const vm = useOverhaulViewModel();
  const character = characterState.character;
  const [preparedOverrides, setPreparedOverrides] = useState<Record<string, boolean>>({});
  const [pendingSpellId, setPendingSpellId] = useState<string>();
  const [spellActionError, setSpellActionError] = useState<string>();
  const [equippingItemId, setEquippingItemId] = useState<string>();
  const [equipActionError, setEquipActionError] = useState<string>();
  const [castingSpellId, setCastingSpellId] = useState<string>();
  // Synchronous twin of `castingSpellId`: a second click can land before React re-renders the
  // disabled button, and the state alone would let it through.
  const castInFlightRef = useRef(false);
  const { cast: storeCast } = useSheetCastProgress();

  useEffect(() => {
    setPreparedOverrides({});
    setSpellActionError(undefined);
    setEquipActionError(undefined);
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

  // A reopened sheet (or the other mount of it) learns of a cast in flight from the store, not from
  // this instance's own state, so its Cast buttons wait too.
  const storeCastingSpellId =
    storeCast && storeCast.phase !== 'done'
      ? ([...sheet.spells.cantrips, ...sheet.spells.known].find(
          (spell) => spell.name === storeCast.spellName,
        )?.id ?? storeCast.spellName)
      : undefined;

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

  // #1059: the in-session Equip control. The route writes the same
  // character_equipment rows the sheet's equip writes; on success the
  // local character follows, so the row moves to the Equipment panel and
  // the combat readers (which re-read the rows) honour it on the next
  // attack. The response's armor class is the server's re-synced stored
  // number (#1858), so the sheet's AC follows donning armour too.
  const equipInFlightRef = useRef(false);
  const handleEquipItem = useCallback(
    async (item: InventoryItemVM): Promise<void> => {
      if (!character?.id) {
        setEquipActionError('Equipment is unavailable until the character is loaded.');
        return;
      }
      // One equip at a time, like the cast path (#2305): a second click
      // mid-flight would overwrite equippingItemId, and the first call's
      // finally would clear it while the second equip still runs.
      if (equipInFlightRef.current) return;
      equipInFlightRef.current = true;

      setEquippingItemId(item.id);
      setEquipActionError(undefined);
      try {
        const { armorClass } = await equipCharacterItem(character.id, item.id);
        // The sheet reads AC from character_stats (object or one-row
        // array); the dispatch carries the row in the shape it arrived.
        const statsRow = Array.isArray(character.character_stats)
          ? character.character_stats[0]
          : character.character_stats;
        const nextStats =
          typeof armorClass === 'number' && statsRow
            ? { ...statsRow, armor_class: armorClass }
            : undefined;
        dispatch({
          type: 'UPDATE_CHARACTER',
          payload: {
            inventory: (character.inventory ?? []).map((row) =>
              row.itemId === item.id ? { ...row, equipped: true } : row,
            ),
            ...(nextStats
              ? {
                  character_stats: Array.isArray(character.character_stats)
                    ? [nextStats]
                    : nextStats,
                }
              : {}),
          },
        });
      } catch (error) {
        setEquipActionError(error instanceof Error ? error.message : 'Unable to equip that item.');
      } finally {
        equipInFlightRef.current = false;
        setEquippingItemId(undefined);
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

      // One cast per click, and none while one is in flight (#2305). The send queue plays every
      // call as its own player turn, so run M7's second Cast click during round 1 came back as a
      // byte-identical round-2 turn the player never took — and the engine cast for them.
      if (castInFlightRef.current) return;
      castInFlightRef.current = true;
      setCastingSpellId(spell.id);
      setSpellActionError(undefined);
      // Another mount of the sheet is casting: its dock and signal are not this click's to take.
      if (!beginSheetCast(spell.name)) {
        castInFlightRef.current = false;
        setCastingSpellId(undefined);
        return;
      }
      try {
        onCastStart?.();
        await handler(
          // #1227: the tag names the slot the cast spends, from the sheet's own slots.
          buildSpellCastMessage(spell, vm.character.spellcasting?.slots),
          buildSpellCastContext(spell),
        );
      } catch (error) {
        setSpellActionError(error instanceof Error ? error.message : 'Unable to cast spell.');
      } finally {
        finishSheetCast();
        castInFlightRef.current = false;
        setCastingSpellId(undefined);
      }
    },
    [spellCastHandlerRef, onCastStart, vm.character.spellcasting?.slots],
  );

  return (
    <RightSheet
      c={sheet}
      sessionId={sessionId}
      isInCombat={isInCombat}
      pendingSpellId={pendingSpellId}
      castingSpellId={castingSpellId ?? storeCastingSpellId}
      spellActionError={spellActionError}
      onCastSpell={handleCastSpell}
      onTogglePrepared={handleTogglePrepared}
      equippingItemId={equippingItemId}
      equipActionError={equipActionError}
      onEquipItem={handleEquipItem}
    />
  );
});

RightSheetLive.displayName = 'RightSheetLive';
