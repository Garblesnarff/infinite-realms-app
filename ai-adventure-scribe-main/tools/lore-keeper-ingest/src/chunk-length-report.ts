/* eslint-disable no-console */

import { join, resolve } from 'path';

import { chunkCampaignFiles } from './chunker.js';
import { listCampaignDirectories, readCampaignFiles, dirToSlug } from './parser.js';

import type { CampaignChunk } from './types.js';

export interface ShortChunk {
  campaignId: string;
  entityName: string;
  chunkLength: number;
  sourceLength: number;
  dropPercent: number;
  lostLength: number;
}

export interface BibleScanResult {
  flagged: ShortChunk[];
  mechanicChunks: number;
  unmatched: number;
  unmatchedNames: string[];
}

function normalizeContent(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function extractSection(content: string, headerName: string): string | undefined {
  const patterns = [
    new RegExp(`##\\s*\\d*\\.?\\s*${headerName}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i'),
    new RegExp(`###\\s*${headerName}[^\\n]*\\n([\\s\\S]*?)(?=\\n###|\\n##|$)`, 'i'),
    new RegExp(
      `##\\s*Section\\s*\\d+:?\\s*[^\\n]*${headerName}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
      'i',
    ),
    new RegExp(`\\*\\*${headerName}[^*]*\\*\\*:?\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*|\\n##|$)`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) return match[1];
  }

  return undefined;
}

function getMechanicsSection(bible: string): string | undefined {
  return extractSection(bible, 'Mechanic') ?? extractSection(bible, 'Unique Mechanic');
}

export function scanBible(bible: string, campaignId: string, threshold = 0.3): BibleScanResult {
  const { chunks } = chunkCampaignFiles(campaignId, { campaignBible: bible });
  const mechanicChunks = chunks.filter((chunk: CampaignChunk) => chunk.chunkType === 'mechanic');

  const mechanicsSection = getMechanicsSection(bible);
  const sectionLines = mechanicsSection ? mechanicsSection.split('\n') : [];

  let unmatched = 0;
  const unmatchedNames: string[] = [];
  const flagged: ShortChunk[] = [];

  for (const chunk of mechanicChunks) {
    const name = chunk.entityName ?? '';

    let headingIndex = -1;
    let isNumbered = false;
    for (let i = 0; i < sectionLines.length; i++) {
      const line = sectionLines[i];

      const h3Match = line.match(/^###\s+(.+?)\s*$/);
      if (h3Match) {
        // `### 1. **Name**` headings carry a list number the chunker skips.
        const headingText = h3Match[1].replace(/^\d+\.\s*/, '');
        const boldMatch = headingText.match(/^\*\*(.+?)\*\*$/);
        const headingName = boldMatch
          ? boldMatch[1].trim()
          : headingText.replace(/\*\*/g, '').trim();
        if (headingName === name) {
          headingIndex = i;
          isNumbered = false;
          break;
        }
      }

      const numMatch = line.match(/^\d+\.\s*\*\*(.+?)\*\*/);
      if (numMatch && numMatch[1].trim() === name) {
        headingIndex = i;
        isNumbered = true;
        break;
      }
    }

    if (headingIndex === -1) {
      unmatched += 1;
      unmatchedNames.push(name);
      continue;
    }

    let end = sectionLines.length;
    for (let j = headingIndex + 1; j < sectionLines.length; j++) {
      const line = sectionLines[j];
      if (isNumbered) {
        if (/^\d+\.\s*\*\*/.test(line) || /^#{1,3}\s/.test(line)) {
          end = j;
          break;
        }
      } else if (/^#{1,3}\s/.test(line)) {
        end = j;
        break;
      }
    }

    const rawBody = sectionLines.slice(headingIndex + 1, end).join('\n');
    const sourceLength = normalizeContent(rawBody).length;

    const prefix = `**${name}**\n\n`;
    let chunkBody = chunk.content;
    if (chunkBody.startsWith(prefix)) {
      chunkBody = chunkBody.slice(prefix.length);
    }
    const chunkLength = normalizeContent(chunkBody).length;

    if (sourceLength > 0 && chunkLength < sourceLength * (1 - threshold)) {
      const dropPercent = Math.round(100 * (1 - chunkLength / sourceLength));
      const allContents = mechanicChunks.map((c: CampaignChunk) => c.content);
      let lostLength = 0;
      for (const line of rawBody.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const stripped = trimmed.replace(/^\d+\.\s*/, '').trim();
        const found = allContents.some(
          (content: string) => content.includes(trimmed) || content.includes(stripped),
        );
        if (!found) lostLength += trimmed.length;
      }
      flagged.push({
        campaignId: chunk.campaignId,
        entityName: name,
        chunkLength,
        sourceLength,
        dropPercent,
        lostLength,
      });
    }
  }

  return { flagged, mechanicChunks: mechanicChunks.length, unmatched, unmatchedNames };
}

export function findShortMechanicChunks(
  bible: string,
  campaignId: string,
  threshold = 0.3,
): ShortChunk[] {
  return scanBible(bible, campaignId, threshold).flagged;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let repoPath = resolve(process.cwd(), '../infinite-realms-clean');
  let threshold = 0.3;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo-path') {
      repoPath = resolve(argv[++i]);
    } else if (argv[i] === '--threshold') {
      threshold = parseFloat(argv[++i]);
    }
  }

  const dirs = listCampaignDirectories(repoPath);

  let biblesScanned = 0;
  let mechanicChunks = 0;
  let unmatched = 0;
  const flaggedAll: ShortChunk[] = [];
  const unmatchedAll: { slug: string; name: string }[] = [];

  for (const dir of dirs) {
    const files = readCampaignFiles(join(repoPath, 'campaign-ideas', dir));
    if (!files.campaignBible) continue;
    biblesScanned += 1;
    const result = scanBible(files.campaignBible, dir, threshold);
    mechanicChunks += result.mechanicChunks;
    unmatched += result.unmatched;
    flaggedAll.push(...result.flagged);
    for (const name of result.unmatchedNames) {
      unmatchedAll.push({ slug: dirToSlug(dir), name });
    }
  }

  flaggedAll.sort((a, b) => b.dropPercent - a.dropPercent);

  const totalLost = flaggedAll.reduce((sum, item) => sum + item.lostLength, 0);

  console.log('# Lore Keeper Chunk Length Report');
  console.log('');
  console.log(`Bibles scanned: ${biblesScanned}`);
  console.log(`Mechanic chunks: ${mechanicChunks}`);
  console.log(`Unmatched: ${unmatched}`);
  console.log(`Flagged: ${flaggedAll.length}`);
  console.log(`Source chars in no mechanic chunk: ${totalLost}`);
  console.log('');
  console.log('| campaign | mechanic | chunk chars | source chars | drop | chars in no chunk |');
  console.log('|---|---|---|---|---|---|');
  for (const item of flaggedAll) {
    console.log(
      `| ${dirToSlug(item.campaignId)} | ${item.entityName} | ${item.chunkLength} | ${item.sourceLength} | ${item.dropPercent}% | ${item.lostLength} |`,
    );
  }
  console.log('');
  console.log('Unmatched mechanic chunks');
  if (unmatchedAll.length === 0) {
    console.log('none');
  } else {
    for (const item of unmatchedAll) {
      console.log(`- ${item.slug}: ${item.name}`);
    }
  }

  process.exitCode = 0;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'report failed';
    console.error(message);
    process.exitCode = 1;
  });
}
