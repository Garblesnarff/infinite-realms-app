import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const sourceRoot = join(process.cwd(), 'src');
const lowLevelFetchFiles = new Set([
  'infrastructure/api/rest-client.ts',
  'infrastructure/api/fetch-with-timeout.ts',
]);
const publicFetchFiles = new Set([
  'main.tsx',
  'pages/CampaignDetailPage.tsx',
  'components/launch/WaitlistForm.tsx',
  'pages/BlogAdminLogin.tsx',
  'services/blog/blog-media-service.ts',
  'services/character-background-generator.ts',
  'services/scene-image-generator.ts',
  'components/character-creation/steps/character-finalization/use-character-finalization.ts',
  'hooks/use-stale-client-check.ts',
  'landing-client.ts',
  'utils/spell-validation/utils.ts',
]);

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('authenticated fetch boundary', () => {
  it('does not allow API calls with hand-built auth headers outside the shared wrapper', () => {
    const violations = sourceFiles(sourceRoot)
      .map((file) => ({ file, relativePath: relative(sourceRoot, file).replace(/\\/g, '/') }))
      .filter(({ relativePath }) => !relativePath.includes('__tests__/'))
      .filter(({ relativePath }) => !lowLevelFetchFiles.has(relativePath))
      .filter(({ relativePath }) => !publicFetchFiles.has(relativePath))
      .filter(({ file }) => {
        const source = readFileSync(file, 'utf8');
        return (
          /\bfetch\s*\(/.test(source) &&
          /(Authorization|Bearer|API_BASE_URL|VITE_API_URL|\/v1\/|\/api\/trpc)/.test(source) &&
          !source.includes('fetchWithAuth')
        );
      })
      .map(({ relativePath }) => relativePath);

    expect(violations).toEqual([]);
  });
});
