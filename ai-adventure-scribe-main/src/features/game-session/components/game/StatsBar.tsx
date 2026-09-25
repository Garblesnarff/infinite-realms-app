import { Heart, Shield, Zap, Sword } from 'lucide-react';
import React, { useMemo } from 'react';

import { useCharacter } from '@/contexts/CharacterContext';
import { MISSING_ARMOR_CLASS_LABEL } from '@/utils/character/character-sheet-armor-class';
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
    <div className="flex min-w-[3.25rem] shrink-0 flex-col items-center text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 flex items-center justify-center gap-1 ${color}`}>
        <Icon className="w-3 h-3" />
        <span className="text-xs font-bold">{value}</span>
      </div>
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
    <div className="flex max-w-full flex-wrap items-center gap-4 rounded-lg bg-muted/50 p-2">
      <StatBadge
        icon={Heart}
        value={formatCharacterSheetHitPoints({ current: currentHp, maximum: maxHp })}
        label="HP"
        color="text-red-600"
      />
      <StatBadge
        icon={Shield}
        value={armorClass ?? MISSING_ARMOR_CLASS_LABEL}
        label="AC"
        color="text-blue-600"
      />
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
