import React from 'react';
import { createRoot } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';

import { TooltipProvider } from '../src/components/ui/tooltip';
import { AuthProvider } from '../src/contexts/AuthContext';
import { CampaignProvider, useCampaign } from '../src/contexts/CampaignContext';
import { CharacterProvider } from '../src/contexts/CharacterContext';
import { useCombat } from '../src/contexts/CombatContext';
import { useGame } from '../src/contexts/GameContext';
import { GameLayout } from '../src/features/game-session/components/game/game-content/GameLayout';
import GameProviders from '../src/features/game-session/components/game/GameProviders';
import { TRPCProvider } from '../src/infrastructure/api';
import { userDataApi } from '../src/services/user-data-api';
import { setRngSeed } from '../src/utils/rng';
import '../src/index.css';

const story = [
  ['dm', 'The rope hangs over a dark chasm.'],
  ['player', 'I test the rope.'],
  ['dm', 'The rope is wet but firm.'],
  ['dm', '⚙️ Engine: You rolled 14 + 2 = 16 vs DC 12 — SUCCESS.'],
  ['dm', 'You lower yourself toward the ledge.'],
  ['dm', '⚙️ Engine: You rolled 4 + 2 = 6 vs DC 12 — FAILED.'],
  ['dm', 'The ledge comes into view.'],
].map(([speaker_type, message], index) => ({
  id: `message-${index}`,
  speaker_type,
  message,
  timestamp: `2026-11-05T00:00:0${index}.000Z`,
  sequence_number: index + 1,
  context: {},
}));
userDataApi.listSessionMessages = async () => ({
  messages: story,
  total: story.length,
  hasMore: false,
});

const noop = (): void => {};
const asyncNoop = async (): Promise<void> => {};
document.body.classList.add('ir-table-look');

function Fixture(): React.JSX.Element {
  const { requestDiceRoll } = useGame();
  const { dispatch: campaignDispatch } = useCampaign();
  const { startCombat } = useCombat();
  const combatFixture = new URLSearchParams(window.location.search).get('combat') === 'true';
  React.useEffect(() => {
    campaignDispatch({
      type: 'UPDATE_CAMPAIGN',
      payload: {
        name: 'Abyssal Descent',
        description: 'Find the basalt path',
        difficulty_level: 'medium',
      },
    });
  }, [campaignDispatch]);
  React.useEffect(() => {
    if (!combatFixture) return;
    setRngSeed(1234);
    void startCombat('layout-session', [
      {
        id: 'hero',
        characterId: 'fixture-hero',
        name: 'The Scholar',
        participantType: 'player',
        currentHitPoints: 7,
        maxHitPoints: 7,
        armorClass: 11,
        initiative: 15,
        initiativeBonus: 0,
      },
      {
        id: 'foe',
        name: 'Captain Reeves',
        participantType: 'monster',
        healthCondition: 'wounded',
        currentHitPoints: 9,
        maxHitPoints: 12,
        armorClass: 12,
        initiative: 0,
        initiativeBonus: 0,
      },
      ...(new URLSearchParams(window.location.search).get('many') === 'true'
        ? Array.from({ length: 12 }, (_, index) => ({
            id: `foe-${index}`,
            name: `Long-named opponent ${index + 1}`,
            participantType: 'monster' as const,
            healthCondition: 'wounded' as const,
            currentHitPoints: 9,
            maxHitPoints: 12,
            armorClass: 12,
            initiative: 0,
            initiativeBonus: 0,
          }))
        : []),
    ]);
    setRngSeed(undefined);
  }, [combatFixture, startCombat]);
  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get('roll') === 'true') {
      requestDiceRoll({
        requestType: 'skill_check',
        description: 'Strength (Athletics)',
        rollConfig: { dieType: 20, count: 1, modifier: 5 },
        dc: 12,
        combatCheckRoll: true,
      });
    }
  }, [requestDiceRoll]);
  const [left, setLeft] = React.useState(window.innerWidth < 700);
  const [right, setRight] = React.useState(window.innerWidth < 700);
  return (
    <div className="ir-app">
      <GameLayout
        sessionId="layout-session"
        campaignIdForHandler={null}
        characterIdForHandler={null}
        sessionData={
          {
            id: 'layout-session',
            turn_count: 1,
            current_scene_description: 'The rope hangs over a dark chasm.',
          } as never
        }
        updateGameSessionState={asyncNoop}
        isLeftCollapsed={left}
        isRightCollapsed={right}
        setIsLeftCollapsed={setLeft}
        setIsRightCollapsed={setRight}
        showSceneBlurb={false}
        onSceneBlurbToggle={noop}
        combatMode={combatFixture}
        showTracker={false}
        setShowTracker={noop}
        isCombatDetected={combatFixture}
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
                <GameProviders sessionId="layout-session" starterCampaignId={null}>
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
