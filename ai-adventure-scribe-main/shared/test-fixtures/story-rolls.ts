import type { RollRequest } from '../../src/types/roll-request';

// Synthetic rows with the complete context shape emitted by useMessageQueue.
export const STORY_SKILL_ROLL = {
  dmMessageId: '11111111-1111-4111-8111-111111111111',
  reply: { text: 'Inspect the practice room.' },
  rollRequests: [
    { type: 'skill_check', formula: '1d20+1', purpose: 'Perception check', dc: 13 },
  ] as RollRequest[],
};
export const STORY_SAVE_ROLL = {
  dmMessageId: '22222222-2222-4222-8222-222222222222',
  reply: { text: 'The practice spell requires a save.' },
  rollRequests: [
    { type: 'save', formula: '1d20', purpose: 'Wisdom save against Charm Person', dc: 13 },
  ] as RollRequest[],
};
export function storyDmBody(turn = STORY_SKILL_ROLL) {
  return {
    id: turn.dmMessageId,
    message: turn.reply.text,
    speaker_type: 'dm',
    context: {
      location: null,
      emotion: 'neutral',
      intent: 'response',
      handouts: null,
      combat_transition: 'none',
      scene_spec: false,
      combat_engine_blocks: null,
      combat_ended: false,
      narration_segments: [{ type: 'dm', text: turn.reply.text }],
      rollRequests: turn.rollRequests,
    },
    timestamp: '2026-01-01T00:00:00.000Z',
  };
}

export function storySaveAnswerBody(id: string, timestamp: string) {
  return {
    id,
    timestamp,
    message: 'Wisdom save against Charm Person: 8 fail',
    speaker_type: 'player',
    context: {
      location: null,
      emotion: null,
      intent: 'dice_roll',
      rollRequestId: `${STORY_SAVE_ROLL.dmMessageId}:roll:0`,
      handouts: null,
      combat_transition: null,
      scene_spec: false,
      combat_engine_blocks: null,
      combat_ended: false,
      narration_segments: null,
    },
  };
}
