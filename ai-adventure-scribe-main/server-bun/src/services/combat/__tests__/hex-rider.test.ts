import { describe, expect, it } from 'bun:test';

import { appliesHexRider } from '../hex-rider.js';

const TARGET = 'participant-cursed';
const OTHER = 'participant-bystander';

describe('Hex rider decision (#754)', () => {
  it('applies while concentrating on Hex against the cursed participant', () => {
    expect(appliesHexRider({ spellName: 'Hex', targetParticipantId: TARGET }, TARGET)).toBe(true);
  });

  it('is case- and padding-insensitive on the spell name', () => {
    expect(appliesHexRider({ spellName: '  hEx ', targetParticipantId: TARGET }, TARGET)).toBe(
      true,
    );
  });

  it('does not apply against a different participant', () => {
    expect(appliesHexRider({ spellName: 'Hex', targetParticipantId: TARGET }, OTHER)).toBe(false);
  });

  it('does not apply when the attack has no target', () => {
    expect(appliesHexRider({ spellName: 'Hex', targetParticipantId: TARGET }, null)).toBe(false);
    expect(appliesHexRider({ spellName: 'Hex', targetParticipantId: TARGET }, undefined)).toBe(
      false,
    );
  });

  it('does not apply while concentrating on another spell', () => {
    expect(appliesHexRider({ spellName: 'Bless', targetParticipantId: TARGET }, TARGET)).toBe(
      false,
    );
  });

  it('does not apply when the stored Hex has no target', () => {
    expect(appliesHexRider({ spellName: 'Hex', targetParticipantId: null }, TARGET)).toBe(false);
  });

  it('does not apply without concentration', () => {
    expect(appliesHexRider(null, TARGET)).toBe(false);
    expect(appliesHexRider(undefined, TARGET)).toBe(false);
  });
});
