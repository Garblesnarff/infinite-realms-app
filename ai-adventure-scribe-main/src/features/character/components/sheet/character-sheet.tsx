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
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';
import { isFallenCharacter } from '@/utils/character/vital-state';

/** How long the roster end state waits before it asks for the dead run's session again. */
const SESSION_LOOKUP_RETRY_MS = 1500;

/**
 * #2517: the end state shown when a fallen character is opened from
 * /app/characters. The sheet's character does not carry its campaign
 * (transformCharacterData keeps no campaign_id) nor its starter campaign, so
 * both come from the character's sessions (the dead run) — the starter id
 * resolved against the starter-campaign list, the same resolution the game
 * screen performs. Until both settle, the hero-pick button waits rather than
 * racing to the custom-campaign route.
 *
 * #1215 (Hark T3-010): a failed lookup used to leave the button disabled for
 * good under the offer text. It is retried once; if it still fails, or if the
 * fallen hero truly has no campaign, the button and its sentence are hidden
 * instead of offered and disabled.
 */
function FallenSheetEndState({ character }: { character: Character }): React.JSX.Element {
  const { campaigns: starterCampaigns, isLoading: startersLoading } = useStarterCampaigns();
  const [lookup, setLookup] = React.useState<
    | { status: 'pending' }
    | { status: 'failed' }
    | { status: 'done'; campaignId: string | null; starterCampaignId: string | null }
  >({ status: 'pending' });

  React.useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const attempt = async (retriesLeft: number): Promise<void> => {
      try {
        const sessions = await userDataApi.listSessions({
          campaignId: character.campaign_id ?? undefined,
          characterId: character.id,
          limit: 5,
        });
        if (cancelled) return;
        // The run with a starter link wins; otherwise the newest run with a campaign.
        const starterRun = sessions.find((s) => s.starter_campaign_id);
        const run = starterRun ?? sessions.find((s) => s.campaign_id);
        setLookup({
          status: 'done',
          campaignId: character.campaign_id ?? run?.campaign_id ?? null,
          starterCampaignId: starterRun?.starter_campaign_id ?? null,
        });
      } catch (error) {
        if (cancelled) return;
        if (retriesLeft > 0) {
          retryTimer = setTimeout(() => void attempt(retriesLeft - 1), SESSION_LOOKUP_RETRY_MS);
          return;
        }
        // Without the session the route cannot be determined: a starter hero
        // must not fall back to the custom-campaign form by guessing (#2517),
        // so the offer is hidden rather than shown disabled (#1215).
        logger.warn('Fallen hero end state: session lookup failed; hero pick hidden', {
          characterId: character.id,
          error,
        });
        setLookup({ status: 'failed' });
      }
    };
    void attempt(1);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [character.id, character.campaign_id]);

  const resolved = lookup.status === 'done' ? lookup : null;
  const starter = resolved?.starterCampaignId
    ? starterCampaigns.find((c) => c.id === resolved.starterCampaignId)
    : undefined;

  // null hides the offer (no campaign, or the lookup failed). While the lookup
  // is pending the button is shown disabled, so it has no route yet.
  const chooseHeroHref =
    lookup.status === 'pending'
      ? ''
      : resolved?.campaignId
        ? buildChooseHeroHref({
            starterSlug: starter?.slug ?? null,
            campaignId: resolved.campaignId,
          })
        : null;

  return (
    <FallenEndState
      characterName={character.name}
      campaignName={starter?.title ?? null}
      chooseHeroHref={chooseHeroHref}
      chooseHeroPending={
        lookup.status === 'pending' || Boolean(resolved?.starterCampaignId && startersLoading)
      }
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
