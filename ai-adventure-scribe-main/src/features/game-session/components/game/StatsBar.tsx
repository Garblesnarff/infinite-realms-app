import { Heart, Shield, Zap, Sword } from 'lucide-react';
import React, { useMemo } from 'react';

import { useCharacter } from '@/contexts/CharacterContext';
import {
  formatCharacterSheetHitPoints,
  getCharacterSheetHitPoints,
} from '@/utils/character/character-sheet-hit-points';
import { calculateAllCharacterStats } from '@/utils/character-calculations';

/**
 * StatBadge - Internal component for individual stat badges
 * ⚡ Bolt: Extracted to prevent re-creation on every StatsBar render
 */
const StatBadge = React.memo(
  ({
    icon: Icon,
    value,
    label,
    color,
  }: {
    icon: React.ElementType;
    value: number | string;
    label: string;
    color: string;
  }) => (
    <div className="text-center">
      <div className={`flex items-center justify-center gap-1 ${color} mb-1`}>
        <Icon className="w-3 h-3" />
        <span className="text-xs font-bold">{value}</span>
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  ),
);

StatBadge.displayName = 'StatBadge';

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

  // ⚡ Bolt: Memoize stat calculations to prevent redundant processing on every render.
  // Using centralized calculateAllCharacterStats for consistency and correctness.
  const stats = useMemo(() => {
    if (!character) return null;
    return calculateAllCharacterStats(character);
  }, [character]);

  if (!character || !stats) {
    return null;
  }

  const { current: currentHp, maximum: maxHp } = getCharacterSheetHitPoints(character);
  const { armorClass, proficiencyBonus: proficiency, initiative } = stats;

  return (
    <div className="flex items-center gap-4 mt-2 mb-4 p-2 bg-muted/50 rounded-lg">
      <StatBadge
        icon={Heart}
        value={formatCharacterSheetHitPoints({ current: currentHp, maximum: maxHp })}
        label="HP"
        color="text-red-600"
      />
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

StatsBar.displayName = 'StatsBar';
