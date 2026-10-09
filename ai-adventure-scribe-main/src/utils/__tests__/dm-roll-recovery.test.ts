import { describe, expect, it } from 'vitest';

import {
  declinedRollMessage,
  latestUnansweredDmRollRequest,
  withheldDmRollReplies,
} from '../dm-roll-recovery';

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

  describe('a declined-roll line answers the request (#2291)', () => {
    const reply: ChatMessage = {
      id: 'd1',
      sender: 'dm',
      text: 'Read him.',
      rollRequests: [insight],
    };
    const player: ChatMessage = { id: 'p1', sender: 'player', text: 'I watch him.' };

    it('shows the reply and leaves nothing to restore', () => {
      const messages = [player, reply, declinedRollMessage('Insight check')];

      expect(withheldDmRollReplies(messages).size).toBe(0);
      expect(latestUnansweredDmRollRequest(messages)).toBeNull();
    });

    it('an ordinary system line is not an answer', () => {
      const notice: ChatMessage = { id: 's1', sender: 'system', text: 'Autosaved.' };
      const messages = [player, reply, notice];

      expect(withheldDmRollReplies(messages)).toEqual(new Set([reply]));
      expect(latestUnansweredDmRollRequest(messages)?.requests).toEqual([
        { ...insight, rollRequestId: 'd1:roll:0' },
      ]);
    });

    it('reads "You chose not to roll: <check>."', () => {
      expect(declinedRollMessage('Insight check')).toMatchObject({
        sender: 'system',
        text: 'You chose not to roll: Insight check.',
        context: { intent: 'roll_declined' },
      });
      expect(declinedRollMessage(undefined).text).toBe(
        'You chose not to roll: the requested check.',
      );
    });
  });

  describe('a two-check reply is answered per check (#2291 round 2)', () => {
    const perception = {
      type: 'skill_check' as const,
      formula: '1d20+3',
      purpose: 'Perception check',
      dc: 13,
    };
    const reply: ChatMessage = {
      id: 'd2',
      sender: 'dm',
      text: 'Remy smiles; something moves behind the bar.',
      rollRequests: [insight, perception],
    };
    const player: ChatMessage = { id: 'p1', sender: 'player', text: 'I watch him.' };
    const insightRoll: ChatMessage = {
      id: 'p2',
      sender: 'player',
      text: 'Insight check: 18',
      context: { intent: 'dice_roll' },
    };

    it.each([
      ['cancelled', declinedRollMessage('Insight check')],
      ['rolled', insightRoll],
    ])('first check %s: the reply stays withheld and only Perception is owed', (_how, answer) => {
      const messages = [player, reply, answer];

      expect(withheldDmRollReplies(messages)).toEqual(new Set([reply]));
      expect(latestUnansweredDmRollRequest(messages)?.requests).toEqual([
        { ...perception, rollRequestId: 'd2:roll:1' },
      ]);
    });

    it('both checks answered (one cancelled, one rolled): the reply shows, nothing is owed', () => {
      const messages = [
        player,
        reply,
        declinedRollMessage('Insight check'),
        { id: 'p3', sender: 'player', text: 'Perception: 9', context: { intent: 'dice_roll' } },
      ] as ChatMessage[];

      expect(withheldDmRollReplies(messages).size).toBe(0);
      expect(latestUnansweredDmRollRequest(messages)).toBeNull();
    });

    it('a free-text player message still answers every check', () => {
      const messages: ChatMessage[] = [
        player,
        reply,
        { id: 'p4', sender: 'player', text: 'Forget it, I leave.' },
      ];

      expect(withheldDmRollReplies(messages).size).toBe(0);
      expect(latestUnansweredDmRollRequest(messages)).toBeNull();
    });
  });
});
