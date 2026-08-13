import { describe, expect, it } from 'vitest';

import { RulesPrompts } from '../rules-prompts';

describe('RulesPrompts combat transition contract', () => {
  it('hard-links combat-signaling rolls to a structured start with good and bad examples', () => {
    const prompt = RulesPrompts.buildRulesOfPlaySection();
    expect(prompt).toContain('<combat_transition_link>');
    expect(prompt).toContain('REQUIRES `combat_transition: "start"`');
    expect(prompt).toContain('✅ GOOD');
    expect(prompt).toContain('❌ BAD');
    expect(prompt).toContain('Combat narrated only in `text` is a contract violation');
  });

  it('teaches all four check-governance rules at the DM prompt seam', () => {
    const prompt = RulesPrompts.buildRulesOfPlaySection();

    expect(prompt).toContain('<check_governance>');
    expect(prompt).toMatch(/uncertain outcome AND meaningful\s+stakes/);
    expect(prompt).toContain('dump-stat ability is never a free success');
    expect(prompt).toContain('declared action determines the canonical skill or ability');
    expect(prompt).toMatch(/declined\s+option,\s+previously\s+offered\s+alternative/);
    expect(prompt).toContain('do not name an item, person, secret');
    expect(prompt).toContain('never name undiscovered content');
  });
});
