import { useState, useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';

import { useToast } from '@/hooks/use-toast';
import { userDataApi } from '@/services/user-data-api';

export interface CombatState {
  currentHp: number;
  tempHp: number;
  deathSaves: {
    successes: number;
    failures: number;
  };
  conditions: string[];
  initiative: number;
}

export interface UseCombatStateOptions {
  /**
   * When set, damage/healing/temp-HP go through the server (#214): damage via
   * POST /v1/characters/:id/damage, healing via POST /:id/heal (server adds and
   * clamps — the client never sends an absolute HP), temp HP via
   * POST /:id/temp-hp (server keeps the higher value, 2014 5e no stacking).
   * Without it the hook stays local-only (tests, previews).
   */
  characterId?: string;
  /** Called after a server write lands so the sheet can refresh the header. */
  onPersisted?: () => void;
}

/**
 * Hook to manage combat-related state for a character
 * Extracted from MainTab.tsx
 */
export const useCombatState = (
  maxHp: number,
  initialCurrentHp: number = maxHp,
  options: UseCombatStateOptions = {},
): {
  combatState: CombatState;
  setCombatState: Dispatch<SetStateAction<CombatState>>;
  damageInput: string;
  setDamageInput: Dispatch<SetStateAction<string>>;
  healingInput: string;
  setHealingInput: Dispatch<SetStateAction<string>>;
  tempHpInput: string;
  setTempHpInput: Dispatch<SetStateAction<string>>;
  applyDamage: () => Promise<void>;
  applyHealing: () => Promise<void>;
  applyTempHp: () => Promise<void>;
  resetDeathSaves: () => void;
  updateDeathSave: (type: 'success' | 'failure', increment: boolean) => void;
} => {
  const { toast } = useToast();
  const { characterId, onPersisted } = options;

  const [combatState, setCombatState] = useState<CombatState>({
    currentHp: initialCurrentHp,
    tempHp: 0,
    deathSaves: { successes: 0, failures: 0 },
    conditions: [],
    initiative: 0,
  });

  const [damageInput, setDamageInput] = useState('');
  const [healingInput, setHealingInput] = useState('');
  const [tempHpInput, setTempHpInput] = useState('');

  // #214 (B1): the stored HP is the source of truth. If it changes under us
  // (a refresh after damage, a rest, another tab's save), sync the local
  // combat state so healing never computes from a stale value.
  useEffect(() => {
    setCombatState((prev) => ({ ...prev, currentHp: initialCurrentHp }));
  }, [initialCurrentHp]);

  const applyDamage = useCallback(async () => {
    const damage = parseInt(damageInput) || 0;
    if (damage <= 0) {
      toast({
        title: 'Invalid Damage',
        description: 'Enter a damage amount greater than 0.',
        variant: 'destructive',
      });
      return;
    }

    if (characterId) {
      try {
        const result = await userDataApi.applyCharacterDamage(characterId, damage);
        setCombatState((prev) => ({
          ...prev,
          currentHp: result.currentHitPoints,
          tempHp: result.temporaryHitPoints,
        }));
        setDamageInput('');
        onPersisted?.();
      } catch (error) {
        toast({
          title: 'Damage Not Saved',
          description: error instanceof Error ? error.message : 'The damage could not be saved.',
          variant: 'destructive',
        });
      }
      return;
    }

    setCombatState((prev) => {
      let newCurrentHp = prev.currentHp;
      let newTempHp = prev.tempHp;

      // Temp HP absorbs damage first
      if (newTempHp > 0) {
        if (damage <= newTempHp) {
          newTempHp -= damage;
        } else {
          const remainingDamage = damage - newTempHp;
          newTempHp = 0;
          newCurrentHp -= remainingDamage;
        }
      } else {
        newCurrentHp -= damage;
      }

      return {
        ...prev,
        currentHp: Math.max(0, newCurrentHp),
        tempHp: Math.max(0, newTempHp),
      };
    });
    setDamageInput('');
  }, [damageInput, characterId, onPersisted, toast]);

  const applyHealing = useCallback(async () => {
    const healing = parseInt(healingInput) || 0;
    if (healing <= 0) {
      toast({
        title: 'Invalid Healing',
        description: 'Enter a healing amount greater than 0.',
        variant: 'destructive',
      });
      return;
    }

    if (characterId) {
      try {
        // #214: the server adds the heal and clamps to max HP. The client
        // never computes from its own (possibly stale) currentHp, so a
        // combat or DM HP change made in between is not lost.
        const result = await userDataApi.applyCharacterHealing(characterId, healing);
        setCombatState((prev) => ({
          ...prev,
          currentHp: result.currentHitPoints,
          tempHp: result.temporaryHitPoints,
        }));
        setHealingInput('');
        onPersisted?.();
      } catch (error) {
        toast({
          title: 'Healing Not Saved',
          description: error instanceof Error ? error.message : 'The healing could not be saved.',
          variant: 'destructive',
        });
      }
      return;
    }

    setCombatState((prev) => ({
      ...prev,
      currentHp: Math.min(maxHp, prev.currentHp + healing),
    }));
    setHealingInput('');
  }, [healingInput, maxHp, characterId, onPersisted, toast]);

  const applyTempHp = useCallback(async () => {
    const tempHp = parseInt(tempHpInput);
    if (tempHpInput.trim() === '' || isNaN(tempHp) || tempHp < 0) {
      toast({
        title: 'Invalid Temp HP',
        description: 'Enter a temp HP amount of 0 or more.',
        variant: 'destructive',
      });
      return;
    }

    if (characterId) {
      try {
        // #214: 2014 5e temp HP do not stack — the server keeps the higher of
        // the current and the new value.
        const result = await userDataApi.applyCharacterTempHp(characterId, tempHp);
        setCombatState((prev) => ({ ...prev, tempHp: result.temporaryHitPoints }));
        setTempHpInput('');
        onPersisted?.();
      } catch (error) {
        toast({
          title: 'Temp HP Not Saved',
          description: error instanceof Error ? error.message : 'The temp HP could not be saved.',
          variant: 'destructive',
        });
      }
      return;
    }

    setCombatState((prev) => ({ ...prev, tempHp }));
    setTempHpInput('');
  }, [tempHpInput, characterId, onPersisted, toast]);

  const resetDeathSaves = useCallback(() => {
    setCombatState((prev) => ({
      ...prev,
      deathSaves: { successes: 0, failures: 0 },
    }));
  }, []);

  const updateDeathSave = useCallback((type: 'success' | 'failure', increment: boolean) => {
    setCombatState((prev) => ({
      ...prev,
      deathSaves: {
        ...prev.deathSaves,
        [type === 'success' ? 'successes' : 'failures']: Math.max(
          0,
          Math.min(
            3,
            prev.deathSaves[type === 'success' ? 'successes' : 'failures'] + (increment ? 1 : -1),
          ),
        ),
      },
    }));
  }, []);

  return {
    combatState,
    setCombatState,
    damageInput,
    setDamageInput,
    healingInput,
    setHealingInput,
    tempHpInput,
    setTempHpInput,
    applyDamage,
    applyHealing,
    applyTempHp,
    resetDeathSaves,
    updateDeathSave,
  };
};
