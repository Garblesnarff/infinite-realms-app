import { describe, it, expect, vi, beforeEach } from 'vitest';

import { applyAssetPostProcessing, generateNpcAliases, insertAssetTags } from '../asset-processor';

import type { AssetInfo } from '../asset-processor';

import logger from '@/lib/logger';

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const DIABOLO: AssetInfo = { type: 'npc', key: 'lord-diabolo', name: 'Lord Diabolo' };
const ZARA: AssetInfo = { type: 'npc', key: 'zara', name: 'Zara' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insertAssetTags — emphasis edge cases', () => {
  it('inserts tag before plain name (no emphasis)', () => {
    const result = insertAssetTags('Then you see Lord Diabolo approach.', [DIABOLO]);
    expect(result).toBe('Then you see [ASSET:npc:lord-diabolo] Lord Diabolo approach.');
  });

  it('inserts tag before *Name (leading asterisk, no space)', () => {
    const result = insertAssetTags('Then you see *Lord Diabolo approach.', [DIABOLO]);
    expect(result).toMatch(/\[ASSET:npc:lord-diabolo\] \*Lord Diabolo/);
  });

  it('inserts tag before * Name (leading asterisk with space)', () => {
    // Regression: walk-back used to stop at the space, inserting tag INSIDE the emphasis span
    const result = insertAssetTags('Then you see * Lord Diabolo approach.', [DIABOLO]);
    expect(result).toMatch(/\[ASSET:npc:lord-diabolo\] \* Lord Diabolo/);
    // Tag must NOT appear between * and the name
    expect(result).not.toMatch(/\* \[ASSET/);
  });

  it('inserts tag before **Name (double asterisks, no space)', () => {
    const result = insertAssetTags('Behold **Lord Diabolo**.', [DIABOLO]);
    expect(result).toMatch(/\[ASSET:npc:lord-diabolo\] \*\*Lord Diabolo/);
  });

  it('does not insert a second tag when already present', () => {
    const alreadyTagged = '[ASSET:npc:lord-diabolo] Lord Diabolo appeared.';
    const result = insertAssetTags(alreadyTagged, [DIABOLO]);
    expect(result).toBe(alreadyTagged);
  });

  it('handles multiple assets in one passage', () => {
    const result = insertAssetTags('* Zara spoke while * Lord Diabolo watched.', [ZARA, DIABOLO]);
    expect(result).toMatch(/\[ASSET:npc:zara\]/);
    expect(result).toMatch(/\[ASSET:npc:lord-diabolo\]/);
    // Neither tag should land between * and name
    expect(result).not.toMatch(/\* \[ASSET/);
  });

  it('returns unchanged text when assets list is empty', () => {
    const text = 'Some narrative text.';
    expect(insertAssetTags(text, [])).toBe(text);
  });

  it('drops an unrecoverable asset tag and logs the defect', () => {
    const result = insertAssetTags('[ASSET:npc:orphan]', []);

    expect(result).toBe('');
    expect(logger.warn).toHaveBeenCalledWith(
      '[Asset Post-Processing] Dropped asset tag without visible entity name',
      {
        tag: '[ASSET:npc:orphan]',
      },
    );
  });

  it('repairs a bare asset tag before applying the output guard', () => {
    const result = insertAssetTags(
      'The room is empty. [ASSET:location:the-grand-kitchen] is quiet.',
      [],
    );

    expect(result).toBe(
      'The room is empty. The Grand Kitchen [ASSET:location:the-grand-kitchen] is quiet.',
    );
  });

  it('guards bare tags when no campaign assets are cached', () => {
    const result = applyAssetPostProcessing({ text: '[ASSET:npc:orphan]' });

    expect(result.text).toBe('');
    expect(logger.warn).toHaveBeenCalledWith(
      '[Asset Post-Processing] Dropped asset tag without visible entity name',
      {
        tag: '[ASSET:npc:orphan]',
      },
    );
  });

  it('keeps asset tags when visible text follows them', () => {
    const result = insertAssetTags('[ASSET:npc:zara] Zara enters the hall.', []);

    expect(result).toBe('[ASSET:npc:zara] Zara enters the hall.');
    expect(result).toMatch(/\[ASSET:[^\]]+\]\s+\S/);
  });
});

describe('generateNpcAliases', () => {
  it('generates aliases for quoted epithets', () => {
    const aliases = generateNpcAliases('Remy "The Manager"');
    expect(aliases).toContain('Remy "The Manager"');
    expect(aliases).toContain('Remy The Manager');
    expect(aliases).toContain('Remy');
    expect(aliases).not.toContain('The Manager');
  });

  it('generates aliases stripping titles and qualifiers', () => {
    const aliases = generateNpcAliases('Sir Gareth of Oakhaven');
    expect(aliases).toContain('Sir Gareth of Oakhaven');
    expect(aliases).toContain('Gareth of Oakhaven');
    expect(aliases).toContain('Sir Gareth');
    expect(aliases).toContain('Gareth');
    expect(aliases).not.toContain('Sir');
  });

  it('filters out stop words and short strings', () => {
    const aliases = generateNpcAliases('The Manager');
    expect(aliases).toContain('The Manager');
    expect(aliases).not.toContain('Manager');
    expect(aliases).not.toContain('The');
  });
});

describe('insertAssetTags — short-name NPC alias matching & guards', () => {
  const REMY_MANAGER: AssetInfo = {
    type: 'npc',
    key: 'remy-the-manager',
    name: 'Remy "The Manager"',
  };
  const THE_MANAGER: AssetInfo = {
    type: 'npc',
    key: 'the-manager',
    name: 'The Manager',
  };
  const MAIN_FLOOR: AssetInfo = {
    type: 'location',
    key: 'the-main-floor',
    name: 'The Main Floor',
  };

  it('tags subsequent short-name capitalized mentions (turn 2 scenario)', () => {
    const turn2Text =
      'Your gaze lingers on Remy, trying to read the static-laced features of his face.';
    const result = insertAssetTags(turn2Text, [REMY_MANAGER]);

    expect(result).toBe(
      'Your gaze lingers on [ASSET:npc:remy-the-manager] Remy, trying to read the static-laced features of his face.',
    );
  });

  it("tags possessive short-name mentions (Remy's)", () => {
    const text = "Your gaze lingers on Remy's face as he stands near the podium.";
    const result = insertAssetTags(text, [REMY_MANAGER]);

    expect(result).toBe(
      "Your gaze lingers on [ASSET:npc:remy-the-manager] Remy's face as he stands near the podium.",
    );
  });

  it('does NOT tag lowercase common-noun mentions ("spoke to the manager")', () => {
    const text = 'You spoke to the manager of the tavern after the tavern closed.';
    const result = insertAssetTags(text, [THE_MANAGER, REMY_MANAGER]);

    expect(result).toBe(text);
    expect(result).not.toContain('[ASSET:');
  });

  it('tags capitalized proper-noun use of "The Manager"', () => {
    const text = 'The Manager stands near the tall podium.';
    const result = insertAssetTags(text, [THE_MANAGER]);

    expect(result).toBe('[ASSET:npc:the-manager] The Manager stands near the tall podium.');
  });

  it('discards ambiguous short aliases shared between two NPCs', () => {
    const remyManager: AssetInfo = {
      type: 'npc',
      key: 'remy-the-manager',
      name: 'Remy "The Manager"',
    };
    const remyGuard: AssetInfo = {
      type: 'npc',
      key: 'remy-the-guard',
      name: 'Remy "The Guard"',
    };

    const shortMention = 'Your gaze lingers on Remy.';
    const shortResult = insertAssetTags(shortMention, [remyManager, remyGuard]);
    // Ambiguous alias "Remy" should not tag either NPC
    expect(shortResult).toBe(shortMention);

    const fullMention = 'Remy The Manager enters the room.';
    const fullResult = insertAssetTags(fullMention, [remyManager, remyGuard]);
    expect(fullResult).toBe('[ASSET:npc:remy-the-manager] Remy The Manager enters the room.');
  });

  it('does not invent short aliases for non-NPC assets (locations)', () => {
    const text = 'You step onto the floor near the kitchen.';
    const result = insertAssetTags(text, [MAIN_FLOOR]);

    expect(result).toBe(text);
  });
});

describe('insertAssetTags — title-stripped NPC alias (end to end)', () => {
  const SIR_GARETH: AssetInfo = {
    type: 'npc',
    key: 'sir-gareth-of-oakhaven',
    name: 'Sir Gareth of Oakhaven',
  };
  const GARETH_SMITH: AssetInfo = {
    type: 'npc',
    key: 'gareth-the-smith',
    name: 'Gareth the Smith',
  };

  it('keeps the visible short name without prepending the full display name', () => {
    const result = insertAssetTags('Gareth greets you.', [SIR_GARETH]);

    expect(result).toBe('[ASSET:npc:sir-gareth-of-oakhaven] Gareth greets you.');
    expect(result).not.toContain('Sir Gareth Of Oakhaven');
  });

  it('keeps the visible short name mid-sentence and on later mentions', () => {
    const result = insertAssetTags('You meet Gareth at the gate. Gareth smiles.', [SIR_GARETH]);

    expect(result).toBe(
      'You meet [ASSET:npc:sir-gareth-of-oakhaven] Gareth at the gate. Gareth smiles.',
    );
  });

  it('still refuses to tag a short name shared by two NPCs', () => {
    const text = 'Gareth greets you.';

    expect(insertAssetTags(text, [SIR_GARETH, GARETH_SMITH])).toBe(text);
  });
});
