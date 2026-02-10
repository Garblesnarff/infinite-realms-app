import { Heart, Shield, Zap, Sword } from 'lucide-react';
import React, { useMemo } from 'react';

import { useCharacter } from '@/contexts/CharacterContext';
import { useCharacterStats } from '@/hooks/use-character-stats';

/**
 * StatsBar - Floating quick stats header for game interface
 * Shows essential character stats (HP, AC, PROF, INIT) in compact badges
 * Updates live from CharacterContext
 *
 * Dependencies:
 * - CharacterContext for live data
 * - lucide-react for icons
 *
 * Usage: Render below campaign title in GameContent header
 */
export const StatsBar: React.FC = React.memo(() => {
  const { state: characterState } = useCharacter();
  const character = characterState.character;

  // ⚡ Bolt: Use memoized character stats to avoid redundant D&D 5e calculations
  const stats = useCharacterStats(character);

  // ⚡ Bolt: Memoize derived stats to ensure they only update when stats object changes
  const displayStats = useMemo(() => {
    if (!stats) return { maxHp: 0, armorClass: 10, proficiency: 2, initiative: 0 };
    return {
      maxHp: stats.hitPoints,
      armorClass: stats.armorClass,
      proficiency: stats.proficiencyBonus,
      initiative: stats.initiative,
    };
  }, [stats]);

  const { maxHp, armorClass, proficiency, initiative } = displayStats;

  if (!character) {
    return null;
  }

  const StatBadge = ({
    icon: Icon,
    value,
    label,
    color,
  }: {
    icon: React.ElementType;
    value: number | string;
    label: string;
    color: string;
  }): JSX.Element => (
    <div className="text-center">
      <div className={`flex items-center justify-center gap-1 ${color} mb-1`}>
        <Icon className="w-3 h-3" />
        <span className="text-xs font-bold">{value}</span>
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );

  return (
    <div className="flex items-center gap-4 mt-2 mb-4 p-2 bg-muted/50 rounded-lg">
      <StatBadge icon={Heart} value={maxHp} label="HP" color="text-red-600" />
      <StatBadge icon={Shield} value={armorClass} label="AC" color="text-blue-600" />
      <StatBadge icon={Zap} value={`+${proficiency}`} label="PROF" color="text-green-600" />
      <StatBadge
        icon={Sword}
        value={initiative >= 0 ? `+${initiative}` : initiative}
        label="INIT"
        color="text-purple-600"
      />
    </div>
  );
});
