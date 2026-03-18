import { describe, it, expect } from 'vitest';
import { isValidUUID } from '../validation';

describe('validation utilities', () => {
  describe('isValidUUID', () => {
    it('should return true for valid UUIDs', () => {
      const validUUIDs = [
        '550e8400-e29b-41d4-a716-446655440000',
        '00000000-0000-4000-8000-000000000000',
        'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      ];
      validUUIDs.forEach((uuid) => {
        expect(isValidUUID(uuid)).toBe(true);
      });
    });

    it('should return false for invalid UUIDs', () => {
      const invalidUUIDs = [
        'invalid-uuid',
        '550e8400-e29b-31d4-a716-446655440000', // version 3, but regex checks for version 4
        '550e8400-e29b-41d4-7716-446655440000', // variant 7, but regex checks for variant 8, 9, a, or b
        '550e8400e29b41d4a716446655440000', // missing dashes
        '',
      ];
      invalidUUIDs.forEach((uuid) => {
        expect(isValidUUID(uuid)).toBe(false);
      });
    });

    it('should handle case insensitivity', () => {
      expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
    });
  });
});
