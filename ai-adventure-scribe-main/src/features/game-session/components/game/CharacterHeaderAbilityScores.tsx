import React from 'react';

const getModifier = (score?: number): string => {
  if (!score) return '+0';
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
};

const ABILITY_SCORE_FIELDS = [
  { label: 'STR', key: 'strength' },
  { label: 'DEX', key: 'dexterity' },
  { label: 'CON', key: 'constitution' },
  { label: 'INT', key: 'intelligence' },
  { label: 'WIS', key: 'wisdom' },
  { label: 'CHA', key: 'charisma' },
] as const;

interface CharacterHeaderAbilityScoresProps {
  abilityScores: Record<string, { score?: number }> | undefined;
}

/**
 * CharacterHeaderAbilityScores
 * ⚡ Bolt: Wrapped in React.memo to avoid redundant DOM reconciliation and layout calculations
 * when parent components (such as CompactCharacterHeader) re-render.
 */
export const CharacterHeaderAbilityScores: React.FC<CharacterHeaderAbilityScoresProps> = React.memo(({
  abilityScores,
}) => (
  <div className="grid grid-cols-3 gap-2 text-xs" role="group" aria-label="Ability Scores">
    {ABILITY_SCORE_FIELDS.map((score) => {
      const modifier = getModifier(abilityScores?.[score.key]?.score);
      return (
        <div
          key={score.key}
          className="flex flex-col items-center p-2 bg-black/30 backdrop-blur-sm rounded border border-white/10"
          aria-label={`${score.label}: ${modifier}`}
        >
          <span className="font-semibold text-gray-400" aria-hidden="true">
            {score.label}
          </span>
          <span className="text-lg font-bold text-white" aria-hidden="true">
            {modifier}
          </span>
        </div>
      );
    })}
  </div>
));

CharacterHeaderAbilityScores.displayName = 'CharacterHeaderAbilityScores';
