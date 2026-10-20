import { describe, expect, it } from 'bun:test';

import {
  BOSS_MOVE_MAX_AVERAGE_FRACTION,
  bossMoveDamage,
  chooseRoundBossMove,
  decideBossMove,
  defyStartingCount,
  applyDefyToAttack,
  mookGroupAttackBonus,
  moveKey,
  type AuthoredBossMove,
  type BossMoveFightState,
  type BossMoveHero,
} from '../boss-moves.js';

const move = (slot: AuthoredBossMove['slot'], overrides: Partial<AuthoredBossMove> = {}) =>
  ({
    slot,
    name: `${slot} move`,
    effect: slot === 'Turnabout' ? { kind: 'frighten', ability: 'wis' } : { kind: 'strike' },
    tell: 'tell',
    telegraph: slot === 'Finale' ? 'the hum' : null,
    counterplay: 'cover',
    ...overrides,
  }) as AuthoredBossMove;

const BOSS = { id: 'boss-1', moves: [move('Opener'), move('Turnabout'), move('Finale')] };

const hero = (overrides: Partial<BossMoveHero> = {}): BossMoveHero => ({
  currentHp: 40,
  maxHp: 40,
  conditions: [],
  isDodging: false,
  surrounded: false,
  ...overrides,
});

const fight = (overrides: Partial<BossMoveFightState> = {}): BossMoveFightState => ({
  round: 1,
  lastFiredRound: null,
  heroTurnsEnded: 0,
  movesUsed: [],
  finaleTelegraph: {},
  ...overrides,
});

describe('Opener', () => {
  it('waits for the hero to finish their first turn', () => {
    expect(decideBossMove(BOSS, fight({ heroTurnsEnded: 0 }), hero()).kind).toBe('none');
    const first = decideBossMove(BOSS, fight({ heroTurnsEnded: 1 }), hero());
    expect(first).toMatchObject({ kind: 'fire', move: { slot: 'Opener' } });
  });
});

describe('Turnabout', () => {
  it.each([
    ['grappled', hero({ conditions: ['grappled'] })],
    ['restrained', hero({ conditions: ['restrained'] })],
    ['frightened', hero({ conditions: ['frightened'] })],
    ['surrounded', hero({ surrounded: true })],
    ['at 50% HP', hero({ currentHp: 20 })],
  ])('fires when the hero is %s', (_label, heroState) => {
    const decision = decideBossMove(
      BOSS,
      fight({ heroTurnsEnded: 1, movesUsed: [moveKey('boss-1', 'Opener')] }),
      heroState,
    );
    expect(decision).toMatchObject({ kind: 'fire', move: { slot: 'Turnabout' } });
  });

  it('does not fire for a healthy, unhindered hero', () => {
    const decision = decideBossMove(
      BOSS,
      fight({ movesUsed: [moveKey('boss-1', 'Opener')] }),
      hero(),
    );
    expect(decision.kind).toBe('none');
  });
});

describe('Finale', () => {
  it('is not telegraphed before round 3 for an unbloodied hero', () => {
    expect(decideBossMove(BOSS, fight({ round: 2 }), hero()).kind).toBe('none');
  });

  it('is telegraphed from round 3, and fires the round after', () => {
    const telegraph = decideBossMove(BOSS, fight({ round: 3 }), hero());
    expect(telegraph).toMatchObject({ kind: 'telegraph', move: { slot: 'Finale' } });

    const fired = decideBossMove(
      BOSS,
      fight({ round: 4, lastFiredRound: 3, finaleTelegraph: { 'boss-1': 3 } }),
      hero(),
    );
    expect(fired).toMatchObject({ kind: 'fire', move: { slot: 'Finale' } });
  });

  it('is available early to a bloodied hero, and telegraphed one round before it fires', () => {
    const bloodied = hero({ currentHp: 20 });
    // Turnabout is spent, so the window goes to the early telegraph.
    const spentTurnabout = [moveKey('boss-1', 'Turnabout')];
    expect(
      decideBossMove(BOSS, fight({ round: 1, movesUsed: spentTurnabout }), bloodied).kind,
    ).toBe('telegraph');
    // Once telegraphed, the next round's window belongs to the Finale, and Turnabout is spent.
    expect(
      decideBossMove(
        BOSS,
        fight({
          round: 2,
          heroTurnsEnded: 0,
          finaleTelegraph: { 'boss-1': 1 },
          movesUsed: [moveKey('boss-1', 'Turnabout')],
        }),
        bloodied,
      ),
    ).toMatchObject({ kind: 'fire', move: { slot: 'Finale' } });
  });

  it('is countered when the hero spends counterplay (dodging) on the telegraphed round', () => {
    const decision = decideBossMove(
      BOSS,
      fight({ round: 4, lastFiredRound: 3, finaleTelegraph: { 'boss-1': 3 } }),
      hero({ isDodging: true }),
    );
    expect(decision).toMatchObject({ kind: 'countered', move: { slot: 'Finale' } });
  });
});

describe('once per fight and once per round', () => {
  it('never fires a move that was already spent', () => {
    const decision = decideBossMove(
      BOSS,
      fight({ heroTurnsEnded: 5, movesUsed: [moveKey('boss-1', 'Opener')] }),
      hero(),
    );
    expect(decision.kind).toBe('none');
  });

  it('gives at most one move per round across every boss', () => {
    const second = { id: 'boss-2', moves: [move('Opener')] };
    const choice = chooseRoundBossMove([BOSS, second], fight({ heroTurnsEnded: 1 }), hero());
    expect(choice?.bossId).toBe('boss-1');
    expect(choice?.decision.kind).toBe('fire');
  });

  it('does not act again in a round that already used the window', () => {
    const choice = chooseRoundBossMove(
      [BOSS],
      fight({ heroTurnsEnded: 1, lastFiredRound: 1 }),
      hero(),
    );
    expect(choice).toBeNull();
  });

  it('acts again in the next round', () => {
    const choice = chooseRoundBossMove(
      [BOSS],
      fight({
        round: 2,
        heroTurnsEnded: 2,
        lastFiredRound: 1,
        movesUsed: [moveKey('boss-1', 'Opener')],
      }),
      hero({ conditions: ['grappled'] }),
    );
    expect(choice).toMatchObject({
      bossId: 'boss-1',
      decision: { kind: 'fire', move: { slot: 'Turnabout' } },
    });
  });
});

describe('bossMoveDamage', () => {
  const attacks = [
    { damageDice: '10d10', damageBonus: 4 },
    { damageDice: '2d6', damageBonus: 3 },
    { damageDice: '1d6', damageBonus: 0 },
    { damageDice: '5d6', damageBonus: 0 },
    { damageDice: '4d8', damageBonus: 0 },
  ];
  const maxHps = [10, 20, 40, 80, 200];

  it('never averages above 40% of the hero max HP, for any slot and attack', () => {
    for (const attack of attacks) {
      for (const maxHp of maxHps) {
        for (const slot of ['Opener', 'Turnabout', 'Finale'] as const) {
          const damage = bossMoveDamage(attack, slot, maxHp);
          expect(damage.average).toBeLessThanOrEqual(maxHp * BOSS_MOVE_MAX_AVERAGE_FRACTION + 1e-9);
          expect(damage.average).toBeGreaterThan(0);
        }
      }
    }
  });

  it('scales an uncapped Opener to half the attack, rounded down', () => {
    // 2d6+3 averages 10. Opener is 0.5x = 5; a 200 HP hero's cap (80) is not reached.
    const damage = bossMoveDamage({ damageDice: '2d6', damageBonus: 3 }, 'Opener', 200);
    expect(damage.capped).toBe(false);
    // Whole dice plus a floored bonus: 1d6+1 averages 4.5, never above the 5 target.
    expect(damage.average).toBeLessThanOrEqual(5);
    expect(damage.average).toBeGreaterThanOrEqual(4);
  });

  it('reports when the 40% cap is the thing that set the damage', () => {
    const damage = bossMoveDamage({ damageDice: '10d10', damageBonus: 4 }, 'Finale', 40);
    expect(damage.capped).toBe(true);
    expect(damage.average).toBeLessThanOrEqual(16);
  });

  it('refuses dice it cannot read rather than guessing', () => {
    expect(() => bossMoveDamage({ damageDice: 'a bite', damageBonus: 0 }, 'Opener', 40)).toThrow();
  });
});

describe('solo Defy and mook group attacks', () => {
  it('gives a solo hero one Defy per fight and a party none', () => {
    expect(defyStartingCount(1)).toBe(1);
    expect(defyStartingCount(2)).toBe(0);
    expect(defyStartingCount(4)).toBe(0);
  });

  it('takes the lower of the two d20s when a Defy rerolls an attack', () => {
    expect(applyDefyToAttack(15, 9)).toBe(9);
    expect(applyDefyToAttack(4, 17)).toBe(4);
  });

  it('gives +1 to hit per extra mook, up to four mooks and +3 in total', () => {
    expect(mookGroupAttackBonus(1)).toBe(0);
    expect(mookGroupAttackBonus(2)).toBe(1);
    expect(mookGroupAttackBonus(4)).toBe(3);
    expect(mookGroupAttackBonus(6)).toBe(3);
  });
});

describe('the 40% cap at very low max HP', () => {
  it('deals no damage when the cap is under 1 HP', () => {
    for (const maxHp of [1, 2]) {
      const damage = bossMoveDamage({ damageDice: '10d10', damageBonus: 4 }, 'Finale', maxHp);
      expect(damage.average).toBeLessThanOrEqual(maxHp * BOSS_MOVE_MAX_AVERAGE_FRACTION + 1e-9);
    }
  });
});
