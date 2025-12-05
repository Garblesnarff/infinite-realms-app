/**
 * Markdown parsing logic for campaign files
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { CampaignFiles, ParsedCampaign, Difficulty } from './types.js';

/**
 * Read all campaign files from a directory
 */
export function readCampaignFiles(campaignPath: string): CampaignFiles {
  const files: CampaignFiles = {};

  const tryReadFile = (filename: string): string | undefined => {
    const filePath = join(campaignPath, filename);
    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf-8');
    }
    return undefined;
  };

  files.creativeBrief = tryReadFile('creative_brief.md');
  files.worldBuildingSpec = tryReadFile('world_building_spec.md');
  files.overview = tryReadFile('overview.md');
  files.campaignBible = tryReadFile('campaign_bible.md');

  return files;
}

/**
 * List all campaign directories in the repo
 */
export function listCampaignDirectories(repoPath: string): string[] {
  const campaignsPath = join(repoPath, 'campaign-ideas');

  if (!existsSync(campaignsPath)) {
    throw new Error(`Campaign ideas directory not found: ${campaignsPath}`);
  }

  return readdirSync(campaignsPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .sort();
}

/**
 * Convert directory name to slug
 */
export function dirToSlug(dirName: string): string {
  return dirName.toLowerCase().replace(/_/g, '-');
}

/**
 * Convert directory name to title
 */
export function dirToTitle(dirName: string): string {
  return dirName
    .split('_')
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

  return {
    id: campaignId,
    slug: dirToSlug(campaignId),
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
