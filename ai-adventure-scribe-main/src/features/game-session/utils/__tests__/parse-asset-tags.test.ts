import { describe, it, expect } from 'vitest';

import { normalizeAssetTagKeysInContent, parseAssetTags } from '../parse-asset-tags';

import { normalizeAssetTagsInContent } from '@/utils/normalize-asset-tags';

describe('normalizeAssetTagKeysInContent (issue #339)', () => {
  it('normalizes a key with double-quotes to a valid slug', () => {
    const input = 'Remy [ASSET:npc:remy-"the-manager"] greets you.';
    const result = normalizeAssetTagKeysInContent(input);
    expect(result).toContain('[ASSET:npc:remy-the-manager]');
    expect(result).not.toContain('"');
  });

  it('normalizes a key with smart/curly quotes', () => {
    const input = '[ASSET:npc:lord-\u201cdiabolo\u201d]';
    const result = normalizeAssetTagKeysInContent(input);
    expect(result).toContain('[ASSET:npc:lord-diabolo]');
  });

  it('passes through already-valid keys unchanged', () => {
    const input = '[ASSET:location:bone-cathedral]';
    expect(normalizeAssetTagKeysInContent(input)).toBe('[ASSET:location:bone-cathedral]');
  });

  it('handles mixed valid and malformed tags in one string', () => {
    const input = '[ASSET:character:the-veteran] appeared beside [ASSET:npc:remy-"the-manager"].';
    const result = normalizeAssetTagKeysInContent(input);
    expect(result).toContain('[ASSET:character:the-veteran]');
    expect(result).toContain('[ASSET:npc:remy-the-manager]');
    expect(result).not.toContain('"');
  });

  it('is idempotent — applying twice gives the same result', () => {
    const input = '[ASSET:npc:remy-"the-manager"]';
    const once = normalizeAssetTagKeysInContent(input);
    const twice = normalizeAssetTagKeysInContent(once);
    expect(once).toBe(twice);
  });
});

describe('parseAssetTags — malformed key handling (issue #339)', () => {
  it('strips a tag with a quoted key from display content', () => {
    const { cleanContent, assets } = parseAssetTags(
      'You meet [ASSET:npc:remy-"the-manager"] at the door.',
    );
    expect(cleanContent).not.toContain('[ASSET:');
    expect(cleanContent).toContain('You meet Remy The Manager at the door.');
    expect(assets).toHaveLength(1);
    expect(assets[0].key).toBe('remy-the-manager');
  });

  it('strips multiple tags — one valid, one malformed — from display content', () => {
    const { cleanContent, assets } = parseAssetTags(
      '[ASSET:location:bone-cathedral] and [ASSET:npc:lord-"diabolo"] are present.',
    );
    expect(cleanContent).not.toContain('[ASSET:');
    expect(cleanContent).toContain('Bone Cathedral and Lord Diabolo are present.');
    expect(assets).toHaveLength(2);
  });

  it('restores a visible display name when a valid tag appears without one', () => {
    const { cleanContent, assets } = parseAssetTags(
      'A figure catches your eye: [ASSET:npc:dishwasher-prime], a gelatinous blob with a cheerful grin.',
    );
    expect(cleanContent).toContain('Dishwasher Prime, a gelatinous blob with a cheerful grin.');
    expect(assets).toHaveLength(1);
    expect(assets[0].key).toBe('dishwasher-prime');
  });

  it('strips markdown emphasis wrapped around bare asset tags', () => {
    const normalized = normalizeAssetTagsInContent(
      '**[ASSET:npc:remy-"the-manager"]** Remy "The Manager" steps forward.',
    );
    expect(normalized).toContain('[ASSET:npc:remy-the-manager] Remy "The Manager" steps forward.');
    expect(normalized).not.toContain('**[ASSET:');
  });

  it('normalizes appositive dashes cleanly after stripping asset tags', () => {
    const { cleanContent } = parseAssetTags(
      'A fire elemental in a stained apron—[ASSET:npc:balthazar] **Balthazar**—is barking orders.',
    );

    expect(cleanContent).toBe(
      'A fire elemental in a stained apron—**Balthazar**—is barking orders.',
    );
  });

  it('removes spaces before closing quotes after tag stripping', () => {
    const { cleanContent } = parseAssetTags(
      'A gelatinous mass—[ASSET:npc:dishwasher-prime] **Dishwasher Prime**—bounces into view. “Oopsie! ” it giggles.',
    );

    expect(cleanContent).toContain('—**Dishwasher Prime**—bounces into view.');
    expect(cleanContent).toContain('“Oopsie!” it giggles.');
  });

  it('preserves normal spacing around straight-quoted names and dialogue', () => {
    const { cleanContent } = parseAssetTags(
      '**[ASSET:npc:remy-the-manager] Remy "The Manager"** says, "Ah, you’re awake," he says.',
    );

    expect(cleanContent).toContain('Remy "The Manager"');
    expect(cleanContent).toContain('says, "Ah, you’re awake," he says.');
  });
});
