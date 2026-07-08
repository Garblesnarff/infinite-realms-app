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

const numberWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

/** Convert an SRD Multiattack description into an ordered sequence executable by combat UI. */
export function parseMultiattackSequence(description: string, attackNames: string[]): string[] {
  const lower = description.toLowerCase();
  const sequence: string[] = [];
  for (const name of attackNames) {
    const singular = name.toLowerCase().replace(/s$/, '');
    const match = lower.match(new RegExp(`(?:one|two|three|four|five|\\d+) (?:with (?:its|his|her) )?${singular}s?`));
    if (match) {
      const token = match[0].split(' ')[0];
      const count = numberWords[token] ?? Number(token);
      sequence.push(...Array(count).fill(name));
    }
  }
  if (!sequence.length) {
    const total = lower.match(/makes? (one|two|three|four|five|\\d+) .*?attacks?/);
    const count = total ? (numberWords[total[1]] ?? Number(total[1])) : 0;
    const sole = attackNames.find((name) => lower.includes(name.toLowerCase().replace(/s$/, '')));
    if (sole && count) sequence.push(...Array(count).fill(sole));
  }
  return sequence;
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

    const initiativeModifier = monster?.abilities?.dexterity != null
      ? Math.floor((monster.abilities.dexterity - 10) / 2)
      : 0;
    const attackActions = monster?.actions?.filter((action) => action.attack_bonus !== undefined) ?? [];
    const multiattack = monster?.actions?.find((action) => action.name === 'Multiattack');

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
        attacks: attackActions.map((action) => {
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
        multiattackSequence: multiattack ? parseMultiattackSequence(String(multiattack.desc || ''), attackActions.map((action) => String(action.name))) : undefined,
        savingThrowBonuses: monster?.savingThrows ?? {},
        hasLegendaryActions: Boolean(monster?.legendaryActions?.length),
      },
    });
  }

  return participants;
}
