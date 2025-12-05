/**
 * Landing Page Client Bundle
 *
 * Handles client-side hydration for SSR landing pages:
 * - Waitlist form submission
 * - Smooth scroll behavior
 * - Analytics tracking
 * - FAQ accordion interactions
 */

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initWaitlistForms();
  initSmoothScroll();
  initAnalytics();
  initFAQAccordions();
});

/**
 * Initialize all waitlist forms on the page
 */
function initWaitlistForms() {
  const forms = document.querySelectorAll<HTMLFormElement>('[data-waitlist-form]');

  forms.forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const emailInput = form.querySelector<HTMLInputElement>('input[type="email"]');
      const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      const messageEl = form.querySelector<HTMLElement>('[data-form-message]');

      if (!emailInput || !submitButton) return;

      const email = emailInput.value.trim();
      if (!email) return;

      // Disable form during submission
      submitButton.disabled = true;
      const originalText = submitButton.textContent;
      submitButton.textContent = 'Joining...';

      try {
        const response = await fetch('/api/trpc/waitlist.join', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            json: { email },
          }),
        });

        if (response.ok) {
          // Success
          emailInput.value = '';
          if (messageEl) {
            messageEl.textContent = 'Welcome to the adventure! Check your email for confirmation.';
            messageEl.className = 'text-green-400 mt-2 text-sm';
          }
          submitButton.textContent = 'Joined!';

          // Track conversion
          trackEvent('waitlist_signup', { source: form.dataset.source || 'landing' });

          // Reset button after delay
          setTimeout(() => {
            submitButton.textContent = originalText;
            submitButton.disabled = false;
          }, 3000);
        } else {
          throw new Error('Failed to join waitlist');
        }
      } catch (error) {
        // Error handling
        if (messageEl) {
          messageEl.textContent = 'Something went wrong. Please try again.';
          messageEl.className = 'text-red-400 mt-2 text-sm';
        }
        submitButton.textContent = originalText;
        submitButton.disabled = false;
      }
    });
  });
}

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
        ((window.scrollY + window.innerHeight) / document.body.scrollHeight) * 100
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
    }, 250)
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
    console.log('[Analytics]', eventName, params);
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

// Extend Window interface for gtag
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

// Export for testing
export { initWaitlistForms, initSmoothScroll, initAnalytics };
