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
});
