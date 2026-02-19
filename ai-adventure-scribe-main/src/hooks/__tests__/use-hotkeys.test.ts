
/* eslint-disable max-lines */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useHotkeys, BATTLE_MAP_HOTKEYS, createHotkeyFromPreset } from '../use-hotkeys';

import logger from '@/lib/logger';

describe('useHotkeys', () => {
  const mockCallback = vi.fn();
  const defaultOptions = {
    hotkeys: [
      {
        key: 'a',
        callback: mockCallback,
        description: 'Test hotkey A',
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Cleanup event listeners is handled by the hook's useEffect return
  });

  it('should trigger callback when hotkey is pressed', () => {
    renderHook(() => useHotkeys(defaultOptions));

    const event = new KeyboardEvent('keydown', { key: 'a' });
    window.dispatchEvent(event);

    expect(mockCallback).toHaveBeenCalledTimes(1);
    expect(mockCallback).toHaveBeenCalledWith(expect.any(KeyboardEvent));
  });

  it('should not trigger callback when different key is pressed', () => {
    renderHook(() => useHotkeys(defaultOptions));

    const event = new KeyboardEvent('keydown', { key: 'b' });
    window.dispatchEvent(event);

    expect(mockCallback).not.toHaveBeenCalled();
  });

  it('should respect modifier keys (Ctrl)', () => {
    const ctrlCallback = vi.fn();
    renderHook(() => useHotkeys({
      hotkeys: [
        { key: 's', ctrl: true, callback: ctrlCallback }
      ]
    }));

    // Press 's' without Ctrl
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: false }));
    expect(ctrlCallback).not.toHaveBeenCalled();

    // Press 's' with Ctrl
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    expect(ctrlCallback).toHaveBeenCalledTimes(1);
  });

  it('should respect modifier keys (Alt)', () => {
    const altCallback = vi.fn();
    renderHook(() => useHotkeys({
      hotkeys: [
        { key: 'f', alt: true, callback: altCallback }
      ]
    }));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', altKey: true }));
    expect(altCallback).toHaveBeenCalledTimes(1);
  });

  it('should respect modifier keys (Shift)', () => {
    const shiftCallback = vi.fn();
    renderHook(() => useHotkeys({
      hotkeys: [
        { key: 'z', shift: true, callback: shiftCallback }
      ]
    }));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', shiftKey: true }));
    expect(shiftCallback).toHaveBeenCalledTimes(1);
  });

  it('should handle multiple modifiers', () => {
    const multiCallback = vi.fn();
    renderHook(() => useHotkeys({
      hotkeys: [
        { key: 'z', ctrl: true, shift: true, callback: multiCallback }
      ]
    }));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true }));
    expect(multiCallback).toHaveBeenCalledTimes(1);
  });

  it('should not trigger when hook is disabled', () => {
    renderHook(() => useHotkeys({ ...defaultOptions, enabled: false }));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(mockCallback).not.toHaveBeenCalled();
  });

  it('should not trigger when individual hotkey is disabled', () => {
    renderHook(() => useHotkeys({
      hotkeys: [
        { key: 'a', callback: mockCallback, enabled: false }
      ]
    }));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(mockCallback).not.toHaveBeenCalled();
  });

  it('should prevent default behavior by default', () => {
    renderHook(() => useHotkeys(defaultOptions));

    const event = new KeyboardEvent('keydown', { key: 'a' });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    window.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('should not prevent default behavior if preventDefault is false', () => {
    renderHook(() => useHotkeys({
      hotkeys: [
        { key: 'a', callback: mockCallback, preventDefault: false }
      ]
    }));

    const event = new KeyboardEvent('keydown', { key: 'a' });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    window.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('should stop propagation if stopPropagation is true', () => {
    renderHook(() => useHotkeys({
      hotkeys: [
        { key: 'a', callback: mockCallback, stopPropagation: true }
      ]
    }));

    const event = new KeyboardEvent('keydown', { key: 'a' });
    const stopPropagationSpy = vi.spyOn(event, 'stopPropagation');

    window.dispatchEvent(event);

    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  it('should not trigger in input fields by default', () => {
    renderHook(() => useHotkeys(defaultOptions));

    const input = document.createElement('input');
    document.body.appendChild(input);

    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
    Object.defineProperty(event, 'target', { value: input });

    window.dispatchEvent(event);

    expect(mockCallback).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('should trigger in input fields if allowInInput is true', () => {
    renderHook(() => useHotkeys({ ...defaultOptions, allowInInput: true }));

    const input = document.createElement('input');
    document.body.appendChild(input);

    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
    Object.defineProperty(event, 'target', { value: input });

    window.dispatchEvent(event);

    expect(mockCallback).toHaveBeenCalledTimes(1);
    document.body.removeChild(input);
  });

  it('should support dynamic hotkey registration', () => {
    const { result } = renderHook(() => useHotkeys({ hotkeys: [] }));

    const dynamicCallback = vi.fn();
    act(() => {
      result.current.registerHotkey({ key: 'd', callback: dynamicCallback });
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    expect(dynamicCallback).toHaveBeenCalledTimes(1);
  });

  it('should support dynamic hotkey unregistration', () => {
    const { result } = renderHook(() => useHotkeys(defaultOptions));

    act(() => {
      result.current.unregisterHotkey('a');
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(mockCallback).not.toHaveBeenCalled();
  });

  it('should detect registration status with isRegistered', () => {
    const { result } = renderHook(() => useHotkeys({
      hotkeys: [
        { key: 'k', ctrl: true, callback: vi.fn() }
      ]
    }));

    expect(result.current.isRegistered('k', { ctrl: true })).toBe(true);
    expect(result.current.isRegistered('k', { ctrl: false })).toBe(false);
    expect(result.current.isRegistered('k')).toBe(false); // registered with ctrl, so without ctrl should be false
    expect(result.current.isRegistered('j')).toBe(false);
  });

  it('should detect registration status with isRegistered without modifiers', () => {
    const { result } = renderHook(() => useHotkeys({
      hotkeys: [
        { key: 'x', callback: vi.fn() }
      ]
    }));

    expect(result.current.isRegistered('x')).toBe(true);
    expect(result.current.isRegistered('x', { ctrl: false, alt: false, shift: false })).toBe(true);
  });

  it('should handle hotkey conflicts by overwriting', () => {
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();

    const { result } = renderHook(() => useHotkeys({
      hotkeys: [
        { key: 'c', callback: firstCallback, description: 'First' }
      ]
    }));

    act(() => {
      result.current.registerHotkey({ key: 'c', callback: secondCallback, description: 'Second' });
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));

    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).toHaveBeenCalledTimes(1);
  });

  it('should not trigger in textarea or select or contentEditable', () => {
    renderHook(() => useHotkeys(defaultOptions));

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    const event1 = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
    Object.defineProperty(event1, 'target', { value: textarea });
    window.dispatchEvent(event1);
    expect(mockCallback).not.toHaveBeenCalled();

    const select = document.createElement('select');
    document.body.appendChild(select);
    const event2 = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
    Object.defineProperty(event2, 'target', { value: select });
    window.dispatchEvent(event2);
    expect(mockCallback).not.toHaveBeenCalled();

    const div = document.createElement('div');
    div.contentEditable = 'true';
    document.body.appendChild(div);
    const event3 = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
    Object.defineProperty(event3, 'target', { value: div });
    window.dispatchEvent(event3);
    expect(mockCallback).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
    document.body.removeChild(select);
    document.body.removeChild(div);
  });

  it('should return all hotkeys with getHotkeys', () => {
    const { result } = renderHook(() => useHotkeys(defaultOptions));
    const hotkeys = result.current.getHotkeys();
    expect(hotkeys).toHaveLength(1);
    expect(hotkeys[0].key).toBe('a');
  });

  it('should log error when callback throws', () => {
    const error = new Error('Test error');
    const throwCallback = vi.fn(() => { throw error; });
    const loggerSpy = vi.spyOn(logger, 'error');

    renderHook(() => useHotkeys({
      hotkeys: [
        { key: 'e', callback: throwCallback }
      ]
    }));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));

    expect(throwCallback).toHaveBeenCalled();
    expect(loggerSpy).toHaveBeenCalledWith('Error executing hotkey callback', expect.any(Object));
  });

  it('should create hotkey from preset', () => {
    const preset = BATTLE_MAP_HOTKEYS.SELECT_TOOL;
    const callback = vi.fn();
    const hotkey = createHotkeyFromPreset(preset, callback, { enabled: false });

    expect(hotkey).toEqual({
      ...preset,
      callback,
      enabled: false,
    });
  });
});
