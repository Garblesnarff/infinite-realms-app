import { supabase } from '../../../src/infrastructure/database/index.js';
import { logger } from '../utils/logger.js';

/**
 * Blog Image Generator Service
 *
 * Generates hero images for blog posts using OpenRouter's image generation models.
 * Uses FLUX or SDXL for high-quality blog post imagery.
 */

interface ImageGenerationResult {
  success: boolean;
  path?: string;
  publicUrl?: string;
  prompt: string;
  error?: string;
}

interface OpenRouterImageResponse {
  data?: Array<{
    url?: string;
    b64_json?: string;
  }>;
  error?: {
    message: string;
  };
}

export class BlogImageGenerator {
  private static readonly STORAGE_BUCKET = process.env.BLOG_MEDIA_BUCKET || 'blog-media';
  private static readonly OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  private static readonly IMAGE_MODEL = 'black-forest-labs/flux-schnell'; // Fast, high-quality

  /**
   * Generate a prompt for a daily digest hero image
   */
  static generateDigestPrompt(changes: {
    features: string[];
    fixes: string[];
    improvements: string[];
  }): string {
    const hasFeatures = changes.features.length > 0;
    const hasFixes = changes.fixes.length > 0;

    let theme = 'fantasy RPG adventure game development';
    let mood = 'epic and magical';

    if (hasFeatures) {
      theme = 'new features being built, fantasy adventure game, magical creation';
      mood = 'exciting and innovative';
    } else if (hasFixes) {
      theme = 'refinement and polish, fantasy game mechanics, attention to detail';
      mood = 'precise and professional';
    }

    return `A stunning digital art illustration for a game development blog post. Theme: ${theme}. Mood: ${mood}. Style: fantasy art, warm lighting, cinematic composition, 4K, highly detailed. Include subtle hints of code or development tools integrated artistically. No text or logos.`;
  }

  /**
   * Generate a prompt for a major feature hero image
   */
  static generateFeaturePrompt(featureTitle: string, featureDescription: string): string {
    return `A stunning digital art illustration for a game feature announcement. The feature is: "${featureTitle}". Style: fantasy RPG art, epic composition, magical elements, cinematic lighting. The artwork should evoke the feeling of: ${featureDescription.slice(0, 200)}. 4K quality, highly detailed, professional game art. No text or logos.`;
  }

  /**
   * Generate an image using OpenRouter
   */
  static async generateImage(prompt: string): Promise<ImageGenerationResult> {
    if (!this.OPENROUTER_API_KEY) {
      logger.warn('OpenRouter API key not configured, skipping image generation');
      return {
        success: false,
        prompt,
        error: 'OpenRouter API key not configured',
      };
    }

    try {
      logger.info({ prompt: prompt.slice(0, 100) }, 'Generating blog image');

      const response = await fetch('https://openrouter.ai/api/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.APP_ORIGIN || 'https://infiniterealms.app',
          'X-Title': 'Infinite Realms Blog',
        },
        body: JSON.stringify({
          model: this.IMAGE_MODEL,
          prompt,
          n: 1,
          size: '1024x1024',
          response_format: 'b64_json',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'OpenRouter API error');
        return {
          success: false,
          prompt,
          error: `OpenRouter API error: ${response.status}`,
        };
      }

      const result = (await response.json()) as OpenRouterImageResponse;

      if (result.error) {
        return {
          success: false,
          prompt,
          error: result.error.message,
        };
      }

      const imageData = result.data?.[0];
      if (!imageData?.b64_json) {
        return {
          success: false,
          prompt,
          error: 'No image data in response',
        };
      }

      // Upload to Supabase storage
      const buffer = Buffer.from(imageData.b64_json, 'base64');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const path = `hero-images/digest-${timestamp}.png`;

      const { error: uploadError } = await supabase.storage
        .from(this.STORAGE_BUCKET)
        .upload(path, buffer, {
          contentType: 'image/png',
          upsert: true,
        });

      if (uploadError) {
        logger.error({ error: uploadError, path }, 'Failed to upload generated image');
        return {
          success: false,
          prompt,
          error: `Upload failed: ${uploadError.message}`,
        };
      }

      const { data: urlData } = supabase.storage.from(this.STORAGE_BUCKET).getPublicUrl(path);

      logger.info({ path, prompt: prompt.slice(0, 50) }, 'Blog image generated and uploaded');

      return {
        success: true,
        path,
        publicUrl: urlData.publicUrl,
        prompt,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ error: err }, 'Failed to generate blog image');
      return {
        success: false,
        prompt,
        error: errorMessage,
      };
    }
  }

  /**
   * Generate hero image for a daily digest
   */
  static async generateDigestHeroImage(changes: {
    features: string[];
    fixes: string[];
    improvements: string[];
  }): Promise<ImageGenerationResult> {
    const prompt = this.generateDigestPrompt(changes);
    return this.generateImage(prompt);
  }

  /**
   * Generate hero image for a major feature announcement
   */
  static async generateFeatureHeroImage(
    featureTitle: string,
    featureDescription: string,
  ): Promise<ImageGenerationResult> {
    const prompt = this.generateFeaturePrompt(featureTitle, featureDescription);
    return this.generateImage(prompt);
  }

  /**
   * Get a fallback placeholder image URL
   */
  static getFallbackImageUrl(): string {
    return `${process.env.APP_ORIGIN || 'https://infiniterealms.app'}/placeholder-blog-hero.png`;
  }
}
