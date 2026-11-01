import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RightSheet } from '../RightSheet';
import { buildCharacterSheet } from '../useOverhaulViewModel';

import type { Character } from '@/types/character';

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));

const scores = {
  strength: { score: 10, modifier: 0, savingThrow: false },
  dexterity: { score: 14, modifier: 2, savingThrow: false },
  constitution: { score: 14, modifier: 2, savingThrow: false },
  intelligence: { score: 10, modifier: 0, savingThrow: false },
  wisdom: { score: 12, modifier: 1, savingThrow: false },
  charisma: { score: 16, modifier: 3, savingThrow: false },
};

/** Session loader shape: class is a name stub, class_features is the GET overlay. */
function sessionCharacter(partial: Partial<Character>): Character {
  return {
    id: 'session-hero',
    name: 'Clarice',
    level: 3,
    race: { name: 'Human', speed: 30, traits: [], languages: [] },
    abilityScores: scores,
    character_stats: { current_hit_points: 18, max_hit_points: 18 },
    ...partial,
  } as unknown as Character;
}

function panelText(character: Character): string {
  const sheet = buildCharacterSheet(character);
  render(<RightSheet c={sheet} />);
  return document.body.textContent ?? '';
}

describe('in-session sheet class resources (#1061)', () => {
  it('shows sorcery points, ki, and lay on hands from the level table', () => {
    expect(
      panelText(sessionCharacter({ class: { name: 'Sorcerer' } as Character['class'] })),
    ).toMatch(/Sorcery Points[\s\S]*3\s*\/\s*3/);
    expect(panelText(sessionCharacter({ class: { name: 'Monk' } as Character['class'] }))).toMatch(
      /Ki Points[\s\S]*3\s*\/\s*3/,
    );
    expect(
      panelText(sessionCharacter({ class: { name: 'Paladin' } as Character['class'] })),
    ).toMatch(/Lay on Hands[\s\S]*15\s*\/\s*15/);
  });

  it('reads the server class_features overlay the standalone sheet reads', () => {
    const text = panelText(
      sessionCharacter({
        class: { name: 'Paladin' } as Character['class'],
        classFeatures: {
          lay_on_hands: { currentUses: 3, maxUses: 15 },
          divine_sense: { currentUses: 1, maxUses: 4 },
        },
      }),
    );
    expect(text).toMatch(/Lay on Hands[\s\S]*3\s*\/\s*15/);
    expect(text).toMatch(/Divine Sense[\s\S]*1\s*\/\s*4/);
    expect(text).not.toMatch(/Lay on Hands[\s\S]*15\s*\/\s*15/);
  });

  it('shows Second Wind uses, including a spent use from class_features', () => {
    expect(
      panelText(sessionCharacter({ class: { name: 'Fighter' } as Character['class'] })),
    ).toMatch(/Second Wind[\s\S]*1\s*\/\s*1/);
    const spent = panelText(
      sessionCharacter({
        class: { name: 'Fighter' } as Character['class'],
        classFeatures: { second_wind: { currentUses: 0, maxUses: 1 } },
      }),
    );
    expect(spent).toMatch(/Second Wind[\s\S]*0\s*\/\s*1/);
  });
});
