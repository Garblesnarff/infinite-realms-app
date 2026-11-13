/**
 * Landing Page Client Bundle
 *
 * Handles client-side hydration for SSR landing pages:
 * - Smooth scroll behavior
 * - Analytics tracking
 * - FAQ accordion interactions
 */

import logger from '@/lib/logger';

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initSmoothScroll();
  initAnalytics();
  initFAQAccordions();
});

/**
 * Initialize smooth scrolling for anchor links
 */
function initSmoothScroll() {
  document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const href = anchor.getAttribute('href');
      if (!href || href === '#') return;

      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });

        // Update URL without triggering navigation
        history.pushState(null, '', href);
      }
    });
  });
}

/**
 * Initialize analytics tracking
 */
function initAnalytics() {
  // Track page view
  trackEvent('landing_page_view', {
    page: window.location.pathname,
    referrer: document.referrer,
  });

  // Track scroll depth
  let maxScroll = 0;
  const scrollMilestones = [25, 50, 75, 100];
  const reportedMilestones = new Set<number>();

  window.addEventListener(
    'scroll',
    throttle(() => {
      const scrollPercent = Math.round(
        ((window.scrollY + window.innerHeight) / document.body.scrollHeight) * 100,
      );

      if (scrollPercent > maxScroll) {
        maxScroll = scrollPercent;

        scrollMilestones.forEach((milestone) => {
          if (scrollPercent >= milestone && !reportedMilestones.has(milestone)) {
            reportedMilestones.add(milestone);
            trackEvent('scroll_depth', { depth: milestone, page: window.location.pathname });
          }
        });
      }
    }, 250),
  );

  // Track CTA clicks
  document.querySelectorAll('[data-track-cta]').forEach((el) => {
    el.addEventListener('click', () => {
      trackEvent('cta_click', {
        cta: el.getAttribute('data-track-cta'),
        page: window.location.pathname,
      });
    });
  });
}

/**
 * Initialize FAQ accordion functionality
 */
function initFAQAccordions() {
  document.querySelectorAll<HTMLDetailsElement>('.faq-item').forEach((details) => {
    details.addEventListener('toggle', () => {
      if (details.open) {
        const question = details.querySelector('summary')?.textContent?.trim();
        trackEvent('faq_expand', { question: question?.slice(0, 100) });
      }
    });
  });
}

/**
 * Track an analytics event
 */
function trackEvent(eventName: string, params?: Record<string, unknown>) {
  // Google Analytics 4
  if (typeof window.gtag === 'function') {
    window.gtag('event', eventName, params);
  }

  // Log in development
  if (import.meta.env.DEV) {
    logger.debug('[Analytics]', { eventName, params });
  }
}

/**
 * Throttle function to limit execution frequency
 */
function throttle<T extends (...args: unknown[]) => void>(fn: T, wait: number): T {
  let lastTime = 0;
  return function (this: unknown, ...args: Parameters<T>) {
    const now = Date.now();
    if (now - lastTime >= wait) {
      lastTime = now;
      fn.apply(this, args);
    }
  } as T;
}

// Export for testing
export { initSmoothScroll, initAnalytics };
