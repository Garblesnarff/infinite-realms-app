/**
 * Plain-text preview of a starter campaign overview.
 * The stored overview is Markdown. The detail page used to print the marks.
 *
 * Uses the first section that has prose. An overview that opens with only its title
 * ("# The Eternal Feast" then "## Campaign Overview") used to preview as the bare title
 * (#2281). Returns '' when no section has prose, so the page can hide "What Awaits You".
 */
export function previewCampaignOverview(overview: string, limit = 800): string {
  const sections = overview.split(/\n(?=##)/);
  const [first = '', ...rest] = sections;

  let plain = toPlainText(first);
  if (!hasProse(first)) {
    const next = rest.find(hasProse);
    // A later section's own heading ("Campaign Overview") is not part of the preview.
    plain = next ? toPlainText(withoutHeadings(next)) : '';
  }

  if (plain.length <= limit) return plain;
  return `${plain.slice(0, limit).trim()}...`;
}

function withoutHeadings(section: string): string {
  return section.replace(/^#{1,6}\s+.*$/gm, '');
}

function hasProse(section: string): boolean {
  return toPlainText(withoutHeadings(section)).length > 0;
}

function toPlainText(section: string): string {
  return section
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, '$1$2')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^---+$/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
