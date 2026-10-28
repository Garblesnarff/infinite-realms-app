import React from 'react';

import type { Spell } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';

interface SpellCardProps {
  spell: Spell;
  isSelected: boolean;
  onSelectionChange: (id: string, checked: boolean) => void;
  disabled?: boolean;
  /** Granted by the subclass (cleric domain spell): always prepared, never a choice. */
  alwaysPrepared?: boolean;
}

/**
 * Extracted SpellCard component for advanced spellcasting
 */
export const SpellCard: React.FC<SpellCardProps> = ({
  spell,
  isSelected,
  onSelectionChange,
  disabled = false,
  alwaysPrepared = false,
}) => (
  <div
    className={`p-3 border rounded-lg cursor-pointer transition-all ${
      isSelected ? 'border-primary bg-primary/5' : 'border-muted hover:border-primary/50'
    } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    onClick={() => !disabled && onSelectionChange(spell.id, !isSelected)}
  >
    <div className="flex items-start justify-between">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium">{spell.name}</span>
          <Badge variant="outline" className="text-xs">
            Level {spell.level}
          </Badge>
          {spell.ritual && (
            <Badge variant="secondary" className="text-xs">
              Ritual
            </Badge>
          )}
          {alwaysPrepared && (
            <Badge variant="default" className="text-xs">
              Always prepared
            </Badge>
          )}
          {spell.concentration && (
            <Badge variant="secondary" className="text-xs">
              Concentration
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-2">
          {spell.school} • {spell.casting_time} • {spell.range_text}
        </p>
        <p className="text-sm">{spell.description}</p>
      </div>
      <Checkbox
        checked={isSelected}
        disabled={disabled}
        onCheckedChange={(checked) => onSelectionChange(spell.id, checked === true)}
      />
    </div>
  </div>
);
