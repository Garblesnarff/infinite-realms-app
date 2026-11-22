import { describe, expect, it } from 'vitest';

import {
  LEGAL_ACTION_TYPES,
  type LegalActionType,
} from '../../../../shared/combat-legal-action-types';
import {
  attackAction,
  DEATH_SAVE_FAILED,
  FIGHT_ROSTER,
  PLAYER_HITS_ENEMY,
  PLAYER_MAGIC_MISSILE,
  REEVES,
  SCHOLAR,
  spellAction,
} from '../../../../shared/test-fixtures/engine-results';
import { formatCombatActionParts, formatDeathSaveParts } from '../combat-outcome-transcript';

/**
 * #1618: every action type the legal-actions menu can offer must print an engine line, or
 * say why it prints none. The hook (`use-combat-legal-actions.ts`) posts whatever
 * `formatCombatActionParts` returns, and an empty return posts nothing and throws nothing,
 * so a missing branch is silent. This table fails when a type that should print formats to [].
 *
 * Each row names the `action_type` the hook passes to the formatter (`spell` is sent as
 * `cast_spell`, `divine_smite` as `attack`) and a result shaped like the engine's.
 */
const ACTOR = SCHOLAR.id;
const TARGET = REEVES.id;

/** The engine's Lay on Hands heal result (`resolveLayOnHands`, paladin-features-service.ts). */
const LAY_ON_HANDS_HEAL = {
  ok: true,
  healed: 3,
  poolRemaining: 12,
  poolMax: 15,
  message: 'The Scholar lays on hands and restores 3 HP to themself. Pool: 12 of 15 HP remaining.',
};

type Row =
  | { prints: true; formatAs: string; action: Record<string, unknown>; value: unknown }
  | { prints: false; reason: string };

const TABLE: Record<LegalActionType, Row> = {
  attack: {
    prints: true,
    formatAs: 'attack',
    action: attackAction(SCHOLAR, REEVES),
    value: PLAYER_HITS_ENEMY,
  },
  // #1639: an off-hand swing prints the attack line, and the line names the off-hand weapon.
  off_hand_attack: {
    prints: true,
    formatAs: 'attack',
    action: attackAction(SCHOLAR, REEVES),
    value: PLAYER_HITS_ENEMY,
  },
  reckless_attack: {
    prints: true,
    formatAs: 'attack',
    action: attackAction(SCHOLAR, REEVES),
    value: PLAYER_HITS_ENEMY,
  },
  spell: {
    prints: true,
    formatAs: 'cast_spell',
    action: spellAction(SCHOLAR, REEVES),
    value: PLAYER_MAGIC_MISSILE,
  },
  move: {
    prints: true,
    formatAs: 'move',
    action: { actor_id: ACTOR },
    value: { path: [{ x: 3, y: 4 }] },
  },
  dash: {
    prints: true,
    formatAs: 'dash',
    action: { actor_id: ACTOR },
    value: { movementGainedFeet: 30 },
  },
  dodge: { prints: true, formatAs: 'dodge', action: { actor_id: ACTOR }, value: {} },
  // #1635: a Cunning Action Dash prints the Dash line; the client formats it as the mode it paid for.
  cunning_action: {
    prints: true,
    formatAs: 'dash',
    action: { actor_id: ACTOR },
    value: { movementGainedFeet: 30 },
  },
  disengage: { prints: true, formatAs: 'disengage', action: { actor_id: ACTOR }, value: {} },
  second_wind: {
    prints: true,
    formatAs: 'second_wind',
    action: { actor_id: ACTOR },
    value: { healed: 6, newHp: 14, maxHp: 14 },
  },
  action_surge: { prints: true, formatAs: 'action_surge', action: { actor_id: ACTOR }, value: {} },
  // #1638: Rage prints the uses left and the round it lasts until.
  rage: {
    prints: true,
    formatAs: 'rage',
    action: { actor_id: ACTOR },
    value: { usesRemaining: 1, expiresRound: 11 },
  },
  divine_sense: {
    prints: true,
    formatAs: 'divine_sense',
    action: { actor_id: ACTOR },
    value: {
      success: true,
      usesRemaining: 2,
      message: 'Divine Sense: 2 uses left.',
    },
  },
  lay_on_hands: {
    prints: true,
    formatAs: 'lay_on_hands',
    action: { actor_id: ACTOR, target_ids: [TARGET] },
    value: LAY_ON_HANDS_HEAL,
  },
  divine_smite: {
    prints: true,
    formatAs: 'attack',
    action: attackAction(SCHOLAR, REEVES),
    value: PLAYER_HITS_ENEMY,
  },
  flexible_casting: {
    prints: true,
    formatAs: 'flexible_casting',
    action: { actor_id: ACTOR },
    value: {
      message: 'The Scholar converts a 1st-level slot into 1 sorcery point.',
      usesRemaining: 3,
      effect: 'convert',
    },
  },
  metamagic: {
    prints: false,
    reason: 'arms the next cast on the client; no engine call, so no line (#1233)',
  },
  inspiration: {
    prints: false,
    reason:
      'arms advantage on the client and spends nothing; the armed coin is the feedback (#1414)',
  },
  use_item: {
    prints: true,
    formatAs: 'use_item',
    action: { actor_id: ACTOR },
    value: { healed: 5, itemName: 'Potion of Healing', newHp: 14, maxHp: 14 },
  },
  flee: {
    prints: true,
    formatAs: 'flee',
    action: { actor_id: ACTOR },
    value: { exit: 'fled' },
  },
  yield: {
    prints: true,
    formatAs: 'yield',
    action: { actor_id: ACTOR },
    value: { exit: 'surrendered' },
  },
  death_save: {
    prints: false,
    reason:
      'filtered out of the menu (use-combat-legal-actions.ts); its line comes from formatDeathSaveParts, checked below',
  },
  end_turn: {
    prints: false,
    reason: 'the server writes the turn boundary row; the client posts no engine line for it',
  },
};

describe('combat action engine lines (#1618)', () => {
  it('has a row for every legal action type the server can return', () => {
    expect(Object.keys(TABLE).sort()).toEqual([...LEGAL_ACTION_TYPES].sort());
  });

  for (const type of LEGAL_ACTION_TYPES) {
    const row = TABLE[type];
    if (row.prints) {
      it(`${type} formats to a non-empty engine line`, () => {
        const parts = formatCombatActionParts(
          { ...row.action, action_type: row.formatAs },
          row.value,
          FIGHT_ROSTER,
        );
        expect(parts.length, `${type} formatted to []`).toBeGreaterThan(0);
        for (const part of parts) {
          expect(part.line.trim().length).toBeGreaterThan(0);
        }
      });
    } else {
      it(`${type} prints no formatter line by design: ${row.reason}`, () => {
        if (type === 'death_save') {
          const parts = formatDeathSaveParts({ deathSaves: [DEATH_SAVE_FAILED] }, FIGHT_ROSTER);
          expect(parts.length, 'death_save formatted to []').toBeGreaterThan(0);
          return;
        }
        expect(
          formatCombatActionParts({ actor_id: ACTOR, action_type: type }, {}, FIGHT_ROSTER),
        ).toEqual([]);
      });
    }
  }

  it('Lay on Hands heal line quotes the engine message with its HP and pool numbers', () => {
    const [part] = formatCombatActionParts(
      { actor_id: ACTOR, action_type: 'lay_on_hands' },
      LAY_ON_HANDS_HEAL,
      FIGHT_ROSTER,
    );
    expect(part.line).toContain('used Lay on Hands');
    expect(part.line).toContain('restores 3 HP');
    expect(part.line).toContain('Pool: 12 of 15 HP remaining.');
  });

  it('Lay on Hands cure line quotes the engine message for the cure and the pool', () => {
    const [part] = formatCombatActionParts(
      { actor_id: ACTOR, action_type: 'lay_on_hands' },
      {
        ok: true,
        healed: 0,
        poolRemaining: 10,
        poolMax: 15,
        cured: 'poison',
        message:
          'The Scholar lays on hands and neutralizes the poison. Pool: 10 of 15 HP remaining.',
      },
      FIGHT_ROSTER,
    );
    expect(part.line).toContain('used Lay on Hands');
    expect(part.line).toContain('neutralizes the poison');
    expect(part.line).toContain('Pool: 10 of 15 HP remaining.');
  });
});
