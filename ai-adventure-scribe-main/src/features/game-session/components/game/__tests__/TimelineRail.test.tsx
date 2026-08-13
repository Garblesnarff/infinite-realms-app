/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TimelineRail } from '../TimelineRail';

import { useMessageContext } from '@/contexts/MessageContext';

// Mock the context
vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: vi.fn(),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('TimelineRail', () => {
  const mockMessages = [
    { id: '1', sender: 'dm', text: 'Hello', timestamp: '2021-01-01T00:00:00Z' },
    { id: '2', sender: 'player', text: 'Hi', timestamp: '2021-01-01T00:00:01Z' },
    { id: '3', sender: 'dm', text: 'How are you?', timestamp: '2021-01-01T00:00:02Z' },
  ];

  const mockRootRef = {
    current: document.createElement('div'),
  };

  let intersectionObserverCallback: (entries: any[]) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Mock IntersectionObserver
    (global as any).IntersectionObserver = vi.fn((callback) => {
      intersectionObserverCallback = callback;
      return {
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      };
    });

    // Mock CSS.escape if it doesn't exist
    if (!CSS.escape) {
      CSS.escape = (s: string) => s.replace(/([!"#$%&'()*+,. /:;<=>?@ [\\\]^`{|}~])/g, '\\$1');
    }

    // Default mock implementation for useMessageContext
    (useMessageContext as any).mockReturnValue({
      messages: mockMessages,
    });

    // Mock scrollTo on root element
    mockRootRef.current.scrollTo = vi.fn();

    // Mock offsetParent for scrollTo calculations
    Object.defineProperty(mockRootRef.current, 'offsetTop', { value: 0, writable: true });
    Object.defineProperty(mockRootRef.current, 'clientHeight', { value: 500, writable: true });
    Object.defineProperty(mockRootRef.current, 'scrollHeight', { value: 1000, writable: true });
    Object.defineProperty(mockRootRef.current, 'scrollTop', { value: 0, writable: true });

    // Mock requestAnimationFrame
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 16),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders correctly with DM messages', () => {
    render(<TimelineRail rootRef={mockRootRef} />);

    const dots = screen.getAllByRole('button');
    expect(dots).toHaveLength(2); // Two DM messages
    expect(dots[0]).toHaveAttribute('aria-label', 'Jump to DM message 1');
    expect(dots[1]).toHaveAttribute('aria-label', 'Jump to DM message 2');
  });

  it('returns null when there are no DM messages', () => {
    (useMessageContext as any).mockReturnValue({
      messages: [{ id: '2', sender: 'player', text: 'Hi' }],
    });

    const { container } = render(<TimelineRail rootRef={mockRootRef} />);
    expect(container.firstChild).toBeNull();
  });

  it('calls scrollTo when a dot is clicked', () => {
    // Create elements that scrollTo will look for
    const dmMessage1 = document.createElement('div');
    dmMessage1.id = 'm-1';
    Object.defineProperty(dmMessage1, 'offsetTop', { value: 100 });
    Object.defineProperty(dmMessage1, 'clientHeight', { value: 50 });
    mockRootRef.current.appendChild(dmMessage1);

    render(<TimelineRail rootRef={mockRootRef} />);

    const dots = screen.getAllByRole('button');
    fireEvent.click(dots[0]);

    // middlePosition = 100 - 500/2 + 50/2 = 100 - 250 + 25 = -125
    expect(mockRootRef.current.scrollTo).toHaveBeenCalledWith({
      top: -125,
      behavior: 'smooth',
    });
  });

  it('updates currentId based on IntersectionObserver', () => {
    render(<TimelineRail rootRef={mockRootRef} />);

    const dots = screen.getAllByRole('button');

    // Simulate intersection observer callback
    act(() => {
      intersectionObserverCallback([
        {
          isIntersecting: true,
          target: { id: 'm-3' },
          intersectionRatio: 0.9,
        },
      ]);
    });

    expect(dots[1]).toHaveClass('active');
  });

  it('updates indicator position on scroll', async () => {
    const { container } = render(<TimelineRail rootRef={mockRootRef} />);
    const indicator = container.querySelector('.scroll-position-indicator') as HTMLElement;
    const rail = container.querySelector('.timeline-rail') as HTMLElement;

    // Simulate scroll down
    act(() => {
      mockRootRef.current.scrollTop = 250;
      const scrollEvent = new Event('scroll');
      mockRootRef.current.dispatchEvent(scrollEvent);
    });

    // Advance timers for requestAnimationFrame
    act(() => {
      vi.advanceTimersByTime(20);
    });

    // scrollPercentage = 250 / (1000 - 500) = 0.5
    // railHeight = 500 - 32 = 468
    // indicatorPosition = 0.5 * 468 = 234
    expect(indicator.style.transform).toBe('translateY(234px)');
    expect(rail).toHaveAttribute('data-scrolling', 'true');
    expect(rail).toHaveAttribute('data-direction', 'down');

    // Simulate scroll stop
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(rail).not.toHaveAttribute('data-scrolling');

    // Simulate scroll up
    act(() => {
      mockRootRef.current.scrollTop = 100;
      const scrollEvent = new Event('scroll');
      mockRootRef.current.dispatchEvent(scrollEvent);
    });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(rail).toHaveAttribute('data-direction', 'up');
  });

  it('triggers absorb effect when indicator overlaps with dots', () => {
    const { container } = render(<TimelineRail rootRef={mockRootRef} />);
    const dots = container.querySelectorAll('.timeline-dot');
    const dot1 = dots[0] as HTMLElement;

    // Mock offsetTop for dot1
    Object.defineProperty(dot1, 'offsetTop', { value: 154 });
    dot1.setAttribute('data-anchor-id', 'm-1');

    act(() => {
      // scrollPercentage * 468 = 154 + 7 - 9 = 152
      // scrollPercentage = 152 / 468 = 0.3247...
      // scrollTop = 0.3247... * 500 = 162.39...
      mockRootRef.current.scrollTop = 162;
      const scrollEvent = new Event('scroll');
      mockRootRef.current.dispatchEvent(scrollEvent);
    });

    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(dot1).toHaveClass('absorbing');
    const indicator = container.querySelector('.scroll-position-indicator') as HTMLElement;
    expect(indicator).toHaveClass('absorbing');

    // Test cooldown
    act(() => {
      const scrollEvent = new Event('scroll');
      mockRootRef.current.dispatchEvent(scrollEvent);
    });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    // Should still be absorbing but not re-triggered (though here we just check it doesn't crash)

    // Test timeout for removing class
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(dot1).not.toHaveClass('absorbing');
    expect(indicator).not.toHaveClass('absorbing');
  });

  it('handles case where scrollHeight is not greater than clientHeight', () => {
    Object.defineProperty(mockRootRef.current, 'scrollHeight', { value: 500, writable: true });

    const { container } = render(<TimelineRail rootRef={mockRootRef} />);
    const indicator = container.querySelector('.scroll-position-indicator') as HTMLElement;

    act(() => {
      mockRootRef.current.scrollTop = 0;
      const scrollEvent = new Event('scroll');
      mockRootRef.current.dispatchEvent(scrollEvent);
    });

    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(indicator.style.transform).toBe('translateY(0px)');
  });
});
