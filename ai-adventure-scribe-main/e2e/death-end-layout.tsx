import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { DyingPanel } from '../src/features/game-session/components/game/dying/DyingPanel';
import { FallenEndState } from '../src/features/game-session/components/game/game-content/DeathScreen';
import '../src/index.css';

document.body.classList.add('ir-table-look');

const params = new URLSearchParams(window.location.search);
const view = params.get('view');
const characterName = params.get('longName') === '1' ? 'Bartholomew the Unbroken' : 'The Scholar';
const root = document.getElementById('root');
if (!root) throw new Error('missing root');

createRoot(root).render(
  <div className="ir-app h-[100dvh]">
    {view === 'dying' ? (
      <DyingPanel
        name={characterName}
        state="dying"
        successes={1}
        failures={2}
        isOwnTurn
        onRoll={() => undefined}
        autoRollSecondsLeft={38}
        waitingOn={null}
      />
    ) : (
      <MemoryRouter>
        <FallenEndState
          characterName={characterName}
          campaignName="Abyssal Descent"
          identity="Human Wizard · Level 1"
          chooseHeroHref="/explore/abyssal-descent/choose-character?campaignId=camp-1"
          storyContent={
            <p>
              The saved log {`MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM`}
            </p>
          }
        />
      </MemoryRouter>
    )}
  </div>,
);
