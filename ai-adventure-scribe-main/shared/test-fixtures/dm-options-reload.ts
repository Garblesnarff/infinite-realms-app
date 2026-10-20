/** Narration and choices survive as separate fields on the saved DM row (#868). */
export const DM_OPTIONS_RELOAD = {
  id: '86800000-0000-4000-8000-000000000001',
  message: 'The Professor waits beside the cauldron.',
  speaker_type: 'dm' as const,
  timestamp: '2026-10-20T00:00:00.000Z',
  context: {
    location: null,
    emotion: 'neutral',
    intent: 'response',
    handouts: [],
    combat_transition: null,
    scene_spec: false,
    combat_engine_blocks: null,
    combat_ended: false,
    narration_segments: null,
    actionOptions: [
      'A. **Ask the Professor**, about the experiment.',
      'B. **Inspect the cauldron**, from a safe distance.',
      'C. **Leave the laboratory**, quietly.',
    ],
  },
};
