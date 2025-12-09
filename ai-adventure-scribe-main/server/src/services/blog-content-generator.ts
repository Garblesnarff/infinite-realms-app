import OpenAI from 'openai';

interface CommitData {
  hash: string;
  message: string;
  body?: string;
  filesChanged?: string[];
}

interface GeneratedContent {
  title: string;
  content: string;
  summary: string;
  seoTitle: string;
  seoDescription: string;
  suggestedTags: string[];
}

export class BlogContentGenerator {
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error('OPENROUTER_API_KEY environment variable is not set');
      }
      this.client = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
        defaultHeaders: {
          'HTTP-Referer': process.env.SITE_URL || 'https://infiniterealms.app',
          'X-Title': 'Infinite Realms Blog',
        },
      });
    }
    return this.client;
  }

  async generateChangelog(commits: CommitData[], version: string): Promise<GeneratedContent> {
    const client = this.getClient();

    const prompt = `You are a technical writer for Infinite Realms, an AI-powered solo fantasy RPG game.

Generate release notes from these commits for version ${version}:

${JSON.stringify(commits, null, 2)}

Create a user-friendly changelog that:
1. Groups changes into categories: New Features, Improvements, Bug Fixes, Technical Changes (only if user-relevant)
2. Uses clear, non-technical language where possible
3. Focuses on user benefits, not implementation details
4. Is concise but informative

Format your response as JSON with these fields:
{
  "title": "Version ${version} Release Notes",
  "content": "The full changelog in markdown format with category headings",
  "summary": "A 1-2 sentence summary of the most important changes",
  "seoTitle": "Infinite Realms v${version} - What's New",
  "seoDescription": "A 150-character SEO description",
  "suggestedTags": ["array", "of", "tags"]
}`;

    const response = await client.chat.completions.create({
      model: 'moonshotai/kimi-k2-0905', // #1 creative writing model (~$0.01/post)
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.choices[0]?.message?.content || '';
    return this.parseJsonResponse(text, version, 'changelog');
  }

  async generateDevDiary(commits: CommitData[], version: string): Promise<GeneratedContent> {
    const client = this.getClient();

    const prompt = `You are writing a development diary entry for the Infinite Realms blog. Infinite Realms is an AI-powered solo fantasy RPG game where players can create and explore persistent worlds with an AI Dungeon Master.

Based on these recent code changes for version ${version}:

${JSON.stringify(commits, null, 2)}

Write an engaging, personal-style dev diary post that:
1. Is written in first person ("we" or "the team")
2. Explains what problems we were solving and why
3. Shares interesting technical challenges and how they were overcome
4. Gives readers insight into the development process
5. Hints at what's coming next
6. Has a warm, enthusiastic tone that's technical but accessible

The post should be 500-1000 words.

Format your response as JSON with these fields:
{
  "title": "An engaging dev diary title",
  "content": "The full blog post in markdown format",
  "summary": "A 2-3 sentence teaser for the post",
  "seoTitle": "60-char max SEO title",
  "seoDescription": "A 150-character SEO description",
  "suggestedTags": ["array", "of", "tags"]
}`;

    const response = await client.chat.completions.create({
      model: 'moonshotai/kimi-k2-0905', // #1 creative writing model (~$0.01/post)
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.choices[0]?.message?.content || '';
    return this.parseJsonResponse(text, version, 'dev-diary');
  }

  async generateSeoPost(topic: string, keywords: string[]): Promise<GeneratedContent> {
    const client = this.getClient();

    const seoGuidelines = `
SEO BEST PRACTICES (Google E-E-A-T):
• Experience: Share real examples and user experiences with Infinite Realms
• Expertise: Demonstrate deep knowledge of RPG mechanics and AI-assisted gaming
• Authoritativeness: Reference industry trends and gaming community insights
• Trustworthiness: Be accurate, cite sources when relevant, avoid over-promising

CONTENT STRUCTURE:
• Hook (first 100 words): Address user intent immediately
• Primary keyword in H1 title and first paragraph
• H2/H3 subheadings with semantic keywords
• Short paragraphs (2-4 sentences)
• Bullet points for scannability
• Internal link opportunities (mention related game features)
• Strong CTA that provides value

SEMANTIC SEO:
• Use LSI keywords (synonyms and related terms)
• Answer related questions naturally
• Include long-tail keyword variations
• Natural language, conversational tone`;

    const prompt = `You are an expert content writer for Infinite Realms, an AI-powered solo fantasy RPG game.

Write an SEO-optimized blog post about: "${topic}"
Primary keyword: ${keywords[0]}
Related keywords: ${keywords.slice(1).join(', ')}

${seoGuidelines}

TARGET AUDIENCE: Tabletop RPG enthusiasts, solo gamers, D&D players interested in AI-assisted gaming

Write 800-1200 words of engaging, helpful content that:
1. Solves a specific problem or answers a question
2. Positions Infinite Realms as a solution naturally (not salesy)
3. Is readable (8th-grade reading level)
4. Includes practical tips or actionable advice
5. Has personality and enthusiasm for RPG gaming

Format your response as JSON with these fields:
{
  "title": "Compelling H1 with primary keyword (50-60 chars)",
  "content": "Full markdown post with H2/H3 subheadings",
  "summary": "Meta-description-friendly excerpt (150-160 chars with keyword)",
  "seoTitle": "Title tag optimized for CTR (50-60 chars)",
  "seoDescription": "Meta description with primary keyword and CTA (150-160 chars)",
  "suggestedTags": ["5-8 relevant tags including primary keyword"]
}`;

    const response = await client.chat.completions.create({
      model: 'moonshotai/kimi-k2-0905',
      max_tokens: 4000,
      temperature: 0.8, // Slightly creative while maintaining quality
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.choices[0]?.message?.content || '';
    return this.parseJsonResponse(text, topic, 'seo');
  }

  async generateBlogPost(
    topic: string,
    options: {
      keywords?: string[];
      tone?: 'professional' | 'casual' | 'enthusiastic' | 'technical';
      length?: 'short' | 'medium' | 'long';
      includeCode?: boolean;
      targetAudience?: string;
    } = {}
  ): Promise<GeneratedContent> {
    const client = this.getClient();

    const {
      keywords = [],
      tone = 'enthusiastic',
      length = 'medium',
      includeCode = false,
      targetAudience = 'RPG enthusiasts and solo gamers',
    } = options;

    const wordCounts = {
      short: '400-600',
      medium: '800-1200',
      long: '1500-2500',
    };

    const toneGuidance = {
      professional: 'authoritative yet approachable, like a gaming industry expert',
      casual: 'friendly and conversational, like talking to a fellow gamer',
      enthusiastic: 'energetic and passionate about RPGs, warm and welcoming',
      technical: 'detailed and precise, for experienced developers and game designers',
    };

    const prompt = `You are a content writer for Infinite Realms, an AI-powered solo fantasy RPG platform.

Write a blog post about: "${topic}"
${keywords.length > 0 ? `Target keywords: ${keywords.join(', ')}` : ''}

TONE: ${toneGuidance[tone]}
LENGTH: ${wordCounts[length]} words
TARGET AUDIENCE: ${targetAudience}
${includeCode ? 'INCLUDE: Code examples or technical snippets where relevant' : ''}

GUIDELINES:
• Start with a hook that captures attention in the first 50 words
• Use storytelling elements when appropriate
• Include specific examples related to Infinite Realms features
• Add practical value (tips, guides, insights)
• Use markdown formatting for readability
• Keep paragraphs short and scannable
• End with a clear call-to-action

${keywords.length > 0 ? `
SEO REQUIREMENTS:
• Primary keyword "${keywords[0]}" in title and first paragraph
• Natural keyword integration (avoid keyword stuffing)
• Include semantic variations and related terms` : ''}

Format your response as JSON with these fields:
{
  "title": "Engaging title that captures the topic",
  "content": "Full blog post in markdown",
  "summary": "2-3 sentence teaser for listings",
  "seoTitle": "SEO-optimized title (50-60 chars)",
  "seoDescription": "Meta description with hook (150-160 chars)",
  "suggestedTags": ["relevant", "tags", "for", "categorization"]
}`;

    const response = await client.chat.completions.create({
      model: 'moonshotai/kimi-k2-0905',
      max_tokens: length === 'long' ? 6000 : 4000,
      temperature: tone === 'professional' || tone === 'technical' ? 0.7 : 0.8,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.choices[0]?.message?.content || '';
    return this.parseJsonResponse(text, topic, 'blog');
  }

  private parseJsonResponse(text: string, identifier: string, type: string): GeneratedContent {
    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        title: parsed.title || `${type} - ${identifier}`,
        content: parsed.content || '',
        summary: parsed.summary || '',
        seoTitle: parsed.seoTitle || parsed.title || '',
        seoDescription: parsed.seoDescription || parsed.summary?.slice(0, 150) || '',
        suggestedTags: parsed.suggestedTags || [],
      };
    } catch (error) {
      console.error('[BlogContentGenerator] Failed to parse AI response:', error);
      // Return a basic structure with the raw content
      return {
        title: `${type.charAt(0).toUpperCase() + type.slice(1)} - ${identifier}`,
        content: text,
        summary: text.slice(0, 200),
        seoTitle: `${type} - ${identifier}`,
        seoDescription: text.slice(0, 150),
        suggestedTags: [],
      };
    }
  }
}

// Singleton instance
export const blogContentGenerator = new BlogContentGenerator();
