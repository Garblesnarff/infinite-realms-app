import { beforeEach, describe, expect, it } from 'vitest';

import { VOICE_RATE_KEY, readVoiceRate } from '../voice-preferences';

describe('readVoiceRate', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('plays at normal speed when nothing is saved', () => {
    expect(readVoiceRate()).toBe(1);
  });

  it('reads an offered speed as saved', () => {
    window.localStorage.setItem(VOICE_RATE_KEY, JSON.stringify(1.25));
    expect(readVoiceRate()).toBe(1.25);
  });

  it('maps a stored 1.5 to the nearest offered speed, 1.25, as the Table settings do', () => {
    window.localStorage.setItem(VOICE_RATE_KEY, JSON.stringify(1.5));
    expect(readVoiceRate()).toBe(1.25);
  });

  it('plays at normal speed when the stored value is not a number', () => {
    window.localStorage.setItem(VOICE_RATE_KEY, JSON.stringify('fast'));
    expect(readVoiceRate()).toBe(1);
  });
});
