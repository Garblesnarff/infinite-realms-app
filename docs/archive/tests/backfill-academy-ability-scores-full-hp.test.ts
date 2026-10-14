import { describe, expect, it } from 'vitest';

import {
  formatAbilityScoreBackfillPlan,
  planAbilityScoreBackfill,
} from '../scripts/backfill-academy-ability-scores';

describe('starter ability-score backfill HP carry-forward', () => {
  it('keeps a full-health character full when max HP increases', () => {
    const [reveler] = planAbilityScoreBackfill({
      sessions: [{ character_id: 'reveler', starter_campaign_id: 'academy' }],
      targets: [
        { characterId: 'reveler', starterCampaignId: 'academy', templateKey: 'the-reveler' },
      ],
      characters: [{ id: 'reveler', name: 'The Reveler', class: 'Barbarian', level: 1 }],
      stats: [
        {
          character_id: 'reveler',
          strength: 10,
          dexterity: 10,
          constitution: 10,
          intelligence: 10,
          wisdom: 10,
          charisma: 10,
          armor_class: 10,
          max_hit_points: 10,
          current_hit_points: 10,
        },
      ],
      templates: [
        {
          starter_campaign_id: 'academy',
          template_key: 'the-reveler',
          name: 'The Reveler',
          race: 'Human',
          class: 'Barbarian',
          ability_scores: {
            strength: 14,
            dexterity: 14,
            constitution: 14,
            intelligence: 10,
            wisdom: 10,
            charisma: 16,
          },
        },
      ],
      equipment: [],
      inventory: [],
    });

    expect(reveler).toMatchObject({
      previousMaxHitPoints: 10,
      previousCurrentHitPoints: 10,
      maxHitPoints: 14,
      currentHitPoints: 14,
    });
    expect(formatAbilityScoreBackfillPlan(reveler)).toContain('HP 10/10 -> 14/14');
  });
});
