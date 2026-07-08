import type { CombatParticipant } from '@/types/combat';
import type { DetectedEnemy } from '@/utils/combatDetection';
import { loadMonsters } from '@/services/encounters/srd-loader';

export interface PlayerCharacterLike {
  id: string;
  name: string;
  armor_class?: number;
  hit_points?: number;
  speed?: number;
  abilityScores?: {
    dexterity?: {
      modifier: number;
    };
  };
}

/**
 * Generate combat participants from detected enemies
 */
export function createCombatParticipantsFromDetection(
  enemies: DetectedEnemy[],
  playerCharacter: PlayerCharacterLike | null,
): Partial<CombatParticipant>[] {
  const participants: Partial<CombatParticipant>[] = [];

  // Add player character
  if (playerCharacter) {
    // Calculate initiative modifier from dexterity
    const dexModifier = playerCharacter.abilityScores?.dexterity?.modifier || 0;

    participants.push({
      id: `player-${playerCharacter.id}`,
      participantType: 'player',
      name: playerCharacter.name,
      characterId: playerCharacter.id,
      initiative: dexModifier, // This will be added to d20 roll in startCombat
      armorClass: playerCharacter.armor_class || 10,
      maxHitPoints: playerCharacter.hit_points || 10,
      currentHitPoints: playerCharacter.hit_points || 10,
      speed: playerCharacter.speed || 30,
      movementRemaining: playerCharacter.speed || 30,
      temporaryHitPoints: 0,
      conditions: [],
      deathSaves: { successes: 0, failures: 0, isStable: false },
      actionTaken: false,
      bonusActionTaken: false,
      reactionTaken: false,
      movementUsed: 0,
    });
  }

  // Add detected enemies
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    const monster = loadMonsters().find((entry) =>
      entry.id === enemy.monsterId || entry.name.toLowerCase() === enemy.name.toLowerCase());

    // Parse CR (handle fractional strings like "1/4")
    let numericCR = 1;
    if (typeof enemy.estimatedCR === 'string') {
      if (enemy.estimatedCR.includes('/')) {
        const [num, den] = enemy.estimatedCR.split('/').map(Number);
        numericCR = num / den;
      } else {
        numericCR = parseFloat(enemy.estimatedCR);
      }
    } else {
      numericCR = Number(enemy.estimatedCR || 1);
    }

    // Estimate initiative modifier based on CR (higher CR = better dex)
    // CR 0-2: +1, CR 3-5: +2, CR 6-10: +3, CR 11+: +4
    const initiativeModifier = Math.min(4, Math.max(1, Math.floor(numericCR / 3) + 1));

    participants.push({
      id: `enemy-${enemy.name.toLowerCase()}-${i}`,
      participantType: 'monster',
      name: `${enemy.name} ${i > 0 ? i + 1 : ''}`.trim(),
      initiative: initiativeModifier, // This will be added to d20 roll in startCombat
      armorClass: monster?.armorClass ?? enemy.suggestedAC,
      maxHitPoints: monster?.hitPoints ?? enemy.suggestedHP,
      currentHitPoints: monster?.hitPoints ?? enemy.suggestedHP,
      temporaryHitPoints: 0,
      conditions: [],
      deathSaves: { successes: 0, failures: 0, isStable: false },
      actionTaken: false,
      bonusActionTaken: false,
      reactionTaken: false,
      movementUsed: 0,
      monsterData: {
        type: monster?.type || enemy.type,
        challengeRating: String(monster?.cr ?? enemy.estimatedCR),
        alignment: monster?.alignment || 'hostile',
        specialAbilities: monster?.specialAbilities?.map((ability) => ability.name) || [],
        attacks: monster?.actions?.filter((action) => action.attack_bonus !== undefined).map((action) => {
          const damage = Array.isArray(action.damage) ? action.damage[0] as any : undefined;
          const description = String(action.desc || '');
          return {
            name: String(action.name || 'Attack'), attackBonus: Number(action.attack_bonus || 0),
            damageRoll: String(damage?.damage_dice || '1d4'),
            damageType: String(damage?.damage_type?.index || 'bludgeoning') as any,
            reach: Number(description.match(/reach (\d+) ft/i)?.[1] || 5), description,
          };
        }) || [
          {
            name: 'Basic Attack',
            attackBonus: 4,
            damageRoll: '1d8+2',
            damageType: 'bludgeoning',
            reach: 5,
            description: 'A basic melee attack',
          },
        ],
      },
    });
  }

  return participants;
}
