import React from 'react';
import { createRoot } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';

import { TooltipProvider } from '../src/components/ui/tooltip';
import { AuthProvider } from '../src/contexts/AuthContext';
import { CampaignProvider, useCampaign } from '../src/contexts/CampaignContext';
import { CharacterProvider } from '../src/contexts/CharacterContext';
import { useSceneBackground } from '../src/contexts/SceneBackgroundContext';
import { GameLayout } from '../src/features/game-session/components/game/game-content/GameLayout';
import GameProviders from '../src/features/game-session/components/game/GameProviders';
import { TRPCProvider } from '../src/infrastructure/api';
import { userDataApi } from '../src/services/user-data-api';
import '../src/index.css';

/**
 * #1432: the fixture behind the landing hero picture (scripts/capture-landing-picture.ts).
 *
 * Every name here is invented: the campaign, the hero and the NPC. The scene art is a repo image,
 * served by the capture script through the public-storage path the game reads. No DM is called;
 * the story is fixed text. This file is separate from table-game-layout.tsx so the Table layout
 * tests keep their own story.
 */

const SESSION_ID = 'layout-session';
const SCENE_ART_URL =
  'https://example.supabase.co/storage/v1/object/public/campaign-art/basalt-ruins.jpg';

/**
 * An engine line, then one DM message: three short paragraphs and two numbered options, which the
 * game shows as option cards under the message. The message carries the location, which fills the
 * scene header. No timestamps, so no date line; no combat summary message, so no legacy card.
 */
const story = [
  {
    id: 'engine-athletics',
    speaker_type: 'system',
    message: 'Athletics 17 SUCCESS',
    sequence_number: 1,
    context: { location: 'Basalt Stair' },
  },
  {
    id: 'dm-0',
    speaker_type: 'dm',
    message:
      'On the far ledge, Mara Quill is already climbing. She looks back once and waves you on.\n\nThe rope holds, but the stone is slick.\n\nSomewhere below, something scrapes against the rock, then goes still.\n\n1. **Climb hand over hand**, keeping your weight low.\n2. **Call down to Mara**, asking what she sees.',
    sequence_number: 2,
    context: {},
  },
];

userDataApi.listSessionMessages = async () => ({
  messages: story as never,
  total: story.length,
  hasMore: false,
});

const noop = (): void => {};
const asyncNoop = async (): Promise<void> => {};
document.body.classList.add('ir-table-look');

function Fixture(): React.JSX.Element {
  const { dispatch: campaignDispatch } = useCampaign();
  const { setSceneBackground } = useSceneBackground();
  React.useEffect(() => {
    campaignDispatch({
      type: 'UPDATE_CAMPAIGN',
      payload: {
        name: 'Abyssal Descent',
        description: 'Find the basalt path',
        difficulty_level: 'medium',
        location: 'Basalt Stair',
        background_image: SCENE_ART_URL,
      } as never,
    });
  }, [campaignDispatch]);
  React.useEffect(() => {
    setSceneBackground(SCENE_ART_URL, 'Basalt ruins', 'location');
  }, [setSceneBackground]);
  const [left, setLeft] = React.useState(window.innerWidth < 700);
  const [right, setRight] = React.useState(window.innerWidth < 700);
  return (
    <div className="ir-app">
      <GameLayout
        sessionId={SESSION_ID}
        campaignIdForHandler={null}
        characterIdForHandler={null}
        sessionData={
          {
            id: SESSION_ID,
            turn_count: 1,
            current_scene_description: 'The rope hangs taut over the chasm.',
          } as never
        }
        updateGameSessionState={asyncNoop}
        isLeftCollapsed={left}
        isRightCollapsed={right}
        setIsLeftCollapsed={setLeft}
        setIsRightCollapsed={setRight}
        showSceneBlurb={false}
        onSceneBlurbToggle={noop}
        combatMode={false}
        showTracker={false}
        setShowTracker={noop}
        isCombatDetected={false}
        isGeneratingGreeting={false}
        innerHandleAIResponse={asyncNoop}
        isDM={false}
        spellCastHandlerRef={{ current: null }}
        contentWarnings={[]}
        comfortLevel="pg13"
        showSafetyInfo={false}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <HelmetProvider>
    <AuthProvider>
      <TRPCProvider>
        <CharacterProvider
          initialCharacter={
            {
              id: 'fixture-hero',
              name: 'The Scholar',
              level: 1,
              race: { name: 'Human', speed: 30 },
              class: { name: 'Wizard', hitDie: 6 },
              character_stats: { current_hit_points: 7, max_hit_points: 7, armor_class: 11 },
            } as never
          }
        >
          <CampaignProvider>
            <MemoryRouter>
              <TooltipProvider>
                <GameProviders sessionId={SESSION_ID} starterCampaignId={null}>
                  <Fixture />
                </GameProviders>
              </TooltipProvider>
            </MemoryRouter>
          </CampaignProvider>
        </CharacterProvider>
      </TRPCProvider>
    </AuthProvider>
  </HelmetProvider>,
);
