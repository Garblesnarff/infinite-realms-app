import React from 'react';
import { createRoot } from 'react-dom/client';

import {
  formatCombatEngineParts,
  formatDeathSaveParts,
  formatRefusedSpellPart,
} from '../shared/combat-outcome-transcript';
import {
  attackAction,
  spellAction,
  SCHOLAR,
  REEVES,
  FIGHT_ROSTER,
  PLAYER_SPELL_ATTACK_MISSES,
  ENEMY_HITS_PLAYER,
  ENEMY_FAILS_SAVE,
  ENEMY_SAVES,
  ENEMY_CRITS_PLAYER,
  PLAYER_MAGIC_MISSILE,
  ENEMY_MOVES_WITHOUT_ATTACKING,
  DEATH_SAVE_FAILED,
} from '../shared/test-fixtures/engine-results';
import { EngineResultCardView } from '../src/features/game-session/components/game/EngineResultCardView';
import { SpellTargetSaveCard } from '../src/features/game-session/components/game/SpellTargetSaveCard';
import '../src/index.css';

const enemyAttack = attackAction(REEVES, SCHOLAR);
const playerSpell = spellAction(SCHOLAR, REEVES);
const hitOnYou = { targetHp: true, targetMaxHp: 7 };
const showTargetNumbers = new URLSearchParams(window.location.search).get('targets') !== 'hidden';
const cases = [
  [
    'Spell attack, miss',
    formatCombatEngineParts(playerSpell, PLAYER_SPELL_ATTACK_MISSES, FIGHT_ROSTER),
  ],
  [
    'Weapon attack, hit on you',
    formatCombatEngineParts(enemyAttack, ENEMY_HITS_PLAYER, FIGHT_ROSTER, hitOnYou),
  ],
  [
    'Save spell, target fails',
    formatCombatEngineParts(playerSpell, ENEMY_FAILS_SAVE, FIGHT_ROSTER),
  ],
  ['Save spell, target saves', formatCombatEngineParts(playerSpell, ENEMY_SAVES, FIGHT_ROSTER)],
  [
    'Critical hit on you',
    formatCombatEngineParts(enemyAttack, ENEMY_CRITS_PLAYER, FIGHT_ROSTER, hitOnYou),
  ],
  ['Auto-hit spell', formatCombatEngineParts(playerSpell, PLAYER_MAGIC_MISSILE, FIGHT_ROSTER)],
  [
    'Move, no attack',
    formatCombatEngineParts(enemyAttack, ENEMY_MOVES_WITHOUT_ATTACKING, FIGHT_ROSTER),
  ],
  [
    'Spell refused',
    [formatRefusedSpellPart(SCHOLAR.id, 'Chill Touch', 'it is not your turn', FIGHT_ROSTER)],
  ],
  ['Death save', formatDeathSaveParts({ deathSaves: [DEATH_SAVE_FAILED] }, FIGHT_ROSTER)],
] as const;

createRoot(document.getElementById('root')!).render(
  <main className="mx-auto max-w-4xl space-y-3 bg-[#070d1e] p-4 text-white">
    <h1 className="text-xl font-bold">Combat results — fixture</h1>
    {new URLSearchParams(window.location.search).has('save') && (
      <SpellTargetSaveCard
        pending={{
          spec: {
            actorLabel: 'The Scholar',
            targetLabel: 'Captain Sarah Reeves',
            spellName: 'Acid Splash',
            saveAbility: 'DEX',
            saveDc: 14,
          },
          continue: () => {
            document.body.dataset.answer = 'continue';
          },
          cancel: () => {
            document.body.dataset.answer = 'cancel';
          },
        }}
      />
    )}
    {cases.map(([label, parts]) => (
      <section key={label}>
        <h2 className="mb-1 text-sm" style={{ color: '#f6e3b8' }}>
          {label}
        </h2>
        {parts.map((part, index) => (
          <EngineResultCardView
            key={`${label}-${index}`}
            card={part.card}
            showTargetNumbers={showTargetNumbers}
          />
        ))}
      </section>
    ))}
  </main>,
);
