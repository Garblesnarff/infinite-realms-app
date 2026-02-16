/**
 * Weapon Handlers
 * Manages weapon equip/unequip operations for combat participants.
 * Extracted from CombatContext.tsx to consolidate near-identical methods.
 */

import type { ReducerAction } from './combat-reducer';
import type { Equipment } from '@/data/equipmentOptions';

type Dispatch = (action: ReducerAction) => void;

/** Weapon slot identifiers */
export type WeaponSlot = 'mainHandWeapon' | 'offHandWeapon';

/**
 * Set or clear a weapon in the specified slot for a participant.
 * Pass undefined for weapon to unequip.
 */
export function setWeapon(
  dispatch: Dispatch,
  participantId: string,
  slot: WeaponSlot,
  weapon?: Equipment,
) {
  dispatch({
    type: 'UPDATE_PARTICIPANT',
    participantId,
    updates: { [slot]: weapon },
  });
}

/**
 * Creates weapon management handler functions bound to a dispatch.
 * Returns the 4 public methods that match the original CombatContext API.
 */
export function createWeaponHandlers(dispatch: Dispatch) {
  const equipMainHandWeapon = (participantId: string, weapon: Equipment) => {
    setWeapon(dispatch, participantId, 'mainHandWeapon', weapon);
  };

  const equipOffHandWeapon = (participantId: string, weapon: Equipment) => {
    setWeapon(dispatch, participantId, 'offHandWeapon', weapon);
  };

  const unequipMainHandWeapon = (participantId: string) => {
    setWeapon(dispatch, participantId, 'mainHandWeapon', undefined);
  };

  const unequipOffHandWeapon = (participantId: string) => {
    setWeapon(dispatch, participantId, 'offHandWeapon', undefined);
  };

  return {
    equipMainHandWeapon,
    equipOffHandWeapon,
    unequipMainHandWeapon,
    unequipOffHandWeapon,
  };
}
