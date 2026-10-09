import React from 'react';
import { useParams } from 'react-router-dom';

import CharacterSheetTabs from './character-sheet-tabs';

import type { Character } from '@/types/character';

import { CharacterSheetSkeleton } from '@/components/skeletons/CharacterSheetSkeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { IRPanel } from '@/components/ui/ir-primitives';
import {
  buildChooseHeroHref,
  FallenEndState,
} from '@/features/game-session/components/game/game-content/DeathScreen';
import { useCharacterData } from '@/hooks/use-character-data';
import { useStarterCampaigns } from '@/hooks/use-starter-campaigns';
import { userDataApi } from '@/services/user-data-api';
import { isFallenCharacter } from '@/utils/character/vital-state';

/**
 * #2517: the end state shown when a fallen character is opened from
 * /app/characters. A character alone does not carry its starter campaign,
 * so the starter id is loaded from the character's sessions (the dead run)
 * and resolved against the starter-campaign list — the same resolution
 * the game screen performs. Until both settle, the hero-pick button waits
 * rather than racing to the custom-campaign route.
 */
function FallenSheetEndState({ character }: { character: Character }): React.JSX.Element {
  const { campaigns: starterCampaigns, isLoading: startersLoading } = useStarterCampaigns();
  const [starterCampaignId, setStarterCampaignId] = React.useState<string | null>(null);
  const [sessionLookupDone, setSessionLookupDone] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const sessions = await userDataApi.listSessions({
          campaignId: character.campaign_id ?? undefined,
          characterId: character.id,
          limit: 5,
        });
        if (!cancelled) {
          setStarterCampaignId(
            sessions.find((s) => s.starter_campaign_id)?.starter_campaign_id ?? null,
          );
          setSessionLookupDone(true);
        }
      } catch {
        // Without the session the route cannot be determined: a starter
        // hero must not fall back to the custom-campaign form, so the
        // button stays disabled rather than guessing (#2517).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [character.id, character.campaign_id]);

  const starter = starterCampaignId
    ? starterCampaigns.find((c) => c.id === starterCampaignId)
    : undefined;

  return (
    <FallenEndState
      characterName={character.name}
      campaignName={starter?.title ?? null}
      chooseHeroHref={buildChooseHeroHref({
        starterSlug: starter?.slug ?? null,
        campaignId: character.campaign_id ?? null,
      })}
      chooseHeroPending={!sessionLookupDone || startersLoading}
    />
  );
}

/**
 * CharacterSheet component displays all character information
 * Now uses the new tabbed layout for better organization and Roll20-style functionality
 * Uses useCharacterData hook for data fetching and state management
 */
const CharacterSheet: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  // #2701: sheet edits save through persistCharacterUpdate (write, then a
  // silent refresh that keeps the tabs mounted). refetch stays for callers
  // that need a full reload with the skeleton.
  const { character, unresolvedData, equipmentUnavailable, loading, persistCharacterUpdate } =
    useCharacterData(id);

  // Show loading state while fetching data
  if (loading) {
    return <CharacterSheetSkeleton />;
  }

  // Early return if no character data is available
  if (!character) {
    return null;
  }

  // #2517: a fallen character is read-only — opening it shows the end
  // state, not the editable sheet.
  if (isFallenCharacter(character)) {
    return (
      <div className="container mx-auto h-[100dvh] px-4 py-8">
        <FallenSheetEndState character={character} />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {unresolvedData.length > 0 && (
        <Alert className="mb-4" data-testid="character-unresolved-data">
          <AlertDescription>
            {unresolvedData.join('. ')}. Showing the stored name with default traits.
          </AlertDescription>
        </Alert>
      )}
      {equipmentUnavailable && (
        <Alert className="mb-4" data-testid="character-equipment-unavailable">
          <AlertDescription>
            Equipment unavailable: this character&apos;s equipment could not be loaded. The rest of
            the sheet is shown.
          </AlertDescription>
        </Alert>
      )}
      <IRPanel className="p-6">
        <CharacterSheetTabs character={character} onCharacterUpdate={persistCharacterUpdate} />
      </IRPanel>
    </div>
  );
};

export default CharacterSheet;
