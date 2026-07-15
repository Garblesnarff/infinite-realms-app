import type { Character } from '@/types/character';
import type { CombatParticipant } from '@/types/combat';

import { getAuthHeaders } from '@/services/auth/TokenService';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8888';

export interface RestHitDie {
  id: string;
  characterId: string;
  className: string;
  dieType: string;
  totalDice: number;
  usedDice: number;
}

export interface RestorableResource {
  resourceType: string;
  resourceName: string;
  amountRestored: number | string;
  maxAmount?: number | string;
}

export interface RestApiResult {
  characterId: string;
  restType: 'short' | 'long';
  hpRestored: number;
  hitDiceSpent?: number;
  hitDiceRestored?: number;
  hitDiceRemaining: RestHitDie[];
  resourcesRestored: RestorableResource[];
  spellSlots: Record<string, { max?: number; current?: number }> | null;
  pactSlots: Character['pactSlots'] | null;
  classFeatures: Character['classFeatures'];
  restEventId: string;
}

function normalizeSpellSlots(
  spellSlots: RestApiResult['spellSlots'],
): Character['spellSlots'] | undefined {
  if (!spellSlots) return undefined;
  return Object.fromEntries(
    Object.entries(spellSlots).map(([level, slot]) => [
      Number(level),
      {
        max: slot.max ?? slot.current ?? 0,
        current: slot.current ?? slot.max ?? 0,
      },
    ]),
  ) as Character['spellSlots'];
}

function aggregateHitDice(hitDice: RestHitDie[]): Character['hitDice'] | undefined {
  if (hitDice.length === 0) return undefined;
  const total = hitDice.reduce((sum, die) => sum + die.totalDice, 0);
  const used = hitDice.reduce((sum, die) => sum + die.usedDice, 0);
  return {
    total,
    remaining: Math.max(0, total - used),
    type: hitDice[0].dieType,
  };
}

export function applyRestResultToCharacter(
  character: Character,
  result: RestApiResult,
): Character {
  const spellSlots = normalizeSpellSlots(result.spellSlots);
  const hitDice = aggregateHitDice(result.hitDiceRemaining);

  return {
    ...character,
    ...(spellSlots ? { spellSlots } : {}),
    pactSlots: result.pactSlots ?? character.pactSlots,
    classFeatures: result.classFeatures ?? character.classFeatures,
    ...(hitDice ? { hitDice } : {}),
    hitPoints: character.hitPoints
      ? {
          ...character.hitPoints,
          current:
            result.restType === 'long'
              ? character.hitPoints.maximum
              : Math.min(
                  character.hitPoints.maximum,
                  character.hitPoints.current + result.hpRestored,
                ),
        }
      : character.hitPoints,
  };
}

export function applyRestResultToCombatParticipant(
  participant: CombatParticipant,
  result: RestApiResult,
): CombatParticipant {
  const hitDice = aggregateHitDice(result.hitDiceRemaining);
  const spellSlots = normalizeSpellSlots(result.spellSlots);

  return {
    ...participant,
    currentHitPoints:
      result.restType === 'long'
        ? participant.maxHitPoints
        : Math.min(participant.maxHitPoints, participant.currentHitPoints + result.hpRestored),
    ...(hitDice
      ? {
          hitDice: {
            max: hitDice.total,
            current: hitDice.remaining,
          },
        }
      : {}),
    ...(spellSlots ? { spellSlots: spellSlots as CombatParticipant['spellSlots'] } : {}),
    ...(result.restType === 'long'
      ? {
          conditions: participant.conditions?.filter((condition) => condition.duration === -1) || [],
          activeConcentration: null,
          actionTaken: false,
          bonusActionTaken: false,
          reactionTaken: false,
          movementUsed: 0,
        }
      : {}),
  };
}

async function requestRest(
  characterId: string,
  restType: 'short' | 'long',
  hitDiceToSpend: number = 0,
): Promise<RestApiResult> {
  const response = await fetch(
    `${API_BASE_URL}/v1/rest/characters/${encodeURIComponent(characterId)}/${restType}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(restType === 'short' ? { hitDiceToSpend } : {}),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Rest failed with status ${response.status}`);
  }
  return response.json() as Promise<RestApiResult>;
}

export const restApi = {
  shortRest: (characterId: string, hitDiceToSpend: number = 0) =>
    requestRest(characterId, 'short', hitDiceToSpend),
  longRest: (characterId: string) => requestRest(characterId, 'long'),
  attuneItem: async (characterId: string, itemId: string): Promise<void> => {
    const response = await fetch(
      `${API_BASE_URL}/v1/characters/${encodeURIComponent(characterId)}/attune/${encodeURIComponent(itemId)}`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error || `Attunement failed with status ${response.status}`);
    }
  },
};
