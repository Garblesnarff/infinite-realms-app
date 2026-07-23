import puppeteer from 'puppeteer';

import { logger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';

import type { Browser, Page } from 'puppeteer';

/**
 * Blog Screenshot Service
 *
 * Captures screenshots of key pages for before/after comparison in blog digests.
 * Maintains baselines and detects visual changes between deploys.
 *
 * Authentication:
 * - Uses a dedicated screenshot bot account for authenticated pages
 * - Set SCREENSHOT_BOT_EMAIL and SCREENSHOT_BOT_PASSWORD in .env
 * - Public pages (landing, blog) are captured without auth
 */

interface PageConfig {
  key: string;
  url: string;
  selector?: string;  // Optional: wait for specific element
  delay?: number;     // Optional: extra wait time in ms
  requiresAuth: boolean;  // Whether this page needs authentication
}

interface Screenshot {
  key: string;
  path: string;
  capturedAt: string;
  commitHash?: string;
}

interface ScreenshotComparison {
  key: string;
  hasChanged: boolean;
  beforePath?: string;
  afterPath?: string;
}

// Pages to capture - separated by auth requirement
const PAGE_CONFIGS: PageConfig[] = [
  // Public pages (no auth needed)
  { key: 'landing', url: '/', delay: 1000, requiresAuth: false },
  { key: 'blog', url: '/blog', delay: 500, requiresAuth: false },
  // Authenticated pages
  { key: 'characters', url: '/characters', selector: '[data-testid="character-list"]', delay: 2000, requiresAuth: true },
  { key: 'campaigns', url: '/campaigns', delay: 2000, requiresAuth: true },
];

export class BlogScreenshotService {
  private static browser: Browser | null = null;
  private static isAuthenticated = false;
  private static readonly STORAGE_BUCKET = process.env.BLOG_MEDIA_BUCKET || 'blog-media';
  private static readonly BASE_URL = process.env.SCREENSHOT_BASE_URL || 'https://infiniterealms.app';
  private static readonly VIEWPORT = { width: 1280, height: 800 };

  // Bot credentials for authenticated screenshots
  private static readonly BOT_EMAIL = process.env.SCREENSHOT_BOT_EMAIL;
  private static readonly BOT_PASSWORD = process.env.SCREENSHOT_BOT_PASSWORD;

  /**
   * Initialize the browser instance
   */
  private static async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      this.isAuthenticated = false;
    }
    return this.browser;
  }

  /**
   * Close the browser instance
   */
  static async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.isAuthenticated = false;
    }
  }

  /**
   * Check if bot credentials are configured
   */
  static hasAuthCredentials(): boolean {
    return Boolean(this.BOT_EMAIL && this.BOT_PASSWORD);
  }

  /**
   * Authenticate the browser session using WorkOS AuthKit
   * This navigates through the login flow and establishes a session
   */
  private static async authenticate(page: Page): Promise<boolean> {
    if (this.isAuthenticated) {
      return true;
    }

    if (!this.hasAuthCredentials()) {
      logger.warn('Screenshot bot credentials not configured (SCREENSHOT_BOT_EMAIL, SCREENSHOT_BOT_PASSWORD)');
      return false;
    }

    try {
      logger.info('Authenticating screenshot bot...');

      // Navigate to a protected page to trigger login redirect
      await page.goto(`${this.BASE_URL}/characters`, { waitUntil: 'networkidle0', timeout: 30000 });

      // Check if we're on the WorkOS login page
      const currentUrl = page.url();
      if (currentUrl.includes('workos.com') || currentUrl.includes('authkit')) {
        // We're on the WorkOS login page - fill in credentials
        logger.info({ url: currentUrl }, 'On WorkOS login page');

        // Wait for email input and enter email
        await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });
        await page.type('input[type="email"], input[name="email"]', this.BOT_EMAIL!);

        // Click continue/next button
        const continueButton = await page.$('button[type="submit"], button:has-text("Continue")');
        if (continueButton) {
          await continueButton.click();
          await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
        }

        // Wait for password input (might be on a separate page)
        await page.waitForSelector('input[type="password"]', { timeout: 10000 });
        await page.type('input[type="password"]', this.BOT_PASSWORD!);

        // Click sign in button
        const signInButton = await page.$('button[type="submit"]');
        if (signInButton) {
          await signInButton.click();
          await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 });
        }

        // Verify we're back on the app
        const finalUrl = page.url();
        if (finalUrl.includes(this.BASE_URL.replace('https://', ''))) {
          this.isAuthenticated = true;
          logger.info('Screenshot bot authenticated successfully');
          return true;
        }
      } else if (currentUrl.includes(this.BASE_URL.replace('https://', ''))) {
        // We might already be authenticated (cookies from previous session)
        // Check if we can see protected content
        const hasContent = await page.$('[data-testid="character-list"], .character-card, .campaign-card');
        if (hasContent) {
          this.isAuthenticated = true;
          logger.info('Screenshot bot already authenticated');
          return true;
        }
      }

      logger.warn({ finalUrl: page.url() }, 'Authentication may have failed');
      return false;
    } catch (err) {
      logger.error({ error: err }, 'Failed to authenticate screenshot bot');
      return false;
    }
  }

  /**
   * Capture a screenshot of a page
   */
  private static async captureScreenshot(page: Page, config: PageConfig): Promise<Buffer> {
    const url = `${this.BASE_URL}${config.url}`;
    logger.info({ url, key: config.key, requiresAuth: config.requiresAuth }, 'Capturing screenshot');

    await page.setViewport(this.VIEWPORT);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    if (config.selector) {
      try {
        await page.waitForSelector(config.selector, { timeout: 10000 });
      } catch {
        logger.warn({ key: config.key, selector: config.selector }, 'Selector not found, continuing anyway');
      }
    }

    if (config.delay) {
      await new Promise(resolve => setTimeout(resolve, config.delay));
    }

    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: false,
    });

    return screenshot as Buffer;
  }

  /**
   * Upload screenshot to Supabase storage
   */
  private static async uploadScreenshot(
    buffer: Buffer,
    key: string,
    timestamp: string
  ): Promise<string> {
    const path = `screenshots/${key}/${timestamp}.png`;

    const { error } = await supabase.storage
      .from(this.STORAGE_BUCKET)
      .upload(path, buffer, {
        contentType: 'image/png',
        upsert: true,
      });

    if (error) {
      logger.error({ error, path }, 'Failed to upload screenshot');
      throw new Error(`Failed to upload screenshot: ${error.message}`);
    }

    return path;
  }

  /**
   * Get the current baseline screenshot for a page
   */
  static async getBaseline(key: string): Promise<Screenshot | null> {
    // ⚡ Bolt: Optimized to use explicit columns instead of select('*') to reduce over-fetching.
    const BASELINE_COLS = 'page_key, screenshot_path, captured_at, commit_hash';

    const { data, error } = await supabase
      .from('blog_baseline_screenshots')
      .select(BASELINE_COLS)
      .eq('page_key', key)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      key: data.page_key,
      path: data.screenshot_path,
      capturedAt: data.captured_at,
      commitHash: data.commit_hash,
    };
  }

  /**
   * Update the baseline screenshot for a page
   */
  static async updateBaseline(
    key: string,
    url: string,
    path: string,
    commitHash?: string
  ): Promise<void> {
    const { error } = await supabase
      .from('blog_baseline_screenshots')
      .upsert({
        page_key: key,
        page_url: url,
        screenshot_path: path,
        commit_hash: commitHash,
        captured_at: new Date().toISOString(),
      }, {
        onConflict: 'page_key',
      });

    if (error) {
      logger.error({ error, key }, 'Failed to update baseline screenshot');
      throw new Error(`Failed to update baseline: ${error.message}`);
    }
  }

  /**
   * Capture screenshots for all configured pages
   * Handles authentication for protected pages automatically
   */
  static async captureAllPages(commitHash?: string): Promise<Screenshot[]> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshots: Screenshot[] = [];

    // Separate pages by auth requirement
    const publicPages = PAGE_CONFIGS.filter(c => !c.requiresAuth);
    const authPages = PAGE_CONFIGS.filter(c => c.requiresAuth);

    try {
      // 1. Capture public pages first (no auth needed)
      for (const config of publicPages) {
        try {
          const buffer = await this.captureScreenshot(page, config);
          const path = await this.uploadScreenshot(buffer, config.key, timestamp);

          screenshots.push({
            key: config.key,
            path,
            capturedAt: new Date().toISOString(),
            commitHash,
          });

          logger.info({ key: config.key, path }, 'Screenshot captured and uploaded');
        } catch (err) {
          logger.error({ error: err, key: config.key }, 'Failed to capture screenshot');
        }
      }

      // 2. Authenticate for protected pages
      if (authPages.length > 0) {
        const authSuccess = await this.authenticate(page);

        if (authSuccess) {
          // 3. Capture authenticated pages
          for (const config of authPages) {
            try {
              const buffer = await this.captureScreenshot(page, config);
              const path = await this.uploadScreenshot(buffer, config.key, timestamp);

              screenshots.push({
                key: config.key,
                path,
                capturedAt: new Date().toISOString(),
                commitHash,
              });

              logger.info({ key: config.key, path }, 'Screenshot captured and uploaded');
            } catch (err) {
              logger.error({ error: err, key: config.key }, 'Failed to capture screenshot');
            }
          }
        } else {
          logger.warn(
            { skipped: authPages.map(p => p.key) },
            'Skipping authenticated pages - bot login failed or not configured'
          );
        }
      }
    } finally {
      await page.close();
    }

    return screenshots;
  }

  /**
   * Compare current screenshots to baselines and detect changes
   * Returns screenshots that have changed
   */
  static async detectChanges(commitHash?: string): Promise<ScreenshotComparison[]> {
    const currentScreenshots = await this.captureAllPages(commitHash);
    const comparisons: ScreenshotComparison[] = [];

    for (const current of currentScreenshots) {
      const baseline = await this.getBaseline(current.key);

      // For now, we consider any new screenshot a "change" if no baseline exists
      // In the future, we could implement pixel-diff comparison
      const hasChanged = !baseline || baseline.commitHash !== commitHash;

      comparisons.push({
        key: current.key,
        hasChanged,
        beforePath: baseline?.path,
        afterPath: current.path,
      });

      // Update baseline after comparison
      if (hasChanged) {
        const config = PAGE_CONFIGS.find(c => c.key === current.key);
        if (config) {
          await this.updateBaseline(current.key, config.url, current.path, commitHash);
        }
      }
    }

    return comparisons;
  }

  /**
   * Capture specific pages for a digest
   * Returns paths to screenshots that showed changes
   */
  static async captureForDigest(commitHash: string): Promise<string[]> {
    try {
      const comparisons = await this.detectChanges(commitHash);
      const changedPaths = comparisons
        .filter(c => c.hasChanged && c.afterPath)
        .map(c => c.afterPath as string);

      logger.info({
        total: comparisons.length,
        changed: changedPaths.length,
        commitHash,
      }, 'Digest screenshots captured');

      return changedPaths;
    } catch (err) {
      logger.error({ error: err }, 'Failed to capture digest screenshots');
      return [];
    } finally {
      await this.closeBrowser();
    }
  }

  /**
   * Get public URL for a screenshot path
   */
  static getPublicUrl(path: string): string {
    const { data } = supabase.storage
      .from(this.STORAGE_BUCKET)
      .getPublicUrl(path);

    return data.publicUrl;
  }
}
