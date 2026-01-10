import { blogIdeation } from './blog-ideation.js';
import { blogContentGenerator } from './blog-content-generator.js';
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
      console.log('[BlogAutomation] Starting daily blog post generation...');

      // Check if we've already generated a post today
      if (this.hasRunToday()) {
        console.log('[BlogAutomation] Already generated a post today, skipping');
        return {
          success: false,
          error: 'Already generated a post today',
        };
      }

      // Get recent posts to avoid duplicate topics
      const recentPosts = await this.getRecentPosts(7);
      const recentTitles = recentPosts.map(p => p.title);

      console.log('[BlogAutomation] Recent posts:', recentTitles);

      // Generate topic ideas
      console.log('[BlogAutomation] Generating topic ideas...');
      const topics = await blogIdeation.generateTopicIdeas({
        recentPosts: recentTitles,
        focus: this.getDailyFocus(),
      }, 5);

      console.log('[BlogAutomation] Generated', topics.length, 'topic ideas');

      // Select the best topic
      const bestTopic = await blogIdeation.selectBestTopic(topics);
      console.log('[BlogAutomation] Selected topic:', bestTopic.title);

      // Generate content for the selected topic
      console.log('[BlogAutomation] Generating content...');
      const content = await blogContentGenerator.generateBlogPost(bestTopic.title, {
        keywords: bestTopic.keywords,
        tone: bestTopic.tone,
        length: bestTopic.length,
        targetAudience: bestTopic.targetAudience,
      });

      console.log('[BlogAutomation] Content generated:', content.title);

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

      console.log('[BlogAutomation] Daily blog post published:', url);

      return {
        success: true,
        postId: post.id,
        slug: post.slug,
        title: post.title,
        url,
      };
    } catch (error) {
      console.error('[BlogAutomation] Error generating daily post:', error);
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
      console.error('[BlogAutomation] Error fetching recent posts:', error);
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
    for (const tagName of tags) {
      // Get or create tag
      const { data: tag, error: tagError } = await supabaseService
        .from('blog_tags')
        .select('id')
        .eq('slug', this.createSlug(tagName))
        .maybeSingle();

      let tagId;
      if (!tag) {
        const { data: newTag, error: createError } = await supabaseService
          .from('blog_tags')
          .insert({
            name: tagName,
            slug: this.createSlug(tagName),
          })
          .select('id')
          .single();

        if (createError) {
          console.error('[BlogAutomation] Error creating tag:', createError);
          continue;
        }
        tagId = newTag.id;
      } else {
        tagId = tag.id;
      }

      // Link to post
      await supabaseService
        .from('blog_post_tags')
        .insert({
          post_id: postId,
          tag_id: tagId,
        });
    }
  }

  private async addCategories(postId: string, categories: string[]) {
    for (const categoryName of categories) {
      // Get or create category
      const { data: category, error: categoryError } = await supabaseService
        .from('blog_categories')
        .select('id')
        .eq('slug', this.createSlug(categoryName))
        .maybeSingle();

      let categoryId;
      if (!category) {
        const { data: newCategory, error: createError } = await supabaseService
          .from('blog_categories')
          .insert({
            name: categoryName,
            slug: this.createSlug(categoryName),
          })
          .select('id')
          .single();

        if (createError) {
          console.error('[BlogAutomation] Error creating category:', createError);
          continue;
        }
        categoryId = newCategory.id;
      } else {
        categoryId = category.id;
      }

      // Link to post
      await supabaseService
        .from('blog_post_categories')
        .insert({
          post_id: postId,
          category_id: categoryId,
        });
    }
  }
}

// Singleton instance
export const blogAutomation = new BlogAutomation();
