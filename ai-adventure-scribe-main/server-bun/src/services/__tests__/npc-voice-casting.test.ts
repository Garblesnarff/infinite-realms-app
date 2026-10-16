import { describe, expect, test } from 'bun:test';

import { IR_VOICES, pickNpcVoice } from '../../../../shared/npc-voices';

describe('persistent IR voice selection', () => {
  test('trait matching and deterministic campaign/NPC tie breaking', () => {
    expect(pickNpcVoice('campaign', 'npc', 'warm female innkeeper', new Set())).toBe('serena');
    const first = pickNpcVoice('campaign', 'npc', '', new Set());
    for (let i = 0; i < 20; i++) expect(pickNpcVoice('campaign', 'npc', '', new Set())).toBe(first);
    expect(
      new Set(
        Array.from({ length: 20 }, (_, i) => pickNpcVoice(`campaign-${i}`, 'npc', '', new Set())),
      ).size,
    ).toBeGreaterThan(1);
  });
  test('reserves the narrator and excludes voices already used by NPCs', () => {
    const used = new Set<string>();
    for (let i = 0; i < Object.keys(IR_VOICES).length - 1; i++) {
      const id = pickNpcVoice('campaign', `npc-${i}`, 'merchant', used);
      expect(id).toBeDefined();
      expect(id).not.toBe('narrator');
      expect(used.has(id!)).toBe(false);
      used.add(id!);
    }
    expect(pickNpcVoice('campaign', 'overflow', '', used)).toBeUndefined();
  });
  test('each cast stays distinct on both current providers', () => {
    const voices = Object.values(IR_VOICES);
    expect(new Set(voices.map((v) => v.kokoro)).size).toBe(voices.length);
    expect(new Set(voices.map((v) => v.premium)).size).toBe(voices.length);
  });
});
