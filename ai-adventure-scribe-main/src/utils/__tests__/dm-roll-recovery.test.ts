import { describe, expect, it } from 'vitest';

import { withheldDmRollReplies } from '../dm-roll-recovery';

import type { ChatMessage } from '@/types/game';

const insight = {
  type: 'skill_check' as const,
  formula: '1d20+6',
  purpose: 'Insight check',
  dc: 15,
};

describe('withheldDmRollReplies (#2280)', () => {
  it('withholds a DM reply whose narrative roll has no later player message', () => {
    const reply: ChatMessage = {
      id: 'd1',
      sender: 'dm',
      text: 'Read him.',
      rollRequests: [insight],
    };
    const messages: ChatMessage[] = [{ id: 'p1', sender: 'player', text: 'I watch him.' }, reply];

    expect(withheldDmRollReplies(messages)).toEqual(new Set([reply]));
  });

  it('reads requests from the saved context too, and ignores system lines after the reply', () => {
    const reply: ChatMessage = {
      id: 'd1',
      sender: 'dm',
      text: 'Read him.',
      context: { rollRequests: [insight] },
    };
    const notice: ChatMessage = { id: 's1', sender: 'system', text: 'Saved.' };

    expect(withheldDmRollReplies([reply, notice])).toEqual(new Set([reply]));
  });

  it('shows the reply once any player message follows it', () => {
    const messages: ChatMessage[] = [
      { id: 'd1', sender: 'dm', text: 'Read him.', rollRequests: [insight] },
      { id: 'p2', sender: 'player', text: 'Insight check: 18', context: { intent: 'dice_roll' } },
    ];

    expect(withheldDmRollReplies(messages).size).toBe(0);
  });

  it('never withholds a reply whose only requests are engine-owned', () => {
    const messages: ChatMessage[] = [
      {
        id: 'd1',
        sender: 'dm',
        text: 'Steel rings.',
        rollRequests: [{ type: 'attack', formula: '1d20+5', purpose: 'Longsword attack' }],
      },
    ];

    expect(withheldDmRollReplies(messages).size).toBe(0);
  });

  it("hides #2250's text-less pending_roll_request rows wherever they are", () => {
    const legacy: ChatMessage = {
      id: 'd0',
      sender: 'dm',
      text: '',
      context: { intent: 'pending_roll_request', rollRequests: [insight] },
    };
    const messages: ChatMessage[] = [legacy, { id: 'p1', sender: 'player', text: 'Next.' }];

    expect(withheldDmRollReplies(messages)).toEqual(new Set([legacy]));
  });
});
