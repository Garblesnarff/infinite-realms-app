import React from 'react';
import { createRoot } from 'react-dom/client';

import {
  attackAction,
  ENEMY_FAILS_SAVE,
  ENEMY_HITS_PLAYER,
  FIGHT_ROSTER,
  PLAYER_HITS_ENEMY,
  REEVES,
  SCHOLAR,
  spellAction,
} from '../shared/test-fixtures/engine-results';
import { DiceRollResultFlash } from '../src/components/game/DiceRollResultFlash';
import { MessageRenderer } from '../src/features/game-session/components/chat/message-list/MessageRenderer';
import { SystemMessage } from '../src/features/game-session/components/chat/message-list/SystemMessage';
import { formatCombatEngineParts } from '../src/services/combat/combat-outcome-transcript';
import { initiativeCard } from '../src/services/combat/engine-result-card';
import '../src/index.css';

const saveCard = formatCombatEngineParts(
  spellAction(SCHOLAR, REEVES),
  ENEMY_FAILS_SAVE,
  FIGHT_ROSTER,
)[0].card;
const attackCard = formatCombatEngineParts(
  attackAction(SCHOLAR, REEVES),
  PLAYER_HITS_ENEMY,
  FIGHT_ROSTER,
)[0].card;
const npcCard = formatCombatEngineParts(
  attackAction(REEVES, SCHOLAR),
  ENEMY_HITS_PLAYER,
  FIGHT_ROSTER,
  { targetHp: true, targetMaxHp: 7 },
)[0].card;
const seating = initiativeCard(
  [
    { id: REEVES.id, name: REEVES.name, initiative: 4, turnOrder: 1, participantType: 'enemy' },
    { id: SCHOLAR.id, name: SCHOLAR.name, initiative: 9, turnOrder: 0, participantType: 'player' },
  ],
  '⚙️ Engine: Initiative — You: 9 + 0 = 9. Captain Sarah Reeves: 4 + 0 = 4.',
)!;

/** The saved narrative-check row: the formatter's text and the queue's context, no diceRoll. */
const checkMessage = {
  text: 'Athletics check: 17 (nat 12+5) success',
  sender: 'player' as const,
  context: {
    location: null,
    emotion: null,
    intent: 'dice_roll',
    rollRequestId: '11111111-1111-4111-8111-111111111111:roll:0',
    handouts: null,
    combat_transition: null,
    scene_spec: false,
    combat_engine_blocks: null,
    combat_ended: false,
    narration_segments: null,
  },
};

document.body.classList.add('ir-table-look');
createRoot(document.getElementById('root')!).render(
  <main className="ir-app ir-table-walnut min-h-screen p-8 text-foreground">
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold">Roll results</h1>
      <section aria-label="Resolved narrative check">
        <h2 className="mb-2 text-xl">Strength (Athletics)</h2>
        <DiceRollResultFlash die={10} modifier={2} total={12} checkSuccess />
      </section>
      <section aria-label="Failed narrative check">
        <h2 className="mb-2 text-xl">Strength check failed</h2>
        <DiceRollResultFlash die={4} modifier={2} total={6} checkSuccess={false} />
      </section>
      <section aria-label="Resolved engine attack">
        <h2 className="mb-2 text-xl">Longsword attack</h2>
        <DiceRollResultFlash
          die={13}
          modifier={5}
          total={18}
          engineOutcome={{
            rollId: 'fixture-attack',
            kind: 'attack',
            d20: 20,
            bonus: 5,
            total: 25,
            hit: true,
            isCritical: true,
          }}
        />
      </section>
      <section aria-label="Missed engine attack">
        <h2 className="mb-2 text-xl">Attack missed</h2>
        <DiceRollResultFlash
          die={13}
          modifier={5}
          total={18}
          engineOutcome={{
            rollId: 'fixture-miss',
            kind: 'attack',
            d20: 4,
            bonus: 5,
            total: 9,
            hit: false,
            isCritical: false,
          }}
        />
      </section>
      <section aria-label="Ability check result">
        <h2 className="mb-2 text-xl">Ability check</h2>
        <MessageRenderer
          message={checkMessage}
          messageId="check-1"
          groupIndex={0}
          msgIndex={0}
          isFirstInGroup
          isLastInGroup
          isPlayer={false}
          isDM={false}
          isCompanion={false}
          expandedMessages={new Set()}
          setExpandedMessages={() => undefined}
          imageByMessage={{}}
          generatingFor={new Set()}
          genErrorByMessage={{}}
          onGenerateScene={async () => undefined}
          onOptionSelect={async () => undefined}
        />
      </section>
      <section aria-label="Save result">
        <h2 className="mb-2 text-xl">Save</h2>
        <SystemMessage
          message={{ sender: 'system', text: saveCard.line, context: { engineCards: [saveCard] } }}
          isFirstInGroup
          isLastInGroup
          displayText={saveCard.line}
        />
      </section>
      <section aria-label="Attack result">
        <h2 className="mb-2 text-xl">Attack</h2>
        <SystemMessage
          message={{
            sender: 'system',
            text: attackCard.line,
            context: { engineCards: [attackCard] },
          }}
          isFirstInGroup
          isLastInGroup
          displayText={attackCard.line}
        />
      </section>
      <section aria-label="Initiative result">
        <h2 className="mb-2 text-xl">Initiative</h2>
        <SystemMessage
          message={{ sender: 'system', text: seating.line, context: { engineCards: [seating] } }}
          isFirstInGroup
          isLastInGroup
          displayText={seating.line}
        />
      </section>
      <section aria-label="NPC roll result">
        <h2 className="mb-2 text-xl">NPC roll</h2>
        <SystemMessage
          message={{
            sender: 'system',
            text: npcCard.line,
            context: { intent: 'combat_npc_result', engineCards: [npcCard] },
          }}
          isFirstInGroup
          isLastInGroup
          displayText={npcCard.line}
        />
      </section>
    </div>
  </main>,
);
