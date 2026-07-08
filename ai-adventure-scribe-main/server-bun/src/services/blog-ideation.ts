import OpenAI from 'openai';

import { logger } from '../lib/logger.js';

interface BlogTopic {
  title: string;
  keywords: string[];
  tone: 'professional' | 'casual' | 'enthusiastic' | 'technical';
  length: 'short' | 'medium' | 'long';
  rationale: string;
  targetAudience: string;
  seoValue: 'high' | 'medium' | 'low';
}

interface IdeationContext {
  recentPosts?: string[];
  excludeTopics?: string[];
  focus?: 'seo' | 'engagement' | 'technical' | 'community';
}

export class BlogIdeation {
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

  async generateTopicIdeas(context: IdeationContext = {}, count: number = 5): Promise<BlogTopic[]> {
    const client = this.getClient();

    const recentPostsContext = context.recentPosts?.length
      ? `\n\nRECENT POSTS (avoid similar topics):\n${context.recentPosts.map(p => `- ${p}`).join('\n')}`
      : '';

    const excludeContext = context.excludeTopics?.length
      ? `\n\nEXCLUDE TOPICS:\n${context.excludeTopics.map(t => `- ${t}`).join('\n')}`
      : '';

    const focusGuidance = {
      seo: 'Focus on high-search-volume keywords and trending topics in the RPG/AI gaming space',
      engagement: 'Focus on topics that spark discussion and community engagement',
      technical: 'Focus on technical deep-dives, AI architecture, and game design principles',
      community: 'Focus on user stories, community spotlights, and player experiences',
    };

    const focusInstruction = context.focus ? focusGuidance[context.focus] : 'Balance SEO value with engagement potential';

    const prompt = `You are a content strategist for Infinite Realms, an AI-powered solo fantasy RPG game.

Generate ${count} blog post topic ideas that will:
1. Attract the target audience (tabletop RPG enthusiasts, solo gamers, D&D players)
2. Demonstrate Infinite Realms' value proposition (AI-powered game master, persistent worlds)
3. Rank well in search engines (target long-tail keywords)
4. Drive engagement and sharing

CONTENT STRATEGY: ${focusInstruction}

TARGET KEYWORDS (prioritize these themes):
- Solo RPG gaming / solo tabletop RPG
- AI dungeon master / AI game master / AI DM
- D&D alternatives / solo D&D
- Fantasy RPG / fantasy adventure games
- Character creation / campaign management
- Persistent game worlds / long-term campaigns
${recentPostsContext}${excludeContext}

SEO BEST PRACTICES:
- Target question-based queries ("How to...", "What is...", "Best ways to...")
- Include year/seasonal content ("in 2025", "best practices")
- Address pain points (loneliness in solo gaming, difficulty finding groups)
- Compare/contrast topics (vs traditional D&D, vs other AI tools)

For each topic idea, provide:
1. **Title**: Catchy, keyword-rich, 50-60 characters
2. **Keywords**: 3-5 target keywords (primary + LSI)
3. **Tone**: professional | casual | enthusiastic | technical
4. **Length**: short | medium | long
5. **Rationale**: Why this topic is valuable (1-2 sentences)
6. **Target Audience**: Who will find this useful
7. **SEO Value**: high | medium | low (search volume + competition)

Format your response as JSON:
{
  "topics": [
    {
      "title": "How AI Dungeon Masters Are Revolutionizing Solo RPG Gaming",
      "keywords": ["ai dungeon master", "solo rpg", "ai game master", "solo d&d", "rpg technology"],
      "tone": "enthusiastic",
      "length": "medium",
      "rationale": "Addresses the core value prop of Infinite Realms while targeting high-volume keywords",
      "targetAudience": "Solo gamers looking for alternatives to traditional tabletop gaming",
      "seoValue": "high"
    }
  ]
}`;

    const response = await client.chat.completions.create({
      model: 'deepseek/deepseek-chat',
      max_tokens: 3000,
      temperature: 0.8,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.choices[0]?.message?.content || '';
    return this.parseTopicIdeas(text);
  }

  async selectBestTopic(topics: BlogTopic[]): Promise<BlogTopic> {
    // Scoring algorithm: prioritize high SEO value and engagement potential
    const scored = topics.map(topic => {
      let score = 0;

      // SEO value weight
      if (topic.seoValue === 'high') score += 10;
      else if (topic.seoValue === 'medium') score += 5;

      // Keyword count (more specific keywords = better)
      score += topic.keywords.length * 2;

      // Tone preference (enthusiastic and casual tend to perform better)
      if (topic.tone === 'enthusiastic') score += 3;
      else if (topic.tone === 'casual') score += 2;

      // Length preference (medium-length posts tend to perform best)
      if (topic.length === 'medium') score += 5;
      else if (topic.length === 'long') score += 3;

      return { topic, score };
    });

    scored.sort((a, b) => b.score - a.score);

    if (scored.length === 0 || !scored[0]) {
      // Fallback topic if no topics generated
      return {
        title: 'Exploring the World of AI-Powered Solo RPG Gaming',
        keywords: ['solo rpg', 'ai game master', 'tabletop rpg'],
        tone: 'enthusiastic',
        length: 'medium',
        rationale: 'Fallback topic - no topics generated',
        targetAudience: 'RPG enthusiasts',
        seoValue: 'medium',
      };
    }

    return scored[0]!.topic;
  }

  private parseTopicIdeas(text: string): BlogTopic[] {
    try {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.topics || [];
    } catch (error) {
      // ⚡ Bolt: Replaced console.error with structured logger and included raw text for debugging.
      logger.error({ msg: '[BlogIdeation] Failed to parse AI response', error, text });
      // Return a fallback topic if parsing fails
      return [{
        title: 'Exploring the Future of Solo RPG Gaming',
        keywords: ['solo rpg', 'ai game master', 'tabletop rpg'],
        tone: 'enthusiastic',
        length: 'medium',
        rationale: 'Fallback topic due to parsing error',
        targetAudience: 'RPG enthusiasts',
        seoValue: 'medium',
      }];
    }
  }
}

// Singleton instance
export const blogIdeation = new BlogIdeation();
