import { type ChatMessage } from '@/services/ai-service';

// A function (not a module-level constant) so timestamps are computed fresh on each
// mount, matching the original useState initializer's per-render behavior.
export function createInitialTestMessages(): ChatMessage[] {
  return [
    {
      id: '1',
      content:
        'You enter a dark dungeon. The ancient stones seem to whisper secrets. [DICE: 1d20+2 Perception] to notice any hidden details.',
      role: 'assistant',
      timestamp: Date.now() - 30000,
    },
    {
      id: '2',
      content:
        'A goblin leaps from the shadows, attacking with its rusty sword! [DICE: 1d20+4 attack] and [DICE: 1d6+2 damage] if it hits.',
      role: 'assistant',
      timestamp: Date.now() - 20000,
    },
    {
      id: '3',
      content:
        'Make a Constitution saving throw [DICE: 1d20+3 Constitution save] against the poison.',
      role: 'assistant',
      timestamp: Date.now() - 10000,
    },
  ];
}
