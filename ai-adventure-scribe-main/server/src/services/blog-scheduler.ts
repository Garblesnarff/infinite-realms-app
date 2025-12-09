import { supabaseService } from '../lib/supabase.js';
import { blogAutomation } from './blog-automation.js';

const CHECK_INTERVAL_MS = 60_000; // Check every minute
const BLOG_POSTS_TABLE = process.env.SUPABASE_BLOG_TABLE || 'blog_posts';
const DAILY_CHECK_INTERVAL_MS = 3_600_000; // Check for daily post every hour

export class BlogScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private dailyIntervalId: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private isDailyProcessing = false;

  start(): void {
    if (this.intervalId) {
      console.log('[BlogScheduler] Already running');
      return;
    }

    console.log('[BlogScheduler] Starting scheduler (checking every 60 seconds)');
    console.log('[BlogScheduler] Starting daily blog automation (checking every hour)');

    // Run immediately on start, then at intervals
    this.processScheduledPosts();
    this.intervalId = setInterval(() => this.processScheduledPosts(), CHECK_INTERVAL_MS);

    // Daily blog automation - check every hour
    this.processDailyBlog();
    this.dailyIntervalId = setInterval(() => this.processDailyBlog(), DAILY_CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.dailyIntervalId) {
      clearInterval(this.dailyIntervalId);
      this.dailyIntervalId = null;
    }
    console.log('[BlogScheduler] Stopped');
  }

  async processScheduledPosts(): Promise<void> {
    // Prevent concurrent processing
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      const now = new Date().toISOString();

      // Find posts that are scheduled and due for publishing
      const { data: posts, error: fetchError } = await supabaseService
        .from(BLOG_POSTS_TABLE)
        .select('id, title, slug, scheduled_for')
        .eq('status', 'scheduled')
        .lte('scheduled_for', now)
        .order('scheduled_for', { ascending: true });

      if (fetchError) {
        console.error('[BlogScheduler] Error fetching scheduled posts:', fetchError.message);
        return;
      }

      if (!posts || posts.length === 0) {
        return;
      }

      console.log(`[BlogScheduler] Found ${posts.length} post(s) to publish`);

      for (const post of posts) {
        try {
          const { error: updateError } = await supabaseService
            .from(BLOG_POSTS_TABLE)
            .update({
              status: 'published',
              published_at: now,
              updated_at: now,
            })
            .eq('id', post.id);

          if (updateError) {
            console.error(`[BlogScheduler] Failed to publish "${post.title}":`, updateError.message);
            continue;
          }

          console.log(`[BlogScheduler] Published: "${post.title}" (${post.slug})`);
        } catch (postError) {
          console.error(`[BlogScheduler] Error processing post ${post.id}:`, postError);
        }
      }
    } catch (error) {
      console.error('[BlogScheduler] Unexpected error:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  async processDailyBlog(): Promise<void> {
    // Prevent concurrent processing
    if (this.isDailyProcessing) {
      return;
    }

    this.isDailyProcessing = true;

    try {
      const result = await blogAutomation.generateDailyPost();

      if (result.success) {
        console.log(`[BlogScheduler] ✅ Daily blog post published: ${result.url}`);
      } else if (result.error && !result.error.includes('Already generated')) {
        console.error(`[BlogScheduler] Failed to generate daily post: ${result.error}`);
      }
    } catch (error) {
      console.error('[BlogScheduler] Unexpected error in daily blog automation:', error);
    } finally {
      this.isDailyProcessing = false;
    }
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }
}

// Singleton instance
export const blogScheduler = new BlogScheduler();
