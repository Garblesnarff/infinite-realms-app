/* eslint-disable max-lines */
import { blogContentGenerator } from './blog-content-generator.js';
import { blogIdeation } from './blog-ideation.js';
import { logger } from '../lib/logger.js';
import { supabaseService } from '../lib/supabase.js';

interface DailyBlogResult {
  success: boolean;
  postId?: string;
  slug?: string;
  title?: string;
  url?: string;
  error?: string;
}

export class BlogAutomation {
  private lastRunDate: string | null = null;

  async generateDailyPost(): Promise<DailyBlogResult> {
    try {
      logger.info('[BlogAutomation] Starting daily blog post generation...');

      // Check if we've already generated a post today
      if (this.hasRunToday()) {
        logger.info('[BlogAutomation] Already generated a post today, skipping');
        return {
          success: false,
          error: 'Already generated a post today',
        };
      }

      // Get recent posts to avoid duplicate topics
      const recentPosts = await this.getRecentPosts(7);
      const recentTitles = recentPosts.map(p => p.title);

      logger.info({ msg: '[BlogAutomation] Recent posts', count: recentTitles.length });

      // Generate topic ideas
      logger.info('[BlogAutomation] Generating topic ideas...');
      const topics = await blogIdeation.generateTopicIdeas({
        recentPosts: recentTitles,
        focus: this.getDailyFocus(),
      }, 5);

      logger.info({ msg: '[BlogAutomation] Generated topic ideas', count: topics.length });

      // Select the best topic
      const bestTopic = await blogIdeation.selectBestTopic(topics);
      logger.info({ msg: '[BlogAutomation] Selected topic', title: bestTopic.title });

      // Generate content for the selected topic
      logger.info('[BlogAutomation] Generating content...');
      const content = await blogContentGenerator.generateBlogPost(bestTopic.title, {
        keywords: bestTopic.keywords,
        tone: bestTopic.tone,
        length: bestTopic.length,
        targetAudience: bestTopic.targetAudience,
      });

      logger.info({ msg: '[BlogAutomation] Content generated', title: content.title });

      // Create slug
      const slug = this.createSlug(content.title);

      // Get system author ID
      const systemAuthorId = process.env.BLOG_SYSTEM_AUTHOR_ID;
      if (!systemAuthorId) {
        throw new Error('BLOG_SYSTEM_AUTHOR_ID environment variable is not set');
      }

      // Insert into database
      const { data: post, error } = await supabaseService
        .from('blog_posts')
        .insert({
          title: content.title,
          slug,
          content: content.content,
          excerpt: content.summary,
          seo_title: content.seoTitle,
          seo_description: content.seoDescription,
          author_id: systemAuthorId,
          status: 'published',
          published_at: new Date().toISOString(),
        })
        .select('id, slug, title')
        .single();

      if (error) {
        throw new Error(`Failed to create blog post: ${error.message}`);
      }

      // Add tags
      if (content.suggestedTags.length > 0) {
        await this.addTags(post.id, content.suggestedTags);
      }

      // Add categories based on keywords
      const categories = this.extractCategories(bestTopic.keywords);
      if (categories.length > 0) {
        await this.addCategories(post.id, categories);
      }

      // Update last run date
      this.lastRunDate = new Date().toISOString().split('T')[0] || null;

      const baseUrl = process.env.BLOG_BASE_URL || 'https://blog.infiniterealms.app';
      const url = `${baseUrl}/${slug}`;

      logger.info({ msg: '[BlogAutomation] Daily blog post published', url });

      return {
        success: true,
        postId: post.id,
        slug: post.slug,
        title: post.title,
        url,
      };
    } catch (error) {
      logger.error({ msg: '[BlogAutomation] Error generating daily post', error });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  private hasRunToday(): boolean {
    const today = new Date().toISOString().split('T')[0];
    return this.lastRunDate === today;
  }

  private getDailyFocus(): 'seo' | 'engagement' | 'technical' | 'community' {
    // Rotate focus based on day of week
    const dayOfWeek = new Date().getDay();
    const focusRotation: Array<'seo' | 'engagement' | 'technical' | 'community'> = [
      'seo',        // Sunday
      'engagement', // Monday
      'seo',        // Tuesday
      'technical',  // Wednesday
      'seo',        // Thursday
      'community',  // Friday
      'engagement', // Saturday
    ];
    return focusRotation[dayOfWeek] || 'seo';
  }

  private async getRecentPosts(days: number) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const { data, error } = await supabaseService
      .from('blog_posts')
      .select('id, title, slug')
      .gte('published_at', since.toISOString())
      .order('published_at', { ascending: false })
      .limit(10);

    if (error) {
      logger.error({ msg: '[BlogAutomation] Error fetching recent posts', error });
      return [];
    }

    return data || [];
  }

  private createSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private extractCategories(keywords: string[]): string[] {
    const categoryMap: Record<string, string> = {
      'ai': 'AI',
      'dungeon master': 'Game Mastering',
      'game master': 'Game Mastering',
      'solo': 'Solo Gaming',
      'd&d': 'D&D',
      'rpg': 'RPG',
      'character': 'Character Creation',
      'campaign': 'Campaign Management',
      'technical': 'Technical',
      'community': 'Community',
    };

    const categories = new Set<string>();
    for (const keyword of keywords) {
      const lowerKeyword = keyword.toLowerCase();
      for (const [key, category] of Object.entries(categoryMap)) {
        if (lowerKeyword.includes(key)) {
          categories.add(category);
        }
      }
    }

    return Array.from(categories);
  }

  private async addTags(postId: string, tags: string[]) {
    const tagData = tags.map(name => ({
      name,
      slug: this.createSlug(name)
    }));
    const slugs = tagData.map(t => t.slug);

    // ⚡ Bolt: Batch fetch existing tags to avoid N+1 SELECT pattern
    const { data: existingTags, error: fetchError } = await supabaseService
      .from('blog_tags')
      .select('id, slug')
      .in('slug', slugs);

    if (fetchError) {
      logger.error({ msg: '[BlogAutomation] Error fetching existing tags', error: fetchError });
    }

    const existingSlugs = new Set(existingTags?.map(t => t.slug) || []);
    const newTags = tagData.filter(t => !existingSlugs.has(t.slug));

    // ⚡ Bolt: Batch insert missing tags to avoid N+1 INSERT pattern
    const allTags = [...(existingTags || [])];
    if (newTags.length > 0) {
      const { data: createdTags, error: createError } = await supabaseService
        .from('blog_tags')
        .insert(newTags)
        .select('id, slug');

      if (createError) {
        logger.error({ msg: '[BlogAutomation] Error creating new tags', error: createError });
      } else if (createdTags) {
        allTags.push(...createdTags);
      }
    }

    // ⚡ Bolt: Batch link tags to post in a single round-trip
    if (allTags.length > 0) {
      const postTags = allTags.map(t => ({
        post_id: postId,
        tag_id: t.id
      }));

      const { error: linkError } = await supabaseService
        .from('blog_post_tags')
        .insert(postTags);

      if (linkError) {
        logger.error({ msg: '[BlogAutomation] Error linking tags to post', error: linkError });
      }
    }
  }

  private async addCategories(postId: string, categories: string[]) {
    const categoryData = categories.map(name => ({
      name,
      slug: this.createSlug(name)
    }));
    const slugs = categoryData.map(c => c.slug);

    // ⚡ Bolt: Batch fetch existing categories to avoid N+1 SELECT pattern
    const { data: existingCategories, error: fetchError } = await supabaseService
      .from('blog_categories')
      .select('id, slug')
      .in('slug', slugs);

    if (fetchError) {
      logger.error({ msg: '[BlogAutomation] Error fetching existing categories', error: fetchError });
    }

    const existingSlugs = new Set(existingCategories?.map(c => c.slug) || []);
    const newCategories = categoryData.filter(c => !existingSlugs.has(c.slug));

    // ⚡ Bolt: Batch insert missing categories to avoid N+1 INSERT pattern
    const allCategories = [...(existingCategories || [])];
    if (newCategories.length > 0) {
      const { data: createdCategories, error: createError } = await supabaseService
        .from('blog_categories')
        .insert(newCategories)
        .select('id, slug');

      if (createError) {
        logger.error({ msg: '[BlogAutomation] Error creating new categories', error: createError });
      } else if (createdCategories) {
        allCategories.push(...createdCategories);
      }
    }

    // ⚡ Bolt: Batch link categories to post in a single round-trip
    if (allCategories.length > 0) {
      const postCategories = allCategories.map(c => ({
        post_id: postId,
        category_id: c.id
      }));

      const { error: linkError } = await supabaseService
        .from('blog_post_categories')
        .insert(postCategories);

      if (linkError) {
        logger.error({ msg: '[BlogAutomation] Error linking categories to post', error: linkError });
      }
    }
  }
}

// Singleton instance
export const blogAutomation = new BlogAutomation();
