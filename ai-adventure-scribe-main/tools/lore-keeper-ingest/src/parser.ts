/**
 * Markdown parsing logic for campaign files
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { CampaignFiles, ParsedCampaign, Difficulty } from './types.js';

/**
 * Read all campaign files from a directory
 * Handles both underscore and hyphen naming conventions, and various file name patterns
 */
export function readCampaignFiles(campaignPath: string): CampaignFiles {
  const files: CampaignFiles = {};

  // Get the campaign directory name for pattern matching
  const dirName = campaignPath.split('/').pop() || '';

  const tryReadFile = (...filenames: string[]): string | undefined => {
    for (const filename of filenames) {
      const filePath = join(campaignPath, filename);
      if (existsSync(filePath)) {
        return readFileSync(filePath, 'utf-8');
      }
    }
    return undefined;
  };

  // Try multiple naming conventions
  files.creativeBrief = tryReadFile('creative_brief.md', 'creative-brief.md');
  files.worldBuildingSpec = tryReadFile('world_building_spec.md', 'world-building-spec.md');

  // Overview might be named overview.md or {campaign-name}.md (without -campaign-bible suffix)
  files.overview = tryReadFile(
    'overview.md',
    `${dirName}.md`,
    // Strip common suffixes from dirName if present
    dirName.replace(/-campaign$/, '') + '.md'
  );

  // Campaign bible might be campaign_bible.md or {campaign-name}-campaign-bible.md
  files.campaignBible = tryReadFile(
    'campaign_bible.md',
    'campaign-bible.md',
    `${dirName}-campaign-bible.md`
  );

  return files;
}

/**
 * List all campaign directories in the repo
 * Searches recursively for directories containing campaign files
 */
export function listCampaignDirectories(repoPath: string): string[] {
  const campaignsPath = join(repoPath, 'campaign-ideas');

  if (!existsSync(campaignsPath)) {
    throw new Error(`Campaign ideas directory not found: ${campaignsPath}`);
  }

  const campaigns: string[] = [];

  // Recursively find campaign directories
  const findCampaigns = (dir: string, relativePath: string = ''): void => {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = join(dir, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        // Check if this directory contains campaign files
        const hasOverview = existsSync(join(fullPath, 'overview.md')) ||
          existsSync(join(fullPath, `${entry.name}.md`)) ||
          existsSync(join(fullPath, `${entry.name}-campaign-bible.md`));
        const hasCreativeBrief = existsSync(join(fullPath, 'creative_brief.md')) ||
          existsSync(join(fullPath, 'creative-brief.md'));

        if (hasOverview || hasCreativeBrief) {
          campaigns.push(relPath);
        } else {
          // Recurse into subdirectories
          findCampaigns(fullPath, relPath);
        }
      }
    }
  };

  findCampaigns(campaignsPath);
  return campaigns.sort();
}

/**
 * Convert directory name to slug
 * Handles nested paths like "Completed/Horror/abyssal-descent" by using only the last part
 */
export function dirToSlug(dirName: string): string {
  const lastPart = dirName.split('/').pop() || dirName;
  return lastPart.toLowerCase().replace(/_/g, '-');
}

/**
 * Convert directory name to title
 * Handles nested paths and converts to title case
 */
export function dirToTitle(dirName: string): string {
  const lastPart = dirName.split('/').pop() || dirName;
  return lastPart
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Parse difficulty from text
 */
export function parseDifficulty(text: string): Difficulty {
  const lower = text.toLowerCase();

  if (lower.includes('deadly')) return 'deadly';
  if (lower.includes('hard')) return 'hard';
  if (lower.includes('medium-hard')) return 'medium-hard';
  if (lower.includes('low-medium')) return 'low-medium';
  if (lower.includes('medium')) return 'medium';
  if (lower.includes('easy')) return 'easy';

  return 'medium'; // default
}

/**
 * Extract metadata from overview.md
 */
export function parseOverview(content: string, campaignId: string): ParsedCampaign {
  const lines = content.split('\n');

  // Extract title from first H1
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : dirToTitle(campaignId);

  // Extract campaign type/genre
  const genreMatch = content.match(/\*\*Campaign Type \/ Genre:\*\*\s*(.+)/i) ||
                     content.match(/Campaign Type:\s*(.+)/i);
  const genreRaw = genreMatch ? genreMatch[1].trim() : '';
  const genre = genreRaw.split(/[\/,]/).map(g => g.trim().toLowerCase()).filter(Boolean);

  // Extract tone keywords
  const toneMatch = content.match(/\*\*Tone.*?:\*\*\s*(.+)/i) ||
                    content.match(/Tone:\s*(.+)/i);
  const toneRaw = toneMatch ? toneMatch[1].trim() : '';
  const tone = toneRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);

  // Extract difficulty
  const difficultyMatch = content.match(/difficulty/i);
  let difficulty: Difficulty = 'medium';
  if (difficultyMatch) {
    const diffLine = lines.find(l => l.toLowerCase().includes('difficulty'));
    if (diffLine) {
      difficulty = parseDifficulty(diffLine);
    }
  }

  // Extract level range
  const levelMatch = content.match(/\*\*Player Level Range:\*\*\s*Start\s*\*\*(\d+)\*\*.*?Finish\s*\*\*(\d+[-–]?\d*)\*\*/i) ||
                     content.match(/Level.*?(\d+).*?(\d+)/i);
  const levelRange = levelMatch ? `${levelMatch[1]}-${levelMatch[2].replace('–', '-')}` : undefined;

  // Extract estimated sessions
  const sessionsMatch = content.match(/(\d+[-–]\d+)\s*sessions/i) ||
                        content.match(/Estimated Length:.*?(\d+[-–]\d+)/i);
  const estimatedSessions = sessionsMatch ? sessionsMatch[1].replace('–', '-') : undefined;

  // Extract premise/core concept
  const premiseMatch = content.match(/\*\*Core Premise.*?:\*\*\s*([\s\S]*?)(?=\n\n---|\n\n##|\n\n\*\*)/i);
  let premise = premiseMatch ? premiseMatch[1].trim() : '';

  // Fallback: get first paragraph after main headers
  if (!premise) {
    const paragraphs = content.split(/\n\n/).filter(p =>
      !p.startsWith('#') &&
      !p.startsWith('*') &&
      !p.startsWith('-') &&
      p.length > 50
    );
    premise = paragraphs[0]?.trim() || `A ${genre.join(', ')} campaign.`;
  }

  // Clean up premise (remove markdown)
  premise = premise
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\n/g, ' ')
    .trim();

  // Truncate if too long
  if (premise.length > 500) {
    premise = premise.substring(0, 497) + '...';
  }

  // Use just the last part of the path for id and slug
  const campaignDirName = campaignId.split('/').pop() || campaignId;

  return {
    id: campaignDirName,
    slug: dirToSlug(campaignDirName),
    title,
    genre: genre.length > 0 ? genre : ['fantasy'],
    tone: tone.length > 0 ? tone : ['adventure'],
    difficulty,
    levelRange,
    estimatedSessions,
    premise,
  };
}

/**
 * Extract tagline from creative brief or overview
 */
export function extractTagline(creativeBrief?: string, overview?: string): string | undefined {
  // Try to find a short hook in creative brief
  if (creativeBrief) {
    const hookMatch = creativeBrief.match(/^##?\s*Creative Brief:?\s*(.+)$/m);
    if (hookMatch && hookMatch[1].length < 100) {
      return hookMatch[1].trim();
    }
  }

  // Try to extract from title line in overview
  if (overview) {
    const titleMatch = overview.match(/^#\s+(.+)\n\n\*(.+)\*/m);
    if (titleMatch && titleMatch[2].length < 100) {
      return titleMatch[2].trim();
    }
  }

  return undefined;
}

/**
 * Check if a campaign has all required files for "complete" status
 */
export function isCampaignComplete(files: CampaignFiles): boolean {
  return !!(
    files.overview &&
    files.creativeBrief &&
    files.worldBuildingSpec &&
    files.campaignBible
  );
}
