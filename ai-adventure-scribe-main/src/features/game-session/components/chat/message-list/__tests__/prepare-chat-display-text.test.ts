import { describe, expect, it } from 'vitest';

import { prepareChatDisplayText } from '../prepare-chat-display-text';

const DM_TEXT = [
  'The torchlight catches on [ASSET:npc:professor-vale] Professor Vale\'s spectacles. She says, "**Mind the gap** on the eastern stair." The cold air smells faintly of *ozone.',
  '',
  'A low rumble answers from somewhere below.',
  '',
  '```ROLL_REQUESTS_V1',
  '{"rolls":[{"type":"check","formula":"1d20+2","purpose":"Perception","dc":14}]}',
  '```',
  '',
  "VISUAL PROMPT: A dim stone stairwell lit by a single torch, Professor Vale's silhouette above.",
  '',
  '⚙️ Engine: The Storyteller rolled 15 + 2 = 17 vs DC 14 — SUCCESS.',
].join('\n');

describe('prepareChatDisplayText', () => {
  it('strips roll requests, visual prompts and asset tags from the prose', () => {
    const { text } = prepareChatDisplayText(DM_TEXT);

    expect(text).not.toContain('[ASSET');
    expect(text).not.toContain('ROLL_REQUESTS_V1');
    expect(text).not.toContain('VISUAL PROMPT');
    expect(text).toContain('Professor Vale');
    expect(text).toContain('Mind the gap');
  });

  it('lifts engine transcript lines out of the prose', () => {
    const { text, engineLines } = prepareChatDisplayText(DM_TEXT);

    expect(text).not.toContain('Engine:');
    expect(engineLines).toEqual([
      '⚙️ Engine: The Storyteller rolled 15 + 2 = 17 vs DC 14 — SUCCESS.',
    ]);
  });

  it('collects the referenced assets', () => {
    const { assetTags } = prepareChatDisplayText(DM_TEXT);

    expect(assetTags).toEqual([
      {
        type: 'npc',
        key: 'professor-vale',
        fullMatch: '[ASSET:npc:professor-vale]',
      },
    ]);
  });
});
