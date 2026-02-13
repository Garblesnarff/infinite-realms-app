/* eslint-disable max-lines */
import { BlogImageGenerator } from './blog-image-generator.js';
import { BlogScreenshotService } from './blog-screenshot-service.js';
import { supabase } from '../../../src/infrastructure/database/index.js';
import { logger } from '../utils/logger.js';

/**
 * Blog Digest Service
 *
 * Generates daily digest blog posts from queued commits.
 * Features:
 * - Aggregates commits from the past 24 hours
 * - Uses AI to summarize and categorize changes
 * - Generates hero images using OpenRouter
 * - Captures screenshots of changed pages
 * - Detects major features for standalone posts
 */

interface CommitRecord {
  id: string;
  commit_hash: string;
  commit_message: string;
  author: string | null;
  files_changed: string[] | null;
  pr_number: number | null;
  pr_title: string | null;
  committed_at: string;
}

interface DigestAnalysis {
  title: string;
  summary: string;
  features: CommitGroup[];
  fixes: CommitGroup[];
  improvements: CommitGroup[];
  majorFeature?: {
    title: string;
    description: string;
    commits: string[];
  };
}

interface CommitGroup {
  title: string;
  description: string;
  commits: string[];
}

interface DigestResult {
  success: boolean;
  postId?: string;
  postSlug?: string;
  standalonePostId?: string;
  error?: string;
}

export class BlogDigestService {
  private static readonly SYSTEM_AUTHOR_ID = process.env.BLOG_SYSTEM_AUTHOR_ID;
  private static readonly OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  private static readonly TEXT_MODEL =
    process.env.OPENROUTER_TEXT_MODEL || 'google/gemini-flash-1.5';

  /**
   * Queue a commit for digest processing
   */
  static async queueCommit(data: {
    commitHash: string;
    commitMessage: string;
    author?: string;
    filesChanged?: string[];
    prNumber?: number;
    prTitle?: string;
    committedAt: Date;
  }): Promise<void> {
    const { error } = await supabase.from('blog_digest_queue').upsert(
      {
        commit_hash: data.commitHash,
        commit_message: data.commitMessage,
        author: data.author,
        files_changed: data.filesChanged,
        pr_number: data.prNumber,
        pr_title: data.prTitle,
        committed_at: data.committedAt.toISOString(),
        processed: false,
      },
      {
        onConflict: 'commit_hash',
      },
    );

    if (error) {
      logger.error({ error, commitHash: data.commitHash }, 'Failed to queue commit');
      throw error;
    }

    logger.info({ commitHash: data.commitHash }, 'Commit queued for digest');
  }

  /**
   * Get unprocessed commits from the queue
   */
  static async getUnprocessedCommits(since?: Date): Promise<CommitRecord[]> {
    const sinceDate = since || new Date(Date.now() - 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('blog_digest_queue')
      .select('*')
      .eq('processed', false)
      .gte('committed_at', sinceDate.toISOString())
      .order('committed_at', { ascending: true });

    if (error) {
      logger.error({ error }, 'Failed to fetch unprocessed commits');
      return [];
    }

    return data || [];
  }

  /**
   * Use AI to analyze commits and generate digest structure
   */
  static async analyzeCommits(commits: CommitRecord[]): Promise<DigestAnalysis> {
    if (!this.OPENROUTER_API_KEY) {
      // Fallback: simple categorization without AI
      return this.simpleAnalysis(commits);
    }

    const commitSummary = commits.map((c) => ({
      message: c.commit_message,
      pr: c.pr_title,
      files: c.files_changed?.slice(0, 10),
    }));

    const prompt = `You are analyzing git commits for a daily development blog digest for "Infinite Realms", an AI-powered D&D game.

Commits from today:
${JSON.stringify(commitSummary, null, 2)}

Analyze these commits and return a JSON object with:
1. "title": A catchy blog post title for this daily update (e.g., "Daily Update: Combat Improvements & Bug Fixes")
2. "summary": A 2-3 sentence summary suitable for a blog post excerpt
3. "features": Array of new features added (each with title, description, and related commit messages)
4. "fixes": Array of bug fixes (each with title, description, and related commit messages)
5. "improvements": Array of improvements/refactoring (each with title, description, and related commit messages)
6. "majorFeature": If there's a significant new feature that deserves its own blog post, include it here with title, description, and related commits. Otherwise null.

Only include majorFeature if there's something truly noteworthy (new game mechanic, major UI overhaul, etc).

Return ONLY valid JSON, no markdown.`;

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.APP_ORIGIN || 'https://infiniterealms.app',
          'X-Title': 'Infinite Realms Blog',
        },
        body: JSON.stringify({
          model: this.TEXT_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        logger.warn({ status: response.status }, 'OpenRouter API error, using simple analysis');
        return this.simpleAnalysis(commits);
      }

      const result = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = result.choices?.[0]?.message?.content;
      if (!content) {
        return this.simpleAnalysis(commits);
      }

      // Parse JSON from response (handle potential markdown wrapping)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.simpleAnalysis(commits);
      }

      return JSON.parse(jsonMatch[0]) as DigestAnalysis;
    } catch (err) {
      logger.error({ error: err }, 'Failed to analyze commits with AI');
      return this.simpleAnalysis(commits);
    }
  }

  /**
   * Simple commit analysis without AI
   */
  private static simpleAnalysis(commits: CommitRecord[]): DigestAnalysis {
    const today = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    const features: CommitGroup[] = [];
    const fixes: CommitGroup[] = [];
    const improvements: CommitGroup[] = [];

    for (const commit of commits) {
      const msg = commit.commit_message.toLowerCase();
      const group = {
        title: commit.pr_title || commit.commit_message.split('\n')[0],
        description: commit.commit_message,
        commits: [commit.commit_hash.slice(0, 7)],
      };

      if (msg.includes('feat') || msg.includes('add')) {
        features.push(group);
      } else if (msg.includes('fix') || msg.includes('bug')) {
        fixes.push(group);
      } else {
        improvements.push(group);
      }
    }

    return {
      title: `Daily Update: ${today}`,
      summary: `Today's update includes ${commits.length} commits with ${features.length} new features, ${fixes.length} bug fixes, and ${improvements.length} improvements.`,
      features,
      fixes,
      improvements,
    };
  }

  /**
   * Generate markdown content for the digest post
   */
  static generateDigestMarkdown(analysis: DigestAnalysis, screenshots: string[]): string {
    let content = `${analysis.summary}\n\n`;

    if (analysis.features.length > 0) {
      content += `## New Features\n\n`;
      for (const feature of analysis.features) {
        content += `### ${feature.title}\n\n${feature.description}\n\n`;
      }
    }

    if (analysis.fixes.length > 0) {
      content += `## Bug Fixes\n\n`;
      for (const fix of analysis.fixes) {
        content += `- **${fix.title}**: ${fix.description}\n`;
      }
      content += '\n';
    }

    if (analysis.improvements.length > 0) {
      content += `## Improvements\n\n`;
      for (const improvement of analysis.improvements) {
        content += `- **${improvement.title}**: ${improvement.description}\n`;
      }
      content += '\n';
    }

    if (screenshots.length > 0) {
      content += `## Screenshots\n\n`;
      for (const path of screenshots) {
        const url = BlogScreenshotService.getPublicUrl(path);
        content += `![Screenshot](${url})\n\n`;
      }
    }

    return content;
  }

  /**
   * Create a blog post in the database
   */
  static async createBlogPost(data: {
    title: string;
    slug: string;
    summary: string;
    content: string;
    featuredImageUrl?: string;
  }): Promise<string | null> {
    if (!this.SYSTEM_AUTHOR_ID) {
      logger.error('BLOG_SYSTEM_AUTHOR_ID not configured');
      return null;
    }

    const { data: post, error } = await supabase
      .from('blog_posts')
      .insert({
        author_id: this.SYSTEM_AUTHOR_ID,
        title: data.title,
        slug: data.slug,
        summary: data.summary,
        content: data.content,
        featured_image_url: data.featuredImageUrl,
        status: 'published',
        published_at: new Date().toISOString(),
        metadata: { generated: true, type: 'digest' },
      })
      .select('id')
      .single();

    if (error) {
      logger.error({ error }, 'Failed to create blog post');
      return null;
    }

    return post?.id || null;
  }

  /**
   * Generate the daily digest
   */
  static async generateDailyDigest(dryRun = false): Promise<DigestResult> {
    logger.info({ dryRun }, 'Starting daily digest generation');

    // Get unprocessed commits
    const commits = await this.getUnprocessedCommits();
    if (commits.length === 0) {
      logger.info('No commits to process for digest');
      return { success: true, error: 'No commits to process' };
    }

    logger.info({ commitCount: commits.length }, 'Found commits for digest');

    // Analyze commits
    const analysis = await this.analyzeCommits(commits);
    logger.info(
      { analysis: { title: analysis.title, majorFeature: !!analysis.majorFeature } },
      'Commits analyzed',
    );

    // Get latest commit hash for screenshots
    const latestCommit = commits[commits.length - 1].commit_hash;

    // Capture screenshots (if not dry run)
    let screenshots: string[] = [];
    if (!dryRun) {
      try {
        screenshots = await BlogScreenshotService.captureForDigest(latestCommit);
      } catch (err) {
        logger.warn({ error: err }, 'Screenshot capture failed, continuing without screenshots');
      }
    }

    // Generate hero image
    let heroImageUrl: string | undefined;
    if (!dryRun) {
      const imageResult = await BlogImageGenerator.generateDigestHeroImage({
        features: analysis.features.map((f) => f.title),
        fixes: analysis.fixes.map((f) => f.title),
        improvements: analysis.improvements.map((f) => f.title),
      });

      if (imageResult.success && imageResult.publicUrl) {
        heroImageUrl = imageResult.publicUrl;
      }
    }

    // Generate markdown content
    const content = this.generateDigestMarkdown(analysis, screenshots);

    // Generate slug
    const today = new Date();
    const slug = `daily-update-${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    if (dryRun) {
      logger.info(
        {
          title: analysis.title,
          slug,
          commitCount: commits.length,
          hasScreenshots: screenshots.length > 0,
          hasHeroImage: !!heroImageUrl,
          hasMajorFeature: !!analysis.majorFeature,
        },
        'Dry run complete',
      );

      return {
        success: true,
        postSlug: slug,
      };
    }

    // Create the blog post
    const postId = await this.createBlogPost({
      title: analysis.title,
      slug,
      summary: analysis.summary,
      content,
      featuredImageUrl: heroImageUrl,
    });

    if (!postId) {
      return { success: false, error: 'Failed to create blog post' };
    }

    // Mark commits as processed
    const commitIds = commits.map((c) => c.id);
    await supabase.rpc('mark_digest_commits_processed', {
      p_commit_ids: commitIds,
      p_digest_post_id: postId,
    });

    // Record the digest
    await supabase.from('blog_digests').insert({
      post_id: postId,
      digest_date: today.toISOString().split('T')[0],
      commit_count: commits.length,
      commits_included: commitIds,
      hero_image_prompt: heroImageUrl ? 'Generated' : null,
      hero_image_path: heroImageUrl,
      screenshots_included: screenshots,
      major_feature_detected: !!analysis.majorFeature,
      ai_analysis: analysis,
    });

    // Handle major feature standalone post
    let standalonePostId: string | undefined;
    if (analysis.majorFeature) {
      const featureSlug = `feature-${slug}-${analysis.majorFeature.title.toLowerCase().replace(/\s+/g, '-').slice(0, 30)}`;

      // Generate feature-specific hero image
      const featureImageResult = await BlogImageGenerator.generateFeatureHeroImage(
        analysis.majorFeature.title,
        analysis.majorFeature.description,
      );

      standalonePostId =
        (await this.createBlogPost({
          title: analysis.majorFeature.title,
          slug: featureSlug,
          summary: analysis.majorFeature.description,
          content: `# ${analysis.majorFeature.title}\n\n${analysis.majorFeature.description}`,
          featuredImageUrl: featureImageResult.publicUrl,
        })) || undefined;
    }

    logger.info(
      {
        postId,
        slug,
        commitCount: commits.length,
        standalonePostId,
      },
      'Daily digest generated successfully',
    );

    return {
      success: true,
      postId,
      postSlug: slug,
      standalonePostId,
    };
  }
}
