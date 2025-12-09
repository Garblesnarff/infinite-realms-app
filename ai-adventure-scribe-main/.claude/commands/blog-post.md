# /blog-post - Create AI-Generated Blog Post

Create and publish an AI-generated blog post for Infinite Realms.

## Usage

```bash
/blog-post <topic> [options]
```

## Parameters

- `<topic>` (required): The blog post topic/title
- `--keywords <keywords>`: Comma-separated list of target keywords for SEO
- `--tone <tone>`: Writing tone (professional|casual|enthusiastic|technical) [default: enthusiastic]
- `--length <length>`: Post length (short|medium|long) [default: medium]
- `--status <status>`: Post status (draft|review|scheduled|published) [default: published]
- `--publish-at <datetime>`: Schedule publish time (ISO 8601 format)
- `--categories <categories>`: Comma-separated category names
- `--tags <tags>`: Comma-separated tag names

## Examples

```bash
# Simple blog post
/blog-post "How AI is Revolutionizing Solo RPG Gaming"

# SEO-optimized post with keywords
/blog-post "Best Solo D&D Alternatives in 2025" --keywords "solo d&d,ai dungeon master,solo rpg games" --tone professional

# Technical deep-dive
/blog-post "Building an AI-Powered Game Master" --tone technical --length long --tags "technical,ai,game-design"

# Scheduled post for future publishing
/blog-post "New Character Creation Features" --status scheduled --publish-at "2025-12-10T12:00:00Z"

# Create draft for review
/blog-post "Community Spotlight: Amazing Campaigns" --status review --categories "community,spotlight"
```

## Instructions for Claude Code

When this command is invoked, you should:

1. **Extract Parameters**: Parse the topic and any optional parameters from the command
2. **Generate Content**: Use the blog content generator API to create the post:
   - Call `blogContentGenerator.generateBlogPost()` with the topic and options
   - For SEO-focused posts with keywords, use `blogContentGenerator.generateSeoPost()`
3. **Create Database Entry**: Insert the post into the blog database via the internal API
4. **Handle Publishing**:
   - Default status is "published" (immediate)
   - If `--status scheduled` is provided, create a scheduled post
   - If `--status review`, create for human review
   - If `--status draft`, save as draft
5. **Provide Feedback**: Return the post URL and confirmation

### API Endpoints to Use

```typescript
// Generate content
import { blogContentGenerator } from './server/src/services/blog-content-generator.js';

// Option 1: General blog post
const content = await blogContentGenerator.generateBlogPost(topic, {
  keywords: ['keyword1', 'keyword2'],
  tone: 'enthusiastic',
  length: 'medium',
  targetAudience: 'RPG enthusiasts and solo gamers'
});

// Option 2: SEO-optimized post
const content = await blogContentGenerator.generateSeoPost(topic, keywords);

// Create post via internal API (requires API key from environment)
const apiKey = process.env.BLOG_API_KEY;
const response = await fetch('http://localhost:8888/internal/create-blog-post', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  },
  body: JSON.stringify({
    title: content.title,
    content: content.content,
    summary: content.summary,
    seoTitle: content.seoTitle,
    seoDescription: content.seoDescription,
    status: 'published', // or 'scheduled', 'review', 'draft'
    publishedAt: new Date().toISOString(), // or future date for scheduled
    categories: ['category-slug'],
    tags: content.suggestedTags,
  })
});
```

### Workflow Example

```typescript
// Example implementation
async function handleBlogPostCommand(args: string[]) {
  // 1. Parse arguments
  const topic = args[0];
  const options = parseOptions(args.slice(1));

  // 2. Generate content
  const content = await blogContentGenerator.generateBlogPost(topic, {
    keywords: options.keywords?.split(',') || [],
    tone: options.tone || 'enthusiastic',
    length: options.length || 'medium',
  });

  // 3. Create post
  const status = options.status || 'published';
  const publishedAt = options.publishAt || new Date().toISOString();

  // 4. Call internal API or directly insert to database
  // ... implementation here

  // 5. Return success message
  console.log(`✅ Blog post created: /blog/${slug}`);
  console.log(`Status: ${status}`);
  console.log(`Title: ${content.title}`);
}
```

### Important Notes

- **API Authentication**: Ensure the `BLOG_API_KEY` environment variable is set
- **Author Attribution**: Posts will be attributed to the system author (BLOG_SYSTEM_AUTHOR_ID)
- **SEO Best Practices**: The content generator already includes E-E-A-T principles and semantic SEO
- **Validation**: Ensure the topic is meaningful and not empty
- **Error Handling**: Gracefully handle API failures and provide clear error messages

### Post-Creation Tasks

After creating the post:
1. Verify the post appears at the returned URL
2. Check that SEO metadata is properly set
3. Ensure categories and tags are linked correctly
4. If status is 'scheduled', confirm the BlogScheduler will publish it

## Expected Output

```
🎉 Blog post successfully created!

Title: How AI is Revolutionizing Solo RPG Gaming
Status: published
URL: https://blog.infiniterealms.app/how-ai-is-revolutionizing-solo-rpg-gaming

SEO Title: How AI is Revolutionizing Solo RPG Gaming
Categories: AI, Gaming
Tags: ai-dungeon-master, solo-rpg, innovation

The post is now live and ready to share!
```
