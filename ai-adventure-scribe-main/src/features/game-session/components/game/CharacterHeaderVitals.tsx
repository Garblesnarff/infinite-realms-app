import { Heart, Shield, Zap, Skull } from 'lucide-react';
import React from 'react';

import type { CombatHP } from './use-combat-hp';

import { formatCharacterSheetHitPoints } from '@/utils/character/character-sheet-hit-points';

interface CharacterHeaderVitalsProps {
  combatHP: CombatHP | null;
  currentHp: number | null;
  maxHp: number | null;
  armorClass: number;
  proficiency: number;
}

/**
 * CharacterHeaderVitals
 * ⚡ Bolt: Wrapped in React.memo to avoid redundant DOM reconciliation and layout calculations
 * when parent components (such as CompactCharacterHeader) re-render.
 */
export const CharacterHeaderVitals: React.FC<CharacterHeaderVitalsProps> = React.memo(
  ({ combatHP, currentHp, maxHp, armorClass, proficiency }) => (
    <div className="flex gap-4 text-sm justify-center text-white">
      <div
        className="flex items-center gap-1"
        aria-label={
          combatHP
            ? `Hit Points: ${combatHP.current_hp} out of ${combatHP.max_hp}${combatHP.temp_hp > 0 ? ` plus ${combatHP.temp_hp} temporary` : ''}`
            : currentHp !== null && maxHp !== null
              ? `Hit Points: ${currentHp} out of ${maxHp}`
              : `Hit Points: ${formatCharacterSheetHitPoints({ current: currentHp, maximum: maxHp })}`
        }
      >
        {combatHP ? (
          <>
            {combatHP.is_conscious ? (
              <Heart
                className={`w-4 h-4 ${
                  combatHP.current_hp === 0
                    ? 'text-gray-500'
                    : combatHP.current_hp / combatHP.max_hp <= 0.25
                      ? 'text-red-600 animate-pulse'
                      : combatHP.current_hp / combatHP.max_hp <= 0.5
                        ? 'text-orange-400'
                        : 'text-red-400'
                }`}
                aria-hidden="true"
              />
            ) : (
              <Skull className="w-4 h-4 text-gray-500 animate-pulse" aria-hidden="true" />
            )}
            <span className="font-semibold" aria-hidden="true">
              HP:
            </span>
            <span
              className={
                combatHP.current_hp === 0
                  ? 'text-gray-500'
                  : combatHP.current_hp / combatHP.max_hp <= 0.25
                    ? 'text-red-400 font-bold'
                    : ''
              }
              aria-hidden="true"
            >
              {combatHP.current_hp}
            </span>
            <span className="text-gray-400" aria-hidden="true">
              /
            </span>
            <span aria-hidden="true">{combatHP.max_hp}</span>
            {combatHP.temp_hp > 0 && (
              <span className="text-blue-300 font-semibold ml-1" aria-hidden="true">
                (+{combatHP.temp_hp})
              </span>
            )}
          </>
        ) : (
          <>
            <Heart className="w-4 h-4 text-red-400" aria-hidden="true" />
            <span className="font-semibold" aria-hidden="true">
              HP:
            </span>
            <span aria-hidden="true">
              {formatCharacterSheetHitPoints({ current: currentHp, maximum: maxHp })}
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-1" aria-label={`Armor Class: ${armorClass}`}>
        <Shield className="w-4 h-4 text-blue-400" aria-hidden="true" />
        <span className="font-semibold" aria-hidden="true">
          AC:
        </span>
        <span aria-hidden="true">{armorClass}</span>
      </div>
      <div className="flex items-center gap-1" aria-label={`Proficiency Bonus: +${proficiency}`}>
        <Zap className="w-4 h-4 text-green-400" aria-hidden="true" />
        <span className="font-semibold" aria-hidden="true">
          PROF:
        </span>
        <span aria-hidden="true">+{proficiency}</span>
      </div>
    </div>
  ),
);

CharacterHeaderVitals.displayName = 'CharacterHeaderVitals';
