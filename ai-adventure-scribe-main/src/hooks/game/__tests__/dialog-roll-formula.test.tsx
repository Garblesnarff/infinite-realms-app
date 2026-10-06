/**
 * #2614. The dialog formula comes from the real queue producer
 * (useAiRollProcessor → the pending roll requestDiceRoll stores → useMessageDiceRolls)
 * and the real dialog hook. The engine total is the server modifier added to the
 * same die: calculateCompanionRollModifier for saves, ability checks and skills,
 * resolveAttackRules for attacks.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  companionModifier,
  dialogFormula,
  dialogRequestFromQueue,
  expectTotalEqualsEngine,
  queueRoll,
  scoresOf,
  sheetCharacter,
} from './dialog-roll-formula.fixture';
import { resolveAttackRules } from '../../../../server-bun/src/services/combat/combat-rules';

import { DiceRollRequest } from '@/components/game/DiceRollRequest';

vi.mock('@/contexts/CharacterContext', () => ({ useCharacter: vi.fn() }));
vi.mock('@/contexts/GameContext', () => ({ useGame: vi.fn() }));
vi.mock('@/hooks/combat/use-player-roll-host', () => ({
  settleCombatAttackRoll: vi.fn(() => false),
  settleCombatCheckRoll: vi.fn(() => false),
  settleCombatInitiativeRoll: vi.fn(() => false),
}));
vi.mock('@/services/combat/player-roll-bridge', () => ({
  hasPendingPlayerRoll: vi.fn(() => false),
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/utils/error-handler', () => ({ handleAsyncError: vi.fn() }));

describe('dialog roll formula (#2614)', () => {
  const character = sheetCharacter();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rolls a DEX save 1d20 as 1d20+4 and the dialog total equals the engine total', () => {
    const queued = queueRoll(character, {
      type: 'save',
      formula: '1d20',
      purpose: 'Dexterity saving throw',
    });
    expect(queued.rollConfig.modifier).toBe(0);
    const request = dialogRequestFromQueue(queued);
    expect(request.formula).toBe('1d20+0');
    const formula = dialogFormula(character, request);
    expect(companionModifier('save', 'dexterity', character).modifier).toBe(4);
    expect(formula).toBe('1d20+4');
    expectTotalEqualsEngine(formula, 4);
    render(<DiceRollRequest request={request} onResult={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: /roll 1d20\+4 for dexterity saving throw/i }),
    ).toBeInTheDocument();
  });

  it('uses the bare ability modifier for a WIS save without proficiency', () => {
    const queued = queueRoll(character, {
      type: 'save',
      formula: '1d20',
      purpose: 'Wisdom saving throw',
    });
    const formula = dialogFormula(character, dialogRequestFromQueue(queued));
    const engine = companionModifier('save', 'wisdom', character);
    expect(engine.isProficient).toBe(false);
    expect(engine.modifier).toBe(1);
    expect(formula).toBe('1d20+1');
    expectTotalEqualsEngine(formula, engine.modifier);
  });

  it('leaves an ability check on the modifier the queue already applied', () => {
    const queued = queueRoll(character, {
      type: 'check',
      formula: '1d20',
      purpose: 'Dexterity check',
    });
    expect(queued.rollConfig.modifier).toBe(2);
    const request = dialogRequestFromQueue(queued);
    expect(request.formula).toBe('1d20+2');
    const formula = dialogFormula(character, request);
    expect(formula).toBe(`1d20+${queued.rollConfig.modifier}`);
    expect(companionModifier('ability', 'dexterity', character).modifier).toBe(
      queued.rollConfig.modifier,
    );
    expectTotalEqualsEngine(formula, queued.rollConfig.modifier);
  });

  it('leaves a skill check on the modifier the queue already applied', () => {
    const queued = queueRoll(character, {
      type: 'skill_check',
      formula: '1d20',
      purpose: 'Stealth check',
    });
    expect(queued.rollConfig.modifier).toBe(4);
    const request = dialogRequestFromQueue(queued);
    expect(request.formula).toBe('1d20+4');
    const formula = dialogFormula(character, request);
    expect(formula).toBe(`1d20+${queued.rollConfig.modifier}`);
    expect(companionModifier('skill', 'stealth', character).modifier).toBe(
      queued.rollConfig.modifier,
    );
    expectTotalEqualsEngine(formula, queued.rollConfig.modifier);
  });

  it('rolls an attack with the attack bonus', () => {
    const queued = queueRoll(character, {
      type: 'attack',
      formula: '1d20',
      purpose: 'Longsword attack',
    });
    expect(queued.rollConfig.modifier).toBe(0);
    const request = dialogRequestFromQueue(queued);
    expect(request.formula).toBe('1d20+0');
    const formula = dialogFormula(character, request);
    const scores = scoresOf(character);
    const engine = resolveAttackRules({
      strength: scores.strength.score,
      dexterity: scores.dexterity.score,
      level: character.level ?? 1,
      baseTargetAc: 10,
      weapon: {
        id: 'longsword',
        name: 'Longsword',
        damageDice: '1d8',
        damageType: 'slashing',
        normalRange: 5,
        magicBonus: 0,
        finesse: false,
        ranged: false,
        proficient: true,
      },
    });
    expect(engine.attackBonus).toBe(5);
    expect(formula).toBe('1d20+5');
    expectTotalEqualsEngine(formula, engine.attackBonus);
  });

  it('labels a save when no character is loaded', () => {
    const queued = queueRoll(null, {
      type: 'save',
      formula: '1d20',
      purpose: 'Dexterity saving throw',
    });
    const request = dialogRequestFromQueue(queued);
    expect(request.formula).toBe('1d20+0');
    expect(dialogFormula(null, request)).toBe('modifier unknown');
    render(<DiceRollRequest request={request} onResult={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('modifier unknown');
    expect(screen.queryByRole('button', { name: /^roll /i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss roll request/i })).toBeInTheDocument();
  });

  it('does not read "strong" as Strength on a Dexterity save', () => {
    const queued = queueRoll(character, {
      type: 'save',
      formula: '1d20',
      purpose: 'Dexterity saving throw against the strong wind',
    });
    const formula = dialogFormula(character, dialogRequestFromQueue(queued));
    expect(companionModifier('save', 'dexterity', character).modifier).toBe(4);
    expect(formula).toBe('1d20+4');
  });

  it('rolls a death save as the flat d20', () => {
    const queued = queueRoll(character, {
      type: 'save',
      formula: '1d20',
      purpose: 'Death saving throw',
    });
    const request = dialogRequestFromQueue(queued);
    expect(request.formula).toBe('1d20+0');
    expect(dialogFormula(character, request)).toBe('1d20+0');
    render(<DiceRollRequest request={request} onResult={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: /roll 1d20\+0 for death saving throw/i }),
    ).toBeInTheDocument();
  });

  it('keeps a damage formula', () => {
    const queued = queueRoll(character, {
      type: 'damage',
      formula: '2d6+3',
      purpose: 'Longsword damage',
    });
    expect(dialogFormula(character, dialogRequestFromQueue(queued))).toBe('2d6+3');
  });
});
