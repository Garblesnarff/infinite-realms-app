import React from 'react';
import { createRoot } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';

import { TooltipProvider } from '../src/components/ui/tooltip';
import { AuthProvider } from '../src/contexts/AuthContext';
import { CampaignProvider } from '../src/contexts/CampaignContext';
import { CharacterProvider } from '../src/contexts/CharacterContext';
import { useGame } from '../src/contexts/GameContext';
import { GameLayout } from '../src/features/game-session/components/game/game-content/GameLayout';
import GameProviders from '../src/features/game-session/components/game/GameProviders';
import { TRPCProvider } from '../src/infrastructure/api';
import { userDataApi } from '../src/services/user-data-api';
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
        sessionData={{ id: 'layout-session', turn_count: 1 } as never}
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
        <CharacterProvider>
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
