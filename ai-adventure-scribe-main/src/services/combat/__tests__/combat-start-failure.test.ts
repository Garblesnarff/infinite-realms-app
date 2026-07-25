/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';

import {
  CombatStartError,
  combatStartErrorFromResponse,
} from '../combat-start-failure';

describe('combat-start-failure', () => {
  const mockEnvelope = { combat_transition: 'start', combatants: [] };

  describe('CombatStartError', () => {
    it('should initialize with correct properties, message, and fingerprint', () => {
      const error = new CombatStartError(
        500,
        'map_generation',
        'Map seed invalid',
        '{"error": "Map seed invalid"}',
        mockEnvelope
      );

      expect(error.status).toBe(500);
      expect(error.stage).toBe('map_generation');
      expect(error.detail).toBe('Map seed invalid');
      expect(error.responseBody).toBe('{"error": "Map seed invalid"}');
      expect(error.envelope).toBe(mockEnvelope);
      expect(error.message).toBe('Structured combat start failed (500, stage: map_generation): Map seed invalid');
      expect(error.fingerprint).toBe('combat_start:500:map_generation:Map seed invalid');
    });

    it('should format transcript details correctly', () => {
      const error = new CombatStartError(
        403,
        'ownership',
        'Unauthorized',
        'Forbidden access',
        mockEnvelope
      );

      const transcript = error.toTranscriptDetail();
      expect(transcript).toEqual({
        kind: 'combat_start_failure',
        status: 403,
        stage: 'ownership',
        detail: 'Unauthorized',
        responseBody: 'Forbidden access',
        dmEnvelope: mockEnvelope,
      });
    });
  });

  describe('combatStartErrorFromResponse', () => {
    it('should handle null response by returning a default error', async () => {
      const error = await combatStartErrorFromResponse(null, mockEnvelope);

      expect(error.status).toBe(0);
      expect(error.stage).toBe('unknown');
      expect(error.detail).toBe('no response from server');
      expect(error.responseBody).toBe('');
      expect(error.envelope).toBe(mockEnvelope);
    });

    it('should parse stage and detail from a valid JSON response', async () => {
      const jsonBody = JSON.stringify({
        stage: 'participants',
        detail: 'Invalid character template',
      });
      const mockResponse = {
        status: 400,
        statusText: 'Bad Request',
        text: vi.fn().mockResolvedValue(jsonBody),
      } as any;

      const error = await combatStartErrorFromResponse(mockResponse, mockEnvelope);

      expect(error.status).toBe(400);
      expect(error.stage).toBe('participants');
      expect(error.detail).toBe('Invalid character template');
      expect(error.responseBody).toBe(jsonBody);
    });

    it('should parse error property as detail from JSON response', async () => {
      const jsonBody = JSON.stringify({
        error: 'Out of memory',
      });
      const mockResponse = {
        status: 500,
        statusText: 'Internal Server Error',
        text: vi.fn().mockResolvedValue(jsonBody),
      } as any;

      const error = await combatStartErrorFromResponse(mockResponse, mockEnvelope);

      expect(error.status).toBe(500);
      expect(error.stage).toBe('unknown'); // stage is omitted in JSON, default to unknown
      expect(error.detail).toBe('Out of memory');
    });

    it('should fallback gracefully when response text is not valid JSON', async () => {
      const htmlBody = '<html><body>502 Bad Gateway</body></html>';
      const mockResponse = {
        status: 502,
        statusText: 'Bad Gateway',
        text: vi.fn().mockResolvedValue(htmlBody),
      } as any;

      const error = await combatStartErrorFromResponse(mockResponse, mockEnvelope);

      expect(error.status).toBe(502);
      expect(error.stage).toBe('unknown');
      expect(error.detail).toBe(htmlBody); // detail uses raw response text
      expect(error.responseBody).toBe(htmlBody);
    });

    it('should fallback to statusText if response text is empty and JSON parsing fails', async () => {
      const mockResponse = {
        status: 504,
        statusText: 'Gateway Timeout',
        text: vi.fn().mockResolvedValue(''),
      } as any;

      const error = await combatStartErrorFromResponse(mockResponse, mockEnvelope);

      expect(error.status).toBe(504);
      expect(error.stage).toBe('unknown');
      expect(error.detail).toBe('Gateway Timeout');
    });

    it('should handle text rejection/failure safely', async () => {
      const mockResponse = {
        status: 500,
        statusText: 'Server Error',
        text: vi.fn().mockRejectedValue(new Error('Network disconnected')),
      } as any;

      const error = await combatStartErrorFromResponse(mockResponse, mockEnvelope);

      expect(error.status).toBe(500);
      expect(error.stage).toBe('unknown');
      expect(error.detail).toBe('Server Error');
      expect(error.responseBody).toBe(''); // empty because reading text threw
    });
  });
});
