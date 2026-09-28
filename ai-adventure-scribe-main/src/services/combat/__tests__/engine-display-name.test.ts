import { describe, expect, it } from 'vitest';

import {
  formatVersusArmorClass,
  playerFacingWeaponName,
  titleCaseSlug,
} from '../../../../shared/engine-display-name';
import { formatCombatEngineOutcome, formatRefusedSpellOutcome } from '../combat-outcome-transcript';

const SCHOLAR = '1bc3932f-da2d-4525-84e5-77a31a4b3bef';
const SPIDER = '779792b2-aef0-4288-be43-19aba2530eba';

const roster = [
  { id: SCHOLAR, name: null, slug: 'the-scholar' },
  { id: SPIDER, name: 'The Vitruvian Spider', slug: 'the-vitruvian-spider' },
];

describe('engine lines name combatants from the roster (#2306)', () => {
  it('title-cases a slug when the roster has no name, and never prints a UUID', () => {
    const line = formatCombatEngineOutcome(
      { action_type: 'cast_spell', actor_id: SCHOLAR, target_ids: [SPIDER] },
      {
        actorName: SCHOLAR,
        targetName: 'the-vitruvian-spider',
        spellName: 'Chill Touch',
        d20: 10,
        attackBonus: 6,
        totalAttackRoll: 16,
        targetAC: 12,
        hit: true,
        finalDamage: 3,
        damageType: 'necrotic',
      },
      roster,
    );

    expect(line).toBe(
      '⚙️ Engine: The Scholar cast Chill Touch at The Vitruvian Spider — spell attack 10 + 6 = 16 vs AC 12 — HIT. 3 necrotic damage.',
    );
    expect(line).not.toContain(SCHOLAR);
    expect(line).not.toContain('the-scholar');
    expect(line).not.toContain('the-vitruvian-spider');
  });

  it('snapshots each outcome with display names', () => {
    const attack = { action_type: 'attack', actor_id: SPIDER, target_ids: [SCHOLAR] };
    expect(
      formatCombatEngineOutcome(
        attack,
        {
          d20: 4,
          attackBonus: 3,
          totalAttackRoll: 7,
          targetAC: 11,
          hit: false,
          weaponResolution: { resolved: 'The Vitruvian Spider attack' },
        },
        roster,
      ),
    ).toBe(
      '⚙️ Engine: The Vitruvian Spider rolled 4 + 3 = 7 vs AC 11 against The Scholar with strike — MISS. No damage.',
    );

    expect(
      formatCombatEngineOutcome(
        attack,
        {
          resolvedAs: 'movement_only',
          movedFeet: 40,
          distanceFeet: 15,
          reachFeet: 5,
        },
        roster,
      ),
    ).toBe(
      '⚙️ Engine: The Vitruvian Spider moved 40 ft toward The Scholar; distance 15 ft (reach 5 ft); no attack was rolled.',
    );

    expect(
      formatCombatEngineOutcome(
        { action_type: 'cast_spell', actor_id: SCHOLAR, target_ids: [SPIDER] },
        {
          saveAbility: 'dex',
          saveRoll: 9,
          saveDC: 13,
          saved: true,
          spellName: 'Acid Splash',
          hit: false,
        },
        roster,
      ),
    ).toBe(
      '⚙️ Engine: The Scholar cast Acid Splash at The Vitruvian Spider — DEX save 9 vs DC 13 — PASS. No damage.',
    );

    expect(
      formatCombatEngineOutcome(
        { action_type: 'cast_spell', actor_id: SCHOLAR, target_ids: [SPIDER] },
        {
          autoHit: true,
          hit: true,
          spellName: 'Magic Missile',
          finalDamage: 8,
          damageType: 'force',
          targetNewHp: 0,
          targetIsDead: true,
        },
        roster,
      ),
    ).toBe(
      '⚙️ Engine: The Scholar cast Magic Missile at The Vitruvian Spider — AUTO-HIT. 8 force damage. The Vitruvian Spider is now at 0 HP and is DEAD.',
    );

    expect(
      formatRefusedSpellOutcome(SCHOLAR, 'Chill Touch', 'Combat participant not found', roster),
    ).toBe(
      '⚙️ Engine: The Scholar\'s spell "Chill Touch" was refused (Combat participant not found). No roll, no damage, no wound.',
    );
  });

  it('names half cover on the line and still compares the roll to seated AC plus that bonus', () => {
    const line = formatCombatEngineOutcome(
      { action_type: 'cast_spell', actor_id: SCHOLAR, target_ids: [SPIDER] },
      {
        spellName: 'Chill Touch',
        d20: 15,
        attackBonus: 5,
        totalAttackRoll: 20,
        baseAc: 12,
        coverBonus: 2,
        cover: 1,
        targetAC: 14,
        hit: true,
        finalDamage: 5,
        damageType: 'necrotic',
      },
      roster,
    );
    expect(line).toContain('vs AC 12 (+2 half cover = 14)');
    expect(formatVersusArmorClass({ baseAc: 12, coverBonus: 5, cover: 2, targetAC: 17 })).toBe(
      'vs AC 12 (+5 three-quarters cover = 17)',
    );
  });
});

describe('slug and weapon fallbacks (#2306)', () => {
  it('title-cases a slug by splitting on hyphens and underscores', () => {
    expect(titleCaseSlug('the-scholar')).toBe('The Scholar');
    expect(titleCaseSlug('will-o-wisp')).toBe('Will O Wisp');
    expect(titleCaseSlug('the_scholar')).toBe('The Scholar');
  });

  it('rewrites a bare attack or "<name> attack", and keeps Sneak Attack', () => {
    expect(playerFacingWeaponName('attack')).toBe('strike');
    expect(playerFacingWeaponName('The Vitruvian Spider attack', 'The Vitruvian Spider')).toBe(
      'strike',
    );
    expect(playerFacingWeaponName('Sneak Attack', 'The Vitruvian Spider')).toBe('Sneak Attack');
    expect(playerFacingWeaponName('Opportunity Attack')).toBe('Opportunity Attack');
  });
});
