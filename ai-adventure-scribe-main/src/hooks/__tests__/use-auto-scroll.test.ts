 
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useAutoScroll } from '../use-auto-scroll';

describe('useAutoScroll', () => {
  const originalScrollTo = window.scrollTo;
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  beforeEach(() => {
    vi.useFakeTimers();
    window.scrollTo = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.scrollTo = originalScrollTo;
    Element.prototype.scrollIntoView = originalScrollIntoView;
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('should be defined', () => {
    const { result } = renderHook(() => useAutoScroll());
    expect(result.current.scrollToNavigation).toBeDefined();
    expect(result.current.scrollToTop).toBeDefined();
    expect(result.current.scrollToBottom).toBeDefined();
    expect(result.current.scrollToElement).toBeDefined();
  });

  describe('scrollToNavigation', () => {
    it('should scroll to element with data-testid="step-navigation"', () => {
      const { result } = renderHook(() => useAutoScroll());
      const nav = document.createElement('div');
      nav.setAttribute('data-testid', 'step-navigation');
      document.body.appendChild(nav);
      const scrollSpy = vi.spyOn(nav, 'scrollIntoView');

      result.current.scrollToNavigation();
      vi.advanceTimersByTime(150);

      expect(scrollSpy).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    });

    it('should scroll to a "Complete" button', () => {
      const { result } = renderHook(() => useAutoScroll());
      const button = document.createElement('button');
      button.textContent = 'Complete';
      document.body.appendChild(button);
      const scrollSpy = vi.spyOn(button, 'scrollIntoView');

      result.current.scrollToNavigation();
      vi.advanceTimersByTime(150);

      expect(scrollSpy).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    });

    it('should scroll to a "Next" button', () => {
      const { result } = renderHook(() => useAutoScroll());
      const button = document.createElement('button');
      button.textContent = 'Next';
      document.body.appendChild(button);
      const scrollSpy = vi.spyOn(button, 'scrollIntoView');

      result.current.scrollToNavigation();
      vi.advanceTimersByTime(150);

      expect(scrollSpy).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    });

    it('should scroll to element with class "flex justify-between" if test-id is missing', () => {
      const { result } = renderHook(() => useAutoScroll());
      const nav = document.createElement('div');
      nav.className = 'flex justify-between';
      document.body.appendChild(nav);
      const scrollSpy = vi.spyOn(nav, 'scrollIntoView');

      result.current.scrollToNavigation();
      vi.advanceTimersByTime(150);

      expect(scrollSpy).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    });

    it('should scroll to a "Continue" button if other selectors fail', () => {
      const { result } = renderHook(() => useAutoScroll());
      const button = document.createElement('button');
      button.textContent = 'Continue';
      document.body.appendChild(button);
      const scrollSpy = vi.spyOn(button, 'scrollIntoView');

      result.current.scrollToNavigation();
      vi.advanceTimersByTime(150);

      expect(scrollSpy).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    });

    it('should scroll to bottom if no navigation element is found', () => {
      const { result } = renderHook(() => useAutoScroll());
      const scrollToSpy = vi.spyOn(window, 'scrollTo');

      result.current.scrollToNavigation();
      vi.advanceTimersByTime(150);

      expect(scrollToSpy).toHaveBeenCalledWith({
        top: expect.any(Number),
        behavior: 'smooth',
      });
    });
  });

  describe('scrollToTop', () => {
    it('should scroll to top immediately', () => {
      const { result } = renderHook(() => useAutoScroll());
      const scrollToSpy = vi.spyOn(window, 'scrollTo');

      result.current.scrollToTop();

      expect(scrollToSpy).toHaveBeenCalledWith({
        top: 0,
        behavior: 'smooth',
      });
    });
  });

  describe('scrollToBottom', () => {
    it('should scroll to bottom after 100ms', () => {
      const { result } = renderHook(() => useAutoScroll());
      const scrollToSpy = vi.spyOn(window, 'scrollTo');

      result.current.scrollToBottom();
      vi.advanceTimersByTime(100);

      expect(scrollToSpy).toHaveBeenCalledWith({
        top: expect.any(Number),
        behavior: 'smooth',
      });
    });
  });

  describe('scrollToElement', () => {
    it('should scroll to specific element by selector after 100ms', () => {
      const { result } = renderHook(() => useAutoScroll());
      const element = document.createElement('div');
      element.id = 'target-element';
      document.body.appendChild(element);
      const scrollSpy = vi.spyOn(element, 'scrollIntoView');

      result.current.scrollToElement('#target-element');
      vi.advanceTimersByTime(100);

      expect(scrollSpy).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'nearest',
      });
    });

    it('should use custom options for scrollToElement', () => {
      const { result } = renderHook(() => useAutoScroll());
      const element = document.createElement('div');
      element.id = 'custom-target';
      document.body.appendChild(element);
      const scrollSpy = vi.spyOn(element, 'scrollIntoView');

      const customOptions: ScrollIntoViewOptions = { behavior: 'auto', block: 'center' };
      result.current.scrollToElement('#custom-target', customOptions);
      vi.advanceTimersByTime(100);

      expect(scrollSpy).toHaveBeenCalledWith(customOptions);
    });

    it('should do nothing if element is not found in scrollToElement', () => {
      const { result } = renderHook(() => useAutoScroll());

      result.current.scrollToElement('#non-existent');
      vi.advanceTimersByTime(100);

      // No assertion needed, just verifying it doesn't crash
    });
  });
});
