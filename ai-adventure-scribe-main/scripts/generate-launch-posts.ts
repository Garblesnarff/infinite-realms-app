#!/usr/bin/env bun
/**
 * Generate Launch Blog Posts for InfiniteRealms
 *
 * Uses Kimi K2 (via OpenRouter) to generate launch-related blog posts.
 * Run with: bun scripts/generate-launch-posts.ts
 */

import OpenAI from 'openai';
import postgres from 'postgres';

// Load environment variables (Bun loads .env automatically)
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:***REMOVED***@localhost:54321/postgres';
const BLOG_SYSTEM_AUTHOR_ID = process.env.BLOG_SYSTEM_AUTHOR_ID || '79c3ff02-9088-495b-aad3-60dfb09c943b';

if (!OPENROUTER_API_KEY) {
  console.error('❌ OPENROUTER_API_KEY not set');
  process.exit(1);
}

// Initialize OpenRouter client
const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': 'https://infiniterealms.app',
    'X-Title': 'Infinite Realms Blog',
  },
});

// Initialize database
const sql = postgres(DATABASE_URL);

interface GeneratedContent {
  title: string;
  content: string;
  summary: string;
  seoTitle: string;
  seoDescription: string;
  suggestedTags: string[];
}

function createSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseJsonResponse(text: string, fallbackTitle: string): GeneratedContent {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      title: parsed.title || fallbackTitle,
      content: parsed.content || '',
      summary: parsed.summary || '',
      seoTitle: parsed.seoTitle || parsed.title || '',
      seoDescription: parsed.seoDescription || parsed.summary?.slice(0, 150) || '',
      suggestedTags: parsed.suggestedTags || [],
    };
  } catch {
    return {
      title: fallbackTitle,
      content: text,
      summary: text.slice(0, 200),
      seoTitle: fallbackTitle,
      seoDescription: text.slice(0, 150),
      suggestedTags: [],
    };
  }
}

async function generatePost(topic: string, type: 'launch' | 'feature' | 'guide'): Promise<GeneratedContent> {
  const prompts = {
    launch: `You are writing a launch announcement blog post for Infinite Realms, an AI-powered solo fantasy RPG platform.

Topic: "${topic}"

Infinite Realms is a browser-based solo RPG where an AI Dungeon Master guides players through persistent fantasy worlds. Key features:
- AI-powered narrative storytelling
- D&D 5E rule integration
- Character creation with full class/race options
- Combat system with initiative tracking
- Persistent world memory
- Campaign management

Write an exciting, engaging launch announcement (800-1200 words) that:
1. Opens with a compelling hook about the problem of finding D&D groups
2. Introduces Infinite Realms as the solution
3. Highlights 3-5 key features with vivid descriptions
4. Creates urgency and excitement
5. Ends with a clear call-to-action

Tone: Enthusiastic, welcoming, professional but accessible.

Format your response as JSON:
{
  "title": "Compelling title (50-60 chars)",
  "content": "Full markdown post",
  "summary": "2-3 sentence teaser",
  "seoTitle": "SEO title (50-60 chars)",
  "seoDescription": "Meta description (150-160 chars)",
  "suggestedTags": ["launch", "announcement", "ai-dm", "solo-rpg"]
}`,

    feature: `You are writing a feature showcase blog post for Infinite Realms, an AI-powered solo fantasy RPG platform.

Topic: "${topic}"

Write an in-depth feature showcase (800-1200 words) that:
1. Explains what the feature is and why it matters
2. Shows concrete examples of how it works
3. Compares to traditional tabletop RPG experiences
4. Includes tips for getting the most out of it
5. Mentions related features players might enjoy

Tone: Technical but accessible, enthusiastic about gaming.

Format your response as JSON:
{
  "title": "Feature-focused title (50-60 chars)",
  "content": "Full markdown post",
  "summary": "2-3 sentence teaser",
  "seoTitle": "SEO title (50-60 chars)",
  "seoDescription": "Meta description (150-160 chars)",
  "suggestedTags": ["feature", "ai-dm", "gameplay"]
}`,

    guide: `You are writing a getting started guide for Infinite Realms, an AI-powered solo fantasy RPG platform.

Topic: "${topic}"

Write a friendly, helpful guide (800-1200 words) that:
1. Welcomes new players warmly
2. Walks through the first steps (account, character creation)
3. Explains how to interact with the AI DM
4. Gives tips for having a great first session
5. Points to resources for learning more

Tone: Helpful, encouraging, like a friend introducing you to a hobby.

Format your response as JSON:
{
  "title": "Guide title (50-60 chars)",
  "content": "Full markdown post",
  "summary": "2-3 sentence teaser",
  "seoTitle": "SEO title (50-60 chars)",
  "seoDescription": "Meta description (150-160 chars)",
  "suggestedTags": ["guide", "getting-started", "tutorial"]
}`,
  };

  console.log(`📝 Generating ${type} post: "${topic}"...`);

  const response = await client.chat.completions.create({
    model: 'moonshotai/kimi-k2-0905',
    max_tokens: 4000,
    temperature: 0.8,
    messages: [{ role: 'user', content: prompts[type] }],
  });

  const text = response.choices[0]?.message?.content || '';
  return parseJsonResponse(text, topic);
}

async function savePost(content: GeneratedContent, status: 'draft' | 'review' | 'published' = 'review'): Promise<string> {
  const slug = createSlug(content.title);

  // Check if slug already exists
  const existing = await sql`SELECT id FROM blog_posts WHERE slug = ${slug}`;
  if (existing.length > 0) {
    console.log(`⚠️  Post with slug "${slug}" already exists, skipping`);
    return existing[0].id;
  }

  // Build the insert query dynamically based on status
  const [post] = status === 'published'
    ? await sql`
        INSERT INTO blog_posts (
          title, slug, content, summary,
          seo_title, seo_description,
          author_id, status, published_at,
          created_at, updated_at
        ) VALUES (
          ${content.title}, ${slug}, ${content.content}, ${content.summary},
          ${content.seoTitle}, ${content.seoDescription},
          ${BLOG_SYSTEM_AUTHOR_ID}, ${status}, NOW(),
          NOW(), NOW()
        )
        RETURNING id, slug
      `
    : await sql`
        INSERT INTO blog_posts (
          title, slug, content, summary,
          seo_title, seo_description,
          author_id, status,
          created_at, updated_at
        ) VALUES (
          ${content.title}, ${slug}, ${content.content}, ${content.summary},
          ${content.seoTitle}, ${content.seoDescription},
          ${BLOG_SYSTEM_AUTHOR_ID}, ${status},
          NOW(), NOW()
        )
        RETURNING id, slug
      `;

  console.log(`✅ Created post: ${content.title} (status: ${status})`);
  console.log(`   URL: https://blog.infiniterealms.app/${slug}`);

  return post.id;
}

async function main() {
  console.log('🚀 Generating Launch Blog Posts for InfiniteRealms\n');
  console.log('Using Kimi K2 via OpenRouter...\n');

  const posts = [
    { topic: 'Introducing Infinite Realms: Your AI Dungeon Master Awaits', type: 'launch' as const },
    { topic: 'How Our AI Dungeon Master Creates Immersive Solo Adventures', type: 'feature' as const },
    { topic: 'Getting Started with Infinite Realms: Your First Solo Adventure', type: 'guide' as const },
  ];

  const results: { title: string; slug: string; status: string }[] = [];

  for (const { topic, type } of posts) {
    try {
      const content = await generatePost(topic, type);
      const postId = await savePost(content, 'review');
      results.push({
        title: content.title,
        slug: createSlug(content.title),
        status: 'review'
      });
      console.log('');
    } catch (error) {
      console.error(`❌ Error generating "${topic}":`, error);
    }
  }

  console.log('\n📊 Summary:');
  console.log('=' .repeat(60));
  for (const { title, slug, status } of results) {
    console.log(`- ${title}`);
    console.log(`  Status: ${status} | URL: https://blog.infiniterealms.app/${slug}`);
  }
  console.log('\n💡 Posts created with status "review" - visit admin to publish:');
  console.log('   https://infiniterealms.app/admin/blog');

  await sql.end();
  process.exit(0);
}

main().catch(console.error);
