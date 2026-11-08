import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { formatCombatEngineParts, formatDeathSaveParts } from '../shared/combat-outcome-transcript';
import {
  DYING_SCHOLAR_ENCOUNTER,
  DYING_SCHOLAR_PARTICIPANT,
} from '../shared/test-fixtures/dying-participant-wire';
import {
  attackAction,
  DEATH_SAVE_FAILED,
  DEATH_SAVE_PASSED,
  ENEMY_STRIKES_DOWNED_PLAYER,
  FIGHT_ROSTER,
  REEVES,
  SCHOLAR,
} from '../shared/test-fixtures/engine-results';
import { mapAuthoritativeCombat } from '../src/contexts/combat/authoritative-combat-state';
import { DyingPanel } from '../src/features/game-session/components/game/dying/DyingPanel';
import { EngineResultCardView } from '../src/features/game-session/components/game/EngineResultCardView';
import { FallenEndState } from '../src/features/game-session/components/game/game-content/DeathScreen';
import { summarizeCombatTurn } from '../src/features/game-session/components/game/overhaul/combat-turn-order';
import { CombatTurnBar } from '../src/features/game-session/components/game/overhaul/CombatTurnBar';
import '../src/index.css';

document.body.classList.add('ir-table-look');

const params = new URLSearchParams(window.location.search);
const view = params.get('view');
const characterName = params.get('longName') === '1' ? 'Bartholomew the Unbroken' : 'The Scholar';
// `tall=1` adds the end screen's real optional blocks (final lines and a run
// summary) so the page is taller than a phone viewport and actually scrolls.
// Without it the short end screen fits 390x844 with nothing to scroll, so a
// sticky bar could never be observed. Layout only: no mechanics are invented.
const tall = params.get('tall') === '1';
// Real engine lines from DeathScreen.test.tsx (run D2, #2516), verbatim.
// Repeated only to create scroll height for the sticky-bar layout test;
// no new numbers or mechanics are introduced.
const realFinalLines = [
  '⚙️ Engine: Vitruvian Spider rolled 11 + 3 = 14 vs AC 11 against The Scholar with strike — HIT. 3 piercing damage. The Scholar is now at 0 HP and is unconscious.',
  '⚙️ Engine: Rolled 2: the third failure. The Scholar is dead.',
];
const root = document.getElementById('root');
if (!root) throw new Error('missing root');

const deathCase = (save: unknown) => formatDeathSaveParts({ deathSaves: [save] }, FIGHT_ROSTER);
const successParts = deathCase(DEATH_SAVE_PASSED);
const failureParts = deathCase(DEATH_SAVE_FAILED);
const nat20Parts = deathCase({
  ...DEATH_SAVE_FAILED,
  roll: 20,
  isSuccess: true,
  isCritical: true,
  wasRevived: true,
  successes: 0,
  failures: 0,
  newCurrentHp: 1,
});
// Absent-HP producer case: the server's DeathSaveResult carries newCurrentHp
// only when it reports it; a revival without that field must not invent an
// HP number on the card (#1431 review FIX1).
const nat20NoHpParts = deathCase({
  ...DEATH_SAVE_FAILED,
  roll: 20,
  isSuccess: true,
  isCritical: true,
  wasRevived: true,
  successes: 0,
  failures: 0,
  newCurrentHp: undefined,
});
const nat1Parts = deathCase({
  ...DEATH_SAVE_FAILED,
  roll: 1,
  isSuccess: false,
  isCritical: true,
  failures: 2,
});
const strikeParts = formatCombatEngineParts(
  attackAction(REEVES, SCHOLAR),
  ENEMY_STRIKES_DOWNED_PLAYER,
  FIGHT_ROSTER,
  { targetHp: true, targetMaxHp: 7 },
);
const showTargetNumbers = params.get('targets') !== 'hidden';
const cardsCases = [
  ['card-success', successParts],
  ['card-failure', failureParts],
  ['card-nat20', nat20Parts],
  ['card-nat20-nohp', nat20NoHpParts],
  ['card-nat1', nat1Parts],
  ['card-strike', strikeParts],
] as const;

function CardsView(): React.ReactElement {
  return (
    <main className="mx-auto max-w-[640px] space-y-4 p-4 text-white">
      <h1 className="text-xl font-bold">Dying cards — fixture</h1>
      {cardsCases.map(([id, parts]) => (
        <section key={id} data-testid={id}>
          {parts.map((part, index) => (
            <EngineResultCardView
              key={`${id}-${index}`}
              card={part.card}
              showTargetNumbers={showTargetNumbers}
            />
          ))}
        </section>
      ))}
    </main>
  );
}

function TurnBarView(): React.ReactElement {
  const dying = mapAuthoritativeCombat({
    encounter: { ...DYING_SCHOLAR_ENCOUNTER, currentRound: 4, currentTurnOrder: 0 },
    participants: [
      DYING_SCHOLAR_PARTICIPANT,
      {
        ...DYING_SCHOLAR_PARTICIPANT,
        id: 'm1',
        characterId: null,
        name: 'Captain Sarah Reeves',
        participantType: 'monster',
        initiative: 4,
        vitalState: 'standing',
        status: {
          ...DYING_SCHOLAR_PARTICIPANT.status,
          currentHp: 7,
          isConscious: true,
          deathSavesFailures: 0,
        },
      },
    ],
  } as never);
  const summary = summarizeCombatTurn(dying)!;
  const playerDown =
    dying.participants.find((p) => p.participantType === 'player')?.currentHitPoints ?? 1;
  return (
    <main className="p-4">
      <CombatTurnBar
        summary={summary}
        busy={null}
        hp={{ current: 0, maximum: 7, temp: 0 }}
        playerDown={playerDown <= 0}
      />
    </main>
  );
}

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
    ) : view === 'cards' ? (
      <CardsView />
    ) : view === 'turnbar' ? (
      <TurnBarView />
    ) : (
      <MemoryRouter>
        <FallenEndState
          characterName={characterName}
          campaignName="Abyssal Descent"
          identity="Human Wizard · Level 1"
          finalLines={tall ? [...realFinalLines, ...realFinalLines, ...realFinalLines] : undefined}
          runSummary={
            tall
              ? { turns: 16, fights: 1, monstersDefeated: 0, rounds: 4, fatalRoll: '2' }
              : undefined
          }
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
