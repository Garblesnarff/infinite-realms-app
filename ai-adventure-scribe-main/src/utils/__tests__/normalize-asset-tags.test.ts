import { describe, it, expect } from 'vitest';

import { normalizeAssetTagKeysInContent, normalizeAssetTagsInContent } from '../normalize-asset-tags';

describe('normalize-asset-tags', () => {
  describe('normalizeAssetTagKeysInContent', () => {
    it('normalizes malformed keys with quotes', () => {
      const input = 'You see [ASSET:npc:remy-"the-manager"].';
      const result = normalizeAssetTagKeysInContent(input);
      // Normalized key: remy-the-manager
      // Derived name: Remy The Manager
      // Since it's not a standalone tag and name is not present, it should prepend the name.
      expect(result).toBe('You see Remy The Manager [ASSET:npc:remy-the-manager].');
    });

    it('normalizes keys with special characters', () => {
      const input = 'Behold [ASSET:location:the-bone-cathedral!].';
      const result = normalizeAssetTagKeysInContent(input);
      // Normalized key: the-bone-cathedral
      // Derived name: The Bone Cathedral
      expect(result).toBe('Behold The Bone Cathedral [ASSET:location:the-bone-cathedral].');
    });

    it('does not prepend name if it is already present in front', () => {
      const input = 'Remy The Manager [ASSET:npc:remy-"the-manager"] says hi.';
      const result = normalizeAssetTagKeysInContent(input);
      expect(result).toBe('Remy The Manager [ASSET:npc:remy-the-manager] says hi.');
    });

    it('does not prepend name if it is already present after the tag', () => {
      const input = 'I meet [ASSET:npc:remy-"the-manager"] Remy The Manager.';
      const result = normalizeAssetTagKeysInContent(input);
      expect(result).toBe('I meet [ASSET:npc:remy-the-manager] Remy The Manager.');
    });

    it('does not prepend name if the first word is already prepended', () => {
      const input = 'Remy [ASSET:npc:remy-"the-manager"] is here.';
      const result = normalizeAssetTagKeysInContent(input);
      expect(result).toBe('Remy [ASSET:npc:remy-the-manager] is here.');
    });

    it('does not prepend name if it is a standalone tag (no other content)', () => {
      const input = '[ASSET:npc:remy-the-manager]';
      const result = normalizeAssetTagKeysInContent(input);
      expect(result).toBe('[ASSET:npc:remy-the-manager]');
    });

    it('handles multiple tags in one string', () => {
      const input = '[ASSET:npc:remy-"the-manager"] and [ASSET:location:bone-cathedral]';
      const result = normalizeAssetTagKeysInContent(input);
      // First tag: name 'Remy The Manager' prepended because there's content (' and ...')
      // Second tag: name 'Bone Cathedral' prepended because there's content before it.
      expect(result).toContain('Remy The Manager [ASSET:npc:remy-the-manager]');
      expect(result).toContain('Bone Cathedral [ASSET:location:bone-cathedral]');
    });

    it('handles tags with no derivable name (empty key after normalization)', () => {
      const input = 'Empty [ASSET:npc:---].';
      const result = normalizeAssetTagKeysInContent(input);
      expect(result).toBe('Empty [ASSET:npc:].');
    });

    it('strips markdown emphasis from content when checking if name is prepended', () => {
      const input = '**Remy The Manager** [ASSET:npc:remy-the-manager]';
      const result = normalizeAssetTagKeysInContent(input);
      expect(result).toBe('**Remy The Manager** [ASSET:npc:remy-the-manager]');
    });
  });

  describe('normalizeAssetTagsInContent', () => {
    it('strips double-asterisk bold emphasis around tags', () => {
      const input = 'See **[ASSET:npc:remy-the-manager]**.';
      const result = normalizeAssetTagsInContent(input);
      // After fix, stripping should happen before name prepending OR stripping should be more robust
      expect(result).toBe('See Remy The Manager [ASSET:npc:remy-the-manager].');
    });

    it('strips single-asterisk italic emphasis around tags', () => {
      const input = 'Check *[ASSET:location:bone-cathedral]* out.';
      const result = normalizeAssetTagsInContent(input);
      expect(result).toBe('Check Bone Cathedral [ASSET:location:bone-cathedral] out.');
    });

    it('handles mixed content and multiple emphasis types', () => {
      const input = 'The **[ASSET:npc:remy-the-manager]** and *[ASSET:location:bone-cathedral]* are here.';
      const result = normalizeAssetTagsInContent(input);
      expect(result).toContain('Remy The Manager [ASSET:npc:remy-the-manager]');
      expect(result).toContain('Bone Cathedral [ASSET:location:bone-cathedral]');
      expect(result).not.toContain('**[');
      expect(result).not.toContain('*[');
    });
  });
});
