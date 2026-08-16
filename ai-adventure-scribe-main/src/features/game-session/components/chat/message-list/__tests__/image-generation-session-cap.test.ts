import { beforeEach, describe, expect, it } from 'vitest';

import {
  getImageGenerationCap,
  incrementImageGenerationCap,
  MAX_IMAGE_GENERATIONS_PER_SESSION,
} from '../image-generation-session-cap';

describe('image generation session cap', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts at zero and increments a session counter', () => {
    expect(getImageGenerationCap('session-1')).toBe(0);

    incrementImageGenerationCap('session-1');

    expect(getImageGenerationCap('session-1')).toBe(1);
  });

  it('fails closed for partial or invalid stored counters', () => {
    localStorage.setItem('dm-img-cap:partial', '3images');
    localStorage.setItem('dm-img-cap:unsafe', '9007199254740992');

    expect(getImageGenerationCap('partial')).toBe(MAX_IMAGE_GENERATIONS_PER_SESSION);
    expect(getImageGenerationCap('unsafe')).toBe(MAX_IMAGE_GENERATIONS_PER_SESSION);
  });

  it('clamps stored and incremented counters to the maximum', () => {
    localStorage.setItem('dm-img-cap:session-1', '9999');

    incrementImageGenerationCap('session-1');

    expect(getImageGenerationCap('session-1')).toBe(MAX_IMAGE_GENERATIONS_PER_SESSION);
    expect(localStorage.getItem('dm-img-cap:session-1')).toBe(
      String(MAX_IMAGE_GENERATIONS_PER_SESSION),
    );
  });
});
