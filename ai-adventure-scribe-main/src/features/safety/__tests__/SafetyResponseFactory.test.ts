/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import { SafetyResponseFactory } from '../SafetyResponseFactory';

describe('SafetyResponseFactory', () => {
  describe('createXCardResponse', () => {
    it('should create a valid X-Card response', () => {
      const context = 'test context';
      const result = SafetyResponseFactory.createXCardResponse(context, false);

      expect(result.isSafetyCommand).toBe(true);
      expect(result.command).toBeDefined();
      expect(result.command?.type).toBe('x_card');
      expect(result.command?.context).toBe(context);
      expect(result.command?.autoTriggered).toBe(false);
      expect(result.command?.triggeredBy).toBe('explicit_command');
      expect(result.response?.text).toContain('X-CARD ACTIVATED');
      expect(result.response?.sender).toBe('system');
      expect(result.response?.context?.intent).toBe('safety_x_card');
      expect(result.shouldPause).toBe(true);
    });

    it('should handle auto-triggered X-Card response', () => {
      const result = SafetyResponseFactory.createXCardResponse('auto', true, 'blood');

      expect(result.command?.autoTriggered).toBe(true);
      expect(result.command?.triggeredBy).toBe('auto_detect');
      expect(result.command?.triggerWord).toBe('blood');
      expect(result.response?.context?.autoTriggered).toBe(true);
      expect(result.response?.context?.triggerWord).toBe('blood');
    });
  });

  describe('createVeilResponse', () => {
    it('should create a valid Veil response', () => {
      const context = 'veil context';
      const result = SafetyResponseFactory.createVeilResponse(context, false);

      expect(result.isSafetyCommand).toBe(true);
      expect(result.command?.type).toBe('veil');
      expect(result.command?.context).toBe(context);
      expect(result.response?.text).toContain('VEIL ACTIVATED');
      expect(result.response?.context?.intent).toBe('safety_veil');
      expect(result.shouldPause).toBeUndefined();
    });

    it('should handle auto-triggered Veil response', () => {
      const result = SafetyResponseFactory.createVeilResponse('auto', true, 'suggestive');

      expect(result.command?.autoTriggered).toBe(true);
      expect(result.command?.triggeredBy).toBe('auto_detect');
      expect(result.command?.triggerWord).toBe('suggestive');
    });
  });

  describe('createPauseResponse', () => {
    it('should create a valid Pause response', () => {
      const result = SafetyResponseFactory.createPauseResponse();

      expect(result.text).toContain('GAME PAUSED');
      expect(result.sender).toBe('system');
      expect(result.context?.intent).toBe('safety_pause');
    });
  });

  describe('createResumeResponse', () => {
    it('should create a valid Resume response', () => {
      const result = SafetyResponseFactory.createResumeResponse();

      expect(result.text).toContain('GAME RESUMED');
      expect(result.sender).toBe('system');
      expect(result.context?.intent).toBe('safety_resume');
    });
  });

  describe('createDefaultResponse', () => {
    it('should create a valid default response', () => {
      const result = SafetyResponseFactory.createDefaultResponse();

      expect(result.text).toContain('Safety command processed');
      expect(result.sender).toBe('system');
      expect(result.context?.intent).toBe('safety_generic');
    });
  });

  describe('createDisabledResponse', () => {
    it('should create a valid disabled response', () => {
      const result = SafetyResponseFactory.createDisabledResponse();

      expect(result.text).toContain('Safety command ignored');
      expect(result.sender).toBe('system');
      expect(result.context?.intent).toBe('safety_disabled');
    });
  });
});
