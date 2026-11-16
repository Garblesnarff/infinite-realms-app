import { ACTION_BAR_ACTOR_ID, ACTION_BAR_TARGET_ID } from './combat-action-bar-intent';

export const QUICKENED_SPELL_PROPOSAL = {
  intent: {
    type: 'spell',
    actorId: ACTION_BAR_ACTOR_ID,
    targetIds: [ACTION_BAR_TARGET_ID],
    spellId: 'chill-touch',
    spellName: 'Chill Touch',
    metamagic: 'quickened',
  },
  source: 'dm',
  phase: 'propose',
} as const;
