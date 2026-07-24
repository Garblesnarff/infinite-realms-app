import { parseMessageOptions } from '@/utils/parseMessageOptions';

export function extractHeadlessOptions(text: string, structured: readonly unknown[] = []): string[] {
  const structuredOptions = structured.flatMap((option) => {
    if (typeof option === 'string' && option.trim()) return [option.trim()];
    if (typeof option !== 'object' || option === null) return [];
    const candidate = (option as { text?: unknown; fullText?: unknown }).text
      ?? (option as { fullText?: unknown }).fullText;
    return typeof candidate === 'string' && candidate.trim() ? [candidate.trim()] : [];
  });
  if (structuredOptions.length) return structuredOptions;
  return parseMessageOptions(text).options.map((option) => option.text);
}
