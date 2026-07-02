/**
 * Spell Casting Panel Component
 *
 * Displays spell component information during combat spell casting.
 * Shows verbal, somatic, and material components with descriptions.
 * Integrates with CombatContext to show real-time spell casting information.
 *
 * Dependencies:
 * - useCombat from '@/contexts/CombatContext'
 * - shadcn/ui components for UI
 * - Spell types from '@/types/character'
 * - Spell utilities from '@/utils/spellComponents'
 *
 * @author AI Dungeon Master Team
 */

import { Zap, BookOpen } from 'lucide-react';
import React from 'react';

import { SpellCastingDetails } from './SpellCastingDetails';

import type { Spell } from '@/types/character';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCombat } from '@/contexts/CombatContext';
import logger from '@/lib/logger';
import { spellApi } from '@/services/spellApi';

// ===========================
// Props Interface
// ===========================
interface SpellCastingPanelProps {
  selectedSpellName?: string;
  selectedSpellLevel?: number;
  className?: string;
}

// ===========================
// Main Component
// ===========================
const SpellCastingPanel: React.FC<SpellCastingPanelProps> = ({
  selectedSpellName,
  selectedSpellLevel,
  className = '',
}) => {
  const { state } = useCombat();
  const { activeEncounter } = state;
  const [selectedSpell, setSelectedSpell] = React.useState<Spell | null>(null);
  const [isLoadingSpell, setIsLoadingSpell] = React.useState(false);

  // Fetch the selected spell from API
  React.useEffect(() => {
    if (selectedSpellName) {
      setIsLoadingSpell(true);
      spellApi
        .getSpellByName(selectedSpellName)
        .then((spell) => setSelectedSpell(spell))
        .catch((error) => {
          logger.error('Failed to fetch spell:', error);
          setSelectedSpell(null);
        })
        .finally(() => setIsLoadingSpell(false));
    } else {
      setSelectedSpell(null);
    }
  }, [selectedSpellName]);

  if (!activeEncounter) {
    return (
      <Card className={`w-full ${className}`}>
        <CardHeader>
          <CardTitle className="text-red-700">Spell Casting</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500">No active combat encounter</p>
        </CardContent>
      </Card>
    );
  }

  const currentParticipant = activeEncounter.participants.find(
    (p) => p.id === activeEncounter.currentTurnParticipantId,
  );

  if (!currentParticipant) {
    return (
      <Card className={`w-full ${className}`}>
        <CardHeader>
          <CardTitle className="text-red-700">Spell Casting</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500">No active participant</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`w-full ${className}`}>
      <CardHeader>
        <div className="flex items-center space-x-2">
          <Zap className="w-5 h-5 text-purple-500" />
          <CardTitle className="text-purple-700">Spell Casting</CardTitle>
        </div>
        <p className="text-sm text-gray-600">{currentParticipant.name}'s Spell Casting</p>
      </CardHeader>

      <CardContent>
        {isLoadingSpell ? (
          <div className="text-center text-gray-500 py-8">
            <BookOpen className="w-12 h-12 mx-auto text-gray-300 mb-2 animate-pulse" />
            <p>Loading spell...</p>
          </div>
        ) : selectedSpell ? (
          <SpellCastingDetails
            selectedSpell={selectedSpell}
            selectedSpellLevel={selectedSpellLevel}
          />
        ) : (
          <div className="text-center text-gray-500 py-8">
            <BookOpen className="w-12 h-12 mx-auto text-gray-300 mb-2" />
            <p>Select a spell to view casting details</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SpellCastingPanel;
