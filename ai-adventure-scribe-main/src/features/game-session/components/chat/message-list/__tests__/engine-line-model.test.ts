import { describe, expect, it } from 'vitest';

import { parseEngineLine, isEngineLine, engineLineModelFromCheck } from '../engine-line-model';

describe('parseEngineLine', () => {
  it('player hit', () => {
    const m = parseEngineLine(
      '⚙️ Engine: The Scholar rolled 14 + 0 = 14 vs AC 11 against Captain Sarah Reeves with Longsword — HIT. 3 slashing damage.',
    );
    expect(m.outcome).toBe('hit');
    expect(m.pill).toBe('Hit');
    expect(m.actorSide).toBe('player');
    expect(m.badge).toBe('14');
    expect(m.math).toBe('14 + 0 = 14');
    expect(m.detail).toContain('vs AC 11');
  });

  it('crit', () => {
    const m = parseEngineLine(
      '⚙️ Engine: The Scholar rolled 20 + 0 = 20 vs AC 11 against Captain Sarah Reeves with Longsword — CRITICAL HIT. 8 slashing damage.',
    );
    expect(m.outcome).toBe('critical');
    expect(m.pill).toBe('Critical');
  });

  it('miss', () => {
    const m = parseEngineLine(
      '⚙️ Engine: The Scholar rolled 5 + 0 = 5 vs AC 11 against Captain Sarah Reeves with Longsword — MISS. No damage.',
    );
    expect(m.outcome).toBe('miss');
    expect(m.pill).toBe('Miss');
  });

  it('enemy hit on you', () => {
    const m = parseEngineLine(
      '⚙️ Engine: Captain Sarah Reeves rolled 14 + 0 = 14 vs AC 11 against The Scholar with Longsword — HIT. 3 slashing damage. The Scholar is now at 4 HP and is wounded.',
    );
    expect(m.outcome).toBe('enemy-hit');
    expect(m.pill).toBe('Hit');
    expect(m.actorSide).toBe('npc');
  });

  it('enemy miss on you', () => {
    const m = parseEngineLine(
      '⚙️ Engine: Captain Sarah Reeves rolled 5 + 0 = 5 vs AC 11 against The Scholar with Longsword — MISS. No damage.',
    );
    expect(m.outcome).toBe('enemy-miss');
    expect(m.pill).toBe('Miss');
  });

  it('check pass', () => {
    const m = parseEngineLine(
      '⚙️ Engine: Shove: 17 (nat 14+3) vs Goblin Athletics 9 — success — success, Goblin is prone',
    );
    // outcome keyword success -> pass (if not save)
    expect(m.outcome).toBe('pass');
    expect(m.pill).toBe('Pass');
  });

  it('check fail', () => {
    const m = parseEngineLine(
      '⚙️ Engine: Hide: 16 (nat 14+2) vs passive Perception 10 — failure — failure, nothing changes',
    );
    expect(m.outcome).toBe('fail');
    expect(m.pill).toBe('Fail');
  });

  it('enemy saved', () => {
    const m = parseEngineLine(
      '⚙️ Engine: The Scholar cast Acid Splash at Captain Sarah Reeves — DEX save 17 vs DC 14 — PASS. 0 acid damage. Captain Sarah Reeves is now at 9 HP.',
    );
    expect(m.outcome).toBe('saved');
    expect(m.pill).toBe('Saved');
  });

  it('enemy failed save', () => {
    const m = parseEngineLine(
      '⚙️ Engine: The Scholar cast Acid Splash at Captain Sarah Reeves — DEX save 6 vs DC 14 — FAIL. 2 acid damage. Captain Sarah Reeves is now at 9 HP.',
    );
    expect(m.outcome).toBe('failed-save');
    expect(m.pill).toBe('Failed save');
  });

  it('refused', () => {
    const m = parseEngineLine(
      '⚙️ Engine: The Scholar\'s spell "Chill Touch" was refused (it is not your turn). No roll, no damage, no wound.',
    );
    expect(m.outcome).toBe('refused');
    expect(m.pill).toBe('Refused');
  });

  it('slug -> name', () => {
    const m = parseEngineLine(
      '⚙️ Engine: The Scholar rolled 14 + 0 = 14 vs AC 11 against Captain Sarah Reeves with flavor-elemental-corrupted — HIT. 3 slashing damage.',
      {
        nameFor: (s) =>
          s === 'flavor-elemental-corrupted' ? 'Flavor Elemental Corrupted' : undefined,
      },
    );
    expect(m.kicker).toContain('Flavor Elemental Corrupted');
    expect(m.kicker).not.toContain('flavor-elemental-corrupted');
  });

  it('is now at 20 HP -> bloodied', () => {
    const m = parseEngineLine(
      '⚙️ Engine: Captain Sarah Reeves rolled 14 + 0 = 14 vs AC 11 against The Scholar with Longsword — HIT. 3 slashing damage. The Scholar is now at 20 HP and is wounded.',
    );
    expect(m.detail).toContain('bloodied');
    expect(m.detail).not.toContain('20 HP');
  });

  it('no slug in output', () => {
    const m = parseEngineLine(
      '⚙️ Engine: the-apprentice rolled 14 + 0 = 14 vs AC 11 against Captain Sarah Reeves with Longsword — HIT. 3 slashing damage.',
    );
    expect(m.kicker + (m.math ?? '') + (m.detail ?? '')).not.toMatch(/the-apprentice/);
  });

  it('isEngineLine', () => {
    expect(isEngineLine('⚙️ Engine: hi')).toBe(true);
    expect(isEngineLine('hello')).toBe(false);
    expect(isEngineLine('⚙️ Engine: a\n⚙️ Engine: b')).toBe(false);
  });

  it('engineLineModelFromCheck', () => {
    const m = engineLineModelFromCheck({
      kind: 'check',
      label: 'Shove',
      die: 14,
      modifier: 3,
      total: 17,
      dc: 9,
      outcome: 'success',
    });
    expect(m.outcome).toBe('pass');
    expect(m.math).toBe('14 + 3 = 17');
    expect(m.detail).toContain('DC 9');
  });
});
