import { Circle, Dot } from 'lucide-react';
import React from 'react';

import type { CharacterSpellDisplay } from '@/utils/spell-lookup';

import { Badge } from '@/components/ui/badge';
import logger from '@/lib/logger';

interface SpellListItemProps {
  spell: CharacterSpellDisplay;
  isCantrip?: boolean;
}

/**
 * Individual spell list item for the SpellsTab
 * Extracted for better modularity and to reduce SpellsTab complexity
 */
const SpellListItem: React.FC<SpellListItemProps> = ({ spell, isCantrip = false }) => {
  // Helper function to format spell components with error handling
  const formatComponents = (spell: CharacterSpellDisplay) => {
    try {
      if (!spell) return '';

      const components = [];
      if (spell.verbal || spell.components_verbal) components.push('V');
      if (spell.somatic || spell.components_somatic) components.push('S');
      if (spell.material || spell.components_material) components.push('M');
      return components.join(', ');
    } catch (error) {
      logger.warn('[SpellListItem] Error formatting components for spell:', spell?.name, error);
      return 'V, S, M'; // Safe fallback
    }
  };

  try {
    if (!spell || !spell.id) {
      logger.warn(`[SpellListItem] Invalid ${isCantrip ? 'cantrip' : 'leveled spell'} data:`, spell);
      return null;
    }

    if (isCantrip) {
      return (
        <div className="flex items-center justify-between p-3 border rounded-lg">
          <div className="flex-1">
            <div className="font-medium">{spell.name || 'Unknown Cantrip'}</div>
            <div className="text-sm text-muted-foreground">
              {spell.school || 'Unknown'} • {spell.casting_time || 'Unknown'} •{' '}
              {spell.range_text || 'Unknown'}
            </div>
            {formatComponents(spell) && (
              <div className="text-xs text-muted-foreground">
                Components: {formatComponents(spell)}
              </div>
            )}
            <div className="text-sm text-muted-foreground mt-1">
              {spell.description || 'No description available.'}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-between p-3 border rounded-lg">
        <div className="flex items-start gap-3 flex-1">
          {/* Prepared indicator */}
          <div className="flex flex-col items-center gap-1 mt-1">
            {spell.is_prepared ? (
              <Dot className="w-4 h-4 text-green-500" />
            ) : (
              <Circle className="w-4 h-4 text-muted-foreground" />
            )}
            <Badge variant="outline" className="text-xs px-1">
              {spell.level || '?'}
            </Badge>
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{spell.name || 'Unknown Spell'}</span>
              {spell.ritual && (
                <Badge variant="secondary" className="text-xs">
                  R
                </Badge>
              )}
              {spell.concentration && (
                <Badge variant="secondary" className="text-xs">
                  C
                </Badge>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              {spell.school || 'Unknown'} • {spell.casting_time || 'Unknown'} •{' '}
              {spell.range_text || 'Unknown'}
            </div>
            {formatComponents(spell) && (
              <div className="text-xs text-muted-foreground">
                Components: {formatComponents(spell)}
              </div>
            )}
            <div className="text-sm text-muted-foreground mt-1">
              {spell.description || 'No description available.'}
            </div>
          </div>
        </div>
      </div>
    );
  } catch (error) {
    logger.error(`[SpellListItem] Error rendering ${isCantrip ? 'cantrip' : 'spell'}:`, spell, error);
    return (
      <div className="flex items-center justify-between p-3 border rounded-lg border-destructive/30">
        <div className="flex-1">
          <div className="font-medium text-destructive">
            Error loading {isCantrip ? 'cantrip' : 'spell'}
          </div>
          <div className="text-sm text-muted-foreground">
            There was an error displaying this {isCantrip ? 'cantrip' : 'spell'}. Please refresh the
            page.
          </div>
        </div>
      </div>
    );
  }
};

export default SpellListItem;
