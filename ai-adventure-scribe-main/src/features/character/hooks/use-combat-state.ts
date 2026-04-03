import { useState, useCallback, type Dispatch, type SetStateAction } from 'react';

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

/**
 * Hook to manage combat-related state for a character
 * Extracted from MainTab.tsx
 */
export const useCombatState = (
  maxHp: number,
): {
  combatState: CombatState;
  setCombatState: Dispatch<SetStateAction<CombatState>>;
  damageInput: string;
  setDamageInput: Dispatch<SetStateAction<string>>;
  healingInput: string;
  setHealingInput: Dispatch<SetStateAction<string>>;
  applyDamage: () => void;
  applyHealing: () => void;
  resetDeathSaves: () => void;
  updateDeathSave: (type: 'success' | 'failure', increment: boolean) => void;
} => {
  const [combatState, setCombatState] = useState<CombatState>({
    currentHp: maxHp,
    tempHp: 0,
    deathSaves: { successes: 0, failures: 0 },
    conditions: [],
    initiative: 0,
  });

  const [damageInput, setDamageInput] = useState('');
  const [healingInput, setHealingInput] = useState('');

  const applyDamage = useCallback(() => {
    const damage = parseInt(damageInput) || 0;
    if (damage <= 0) return;

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
  }, [damageInput]);

  const applyHealing = useCallback(() => {
    const healing = parseInt(healingInput) || 0;
    if (healing <= 0) return;

    setCombatState((prev) => ({
      ...prev,
      currentHp: Math.min(maxHp, prev.currentHp + healing),
    }));
    setHealingInput('');
  }, [healingInput, maxHp]);

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
    applyDamage,
    applyHealing,
    resetDeathSaves,
    updateDeathSave,
  };
};
