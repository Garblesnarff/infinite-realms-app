import { describe, it, expect } from 'vitest';

import { generateAssetKey, stripKeyPossessiveS } from '../asset-key';

/**
 * Asset Key Generation Utility Tests
 *
 * Verifies that generateAssetKey produces URL-friendly keys
 * for asset tags as per project standards.
 */

describe('generateAssetKey', () => {
  it('should convert strings to lowercase', () => {
    expect(generateAssetKey('REMY')).toBe('remy');
    expect(generateAssetKey('The Manager')).toBe('the-manager');
  });

  it('should replace spaces with hyphens', () => {
    expect(generateAssetKey('remy the manager')).toBe('remy-the-manager');
  });

  it('should collapse multiple spaces and hyphens', () => {
    expect(generateAssetKey('remy   the manager')).toBe('remy-the-manager');
    expect(generateAssetKey('remy---the---manager')).toBe('remy-the-manager');
    expect(generateAssetKey('remy - the - manager')).toBe('remy-the-manager');
  });

  it('should remove ASCII quote variants without adding hyphens', () => {
    expect(generateAssetKey('\'remy\' "the" `manager`')).toBe('remy-the-manager');
    expect(generateAssetKey("Don't")).toBe('dont');
  });

  it('should remove Unicode quote variants without adding hyphens', () => {
    expect(generateAssetKey('«remy» ‘the’ “manager”')).toBe('remy-the-manager');
  });

  it('should remove special characters without adding hyphens (squashing)', () => {
    expect(generateAssetKey('remy!the manager')).toBe('remythe-manager');
    expect(generateAssetKey('area 51!')).toBe('area-51');
  });

  it('should preserve alphanumeric characters and spaces', () => {
    expect(generateAssetKey('remy ! the manager')).toBe('remy-the-manager');
    expect(generateAssetKey('area 51')).toBe('area-51');
  });

  it('should trim leading and trailing hyphens and spaces', () => {
    expect(generateAssetKey(' -remy- ')).toBe('remy');
    expect(generateAssetKey('---remy---')).toBe('remy');
  });

  it('should handle the example from the docstring correctly', () => {
    expect(generateAssetKey('Remy "The Manager"')).toBe('remy-the-manager');
  });

  it('should return an empty string for strings containing only special characters', () => {
    expect(generateAssetKey('!!!')).toBe('');
    expect(generateAssetKey(' @#$ ')).toBe('');
  });

  it('should handle numeric characters correctly', () => {
    expect(generateAssetKey('Level 10 NPC')).toBe('level-10-npc');
  });

  it('should preserve existing hyphens', () => {
    expect(generateAssetKey('well-known-npc')).toBe('well-known-npc');
  });

  it('should normalize accented characters by converting to base characters', () => {
    // We expect normalization (ä -> a, û -> u, etc.)
    expect(generateAssetKey('Fäerun')).toBe('faerun');
    expect(generateAssetKey('Faerûn')).toBe('faerun');
    expect(generateAssetKey('Mjölnir')).toBe('mjolnir');
  });

  it('should strip a possessive s so the key matches the base name (#267)', () => {
    // "The Bland One's Disciple" must key as the-bland-one-disciple, not
    // the-bland-ones-disciple: the possessive s is grammar, not name. Otherwise the
    // key-derived display name never matches the visible possessive and the
    // normalizer prepends a second name.
    expect(generateAssetKey("The Bland One's Disciple")).toBe('the-bland-one-disciple');
    expect(generateAssetKey('The Vitruvian Spider’s')).toBe('the-vitruvian-spider');
    // A plural s with no apostrophe is part of the name and stays.
    expect(generateAssetKey('The Bland Ones')).toBe('the-bland-ones');
  });

  it('should handle apostrophe edge cases without breaking names (#267)', () => {
    // O'Brien: apostrophe mid-name, not a possessive — the Brien stays.
    expect(generateAssetKey("O'Brien")).toBe('obrien');
    // Thieves' Guild: plural possessive (apostrophe after s) — the s stays, apostrophe goes.
    expect(generateAssetKey("Thieves' Guild")).toBe('thieves-guild');
    // Trailing apostrophe with no s: just the apostrophe is removed.
    expect(generateAssetKey("Thieves'")).toBe('thieves');
    // Odin's vs Odin: same entity by intent — both key as odin.
    expect(generateAssetKey("Odin's")).toBe('odin');
    expect(generateAssetKey('Odin')).toBe('odin');
    // 's before a hyphen: the possessive is stripped, hyphen structure kept.
    expect(generateAssetKey("The Spider's-Web")).toBe('the-spider-web');
  });
});

describe('stripKeyPossessiveS', () => {
  it("strips a possessive remnant when an entity name with 's justifies it (#292)", () => {
    expect(stripKeyPossessiveS('the-bland-ones-disciple', ["The Bland One's Disciple"])).toBe(
      'the-bland-one-disciple',
    );
  });

  it("treats Odin's and Odin as the same entity (#292)", () => {
    expect(stripKeyPossessiveS('odins', ["Odin's"])).toBe('odin');
  });

  it('leaves "thieves" alone when the name has no possessive s (#292)', () => {
    expect(stripKeyPossessiveS('thieves-guild', ["Thieves' Guild"])).toBe('thieves-guild');
  });

  it('leaves "bats" alone when no name justifies the strip (#292)', () => {
    expect(stripKeyPossessiveS('bats', ['Bat'])).toBe('bats');
    expect(stripKeyPossessiveS('bats', ['Bat', 'Cave'])).toBe('bats');
  });

  it('strips nothing without known names (#292)', () => {
    expect(stripKeyPossessiveS('the-bland-ones-disciple')).toBe('the-bland-ones-disciple');
  });

  it('only strips justified words, leaving the rest of the key intact (#292)', () => {
    expect(
      stripKeyPossessiveS('the-bland-ones-glass-disciples', ["The Bland One's Disciple"]),
    ).toBe('the-bland-one-glass-disciples');
  });

  it('extracts possessive stems from names with diacritics (#292)', () => {
    // Keys are NFKD-normalized by generateAssetKey, so the stem must be too:
    // "Mjölnir's" justifies stripping "mjolnirs", not the fragment "lnir".
    expect(stripKeyPossessiveS('mjolnirs-hammer', ["Mjölnir's Hammer"])).toBe('mjolnir-hammer');
  });
});
