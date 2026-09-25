/**
 * Plain-text preview of a starter campaign overview.
 * The stored overview is Markdown. The detail page used to print the marks.
 */
export function previewCampaignOverview(overview: string, limit = 800): string {
  const firstSection = overview.split(/\n##/)[0] ?? '';
  const plain = firstSection
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, '$1$2')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^---+$/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (plain.length <= limit) return plain;
  return `${plain.slice(0, limit).trim()}...`;
}
