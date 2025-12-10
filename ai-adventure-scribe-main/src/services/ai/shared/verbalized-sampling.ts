/**
 * Verbalized Sampling Parser
 *
 * Robust multi-strategy parser for verbalized sampling responses.
 * Based on Stanford/Northeastern research: https://arxiv.org/abs/2510.01171
 *
 * The parser tries multiple strategies to extract probability-weighted responses,
 * with a safe fallback that prevents duplicate content from leaking through.
 *
 * @module verbalized-sampling
 */

import logger from '@/lib/logger';

interface ParsedResponse {
  probability: number;
  text: string;
}

interface ParseResult {
  text: string;
  probability: number;
  parseMethod: string;
}

/**
 * Parse verbalized sampling response using multiple strategies.
 * Falls back safely to first section only (never returns all content).
 */
export function parseVerbalizedResponse(rawResponse: string): ParseResult {
  // Strategy 1: Strict XML format
  // <response><probability>0.5</probability><text>Content</text></response>
  const xmlResult = parseXmlFormat(rawResponse);
  if (xmlResult.length > 0) {
    logger.info(`[Verbalized Sampling] Found ${xmlResult.length} XML-formatted responses`);
    return sampleByProbability(xmlResult, 'xml');
  }

  // Strategy 2: Markdown numbered list with probabilities
  // "1. (0.5) Scene content..." or "1. **Option** (prob: 0.5): Content"
  const markdownResult = parseMarkdownFormat(rawResponse);
  if (markdownResult.length > 0) {
    logger.info(`[Verbalized Sampling] Found ${markdownResult.length} markdown-formatted responses`);
    return sampleByProbability(markdownResult, 'markdown');
  }

  // Strategy 3: Look for probability markers anywhere
  // "probability: 0.5" or "(prob: 0.5)" followed by content
  const looseResult = parseLooseFormat(rawResponse);
  if (looseResult.length > 0) {
    logger.info(`[Verbalized Sampling] Found ${looseResult.length} loose-formatted responses`);
    return sampleByProbability(looseResult, 'loose');
  }

  // SAFE FALLBACK: Take ONLY the first substantial section
  // This prevents duplicate content from leaking through when parsing fails
  logger.warn('[Verbalized Sampling] No valid format found, using safe fallback');
  return {
    text: extractFirstSection(rawResponse),
    probability: 1.0,
    parseMethod: 'fallback-first-section',
  };
}

/**
 * Parse strict XML format responses
 */
function parseXmlFormat(text: string): ParsedResponse[] {
  const results: ParsedResponse[] = [];
  const pattern =
    /<response>\s*<probability>([\d.]+)<\/probability>\s*<text>([\s\S]*?)<\/text>\s*<\/response>/gi;

  let match;
  while ((match = pattern.exec(text)) !== null) {
    const probability = parseFloat(match[1]);
    const content = match[2].trim();
    if (!isNaN(probability) && content && content.length > 50) {
      results.push({ probability, text: content });
    }
  }

  return results;
}

/**
 * Parse markdown numbered list format
 * Handles: "1. (0.5) Content" or "1. **Title** (prob: 0.5): Content"
 */
function parseMarkdownFormat(text: string): ParsedResponse[] {
  const results: ParsedResponse[] = [];

  // Pattern: Number followed by probability in parentheses
  const pattern = /(?:^|\n)\s*(\d+)\.\s*(?:\*\*[^*]+\*\*\s*)?[\[(](?:prob(?:ability)?:?\s*)?([\d.]+)[\])]\s*:?\s*([\s\S]*?)(?=(?:\n\s*\d+\.\s*(?:\*\*[^*]+\*\*\s*)?[\[(])|$)/gi;

  let match;
  while ((match = pattern.exec(text)) !== null) {
    const probability = parseFloat(match[2]);
    const content = match[3].trim();
    if (!isNaN(probability) && content && content.length > 50) {
      results.push({ probability, text: content });
    }
  }

  return results;
}

/**
 * Parse loose format with probability markers
 * Handles: "probability: 0.5" or "(prob: 0.5)" anywhere in text
 */
function parseLooseFormat(text: string): ParsedResponse[] {
  const results: ParsedResponse[] = [];

  // Look for sections separated by probability markers
  const sections = text.split(/(?:^|\n)(?=.*?(?:probability|prob)[:\s]*[\d.]+)/i);

  for (const section of sections) {
    // Extract probability from this section
    const probMatch = section.match(/(?:probability|prob)[:\s]*([\d.]+)/i);
    if (probMatch) {
      const probability = parseFloat(probMatch[1]);
      // Remove the probability marker from content
      const content = section
        .replace(/(?:probability|prob)[:\s]*[\d.]+/gi, '')
        .replace(/<\/?[a-z]+>/gi, '') // Remove any XML tags
        .trim();

      if (!isNaN(probability) && content && content.length > 50) {
        results.push({ probability, text: content });
      }
    }
  }

  return results;
}

/**
 * Sample from parsed responses based on probability distribution
 */
function sampleByProbability(responses: ParsedResponse[], method: string): ParseResult {
  if (responses.length === 0) {
    return {
      text: '',
      probability: 0,
      parseMethod: `${method}-empty`,
    };
  }

  // Normalize probabilities
  const totalProb = responses.reduce((sum, r) => sum + r.probability, 0);
  const normalized = responses.map((r) => ({
    ...r,
    probability: totalProb > 0 ? r.probability / totalProb : 1 / responses.length,
  }));

  // Random sample based on probability
  const random = Math.random();
  let cumulative = 0;

  for (const response of normalized) {
    cumulative += response.probability;
    if (random <= cumulative) {
      logger.info(
        `[Verbalized Sampling] Selected response with probability ${response.probability.toFixed(2)}`
      );
      return {
        text: validateAndCleanResponse(response.text),
        probability: response.probability,
        parseMethod: method,
      };
    }
  }

  // Fallback to last response
  const last = normalized[normalized.length - 1];
  return {
    text: validateAndCleanResponse(last.text),
    probability: last.probability,
    parseMethod: `${method}-fallback`,
  };
}

/**
 * Extract first substantial section from unstructured response.
 * This is the SAFE FALLBACK - it prevents all variations from being returned.
 */
function extractFirstSection(text: string): string {
  // First, clean any XML-like tags and probability markers
  let cleaned = text
    .replace(/<\/?response>/gi, '')
    .replace(/<probability>[\d.]+<\/probability>/gi, '')
    .replace(/<\/?text>/gi, '')
    .replace(/\(prob(?:ability)?:\s*[\d.]+\)/gi, '')
    .trim();

  // Check if text has multiple complete scenes (indicated by A/B/C options appearing multiple times)
  const optionMatches = cleaned.match(/^[A-C]\.\s+\*\*/gm);
  if (optionMatches && optionMatches.length > 3) {
    // Multiple option sets detected - this is likely multiple scenes combined
    // Split at the first set of options and return that scene
    const firstOptionsIndex = cleaned.search(/^[A-C]\.\s+\*\*/m);
    if (firstOptionsIndex > 100) {
      // Find where the options end (after C. option)
      const afterFirstOptions = cleaned.substring(firstOptionsIndex);
      const cOptionMatch = afterFirstOptions.match(/^C\.\s+\*\*[^]*?(?=\n\n|\n[A-Z]\.\s+\*\*|$)/m);
      if (cOptionMatch) {
        const endOfFirstScene = firstOptionsIndex + cOptionMatch.index! + cOptionMatch[0].length;
        const firstScene = cleaned.substring(0, endOfFirstScene).trim();
        if (firstScene.length > 200) {
          logger.info(
            `[Verbalized Sampling] Extracted first scene (${firstScene.length} chars) from multi-scene response`
          );
          return firstScene;
        }
      }
    }
  }

  // Try splitting by double newlines followed by scene-like content
  const sections = cleaned.split(/\n\s*\n(?=(?:You|The|A |An |In |As ))/);

  if (sections.length > 1) {
    // Find first section that looks like a complete scene
    for (let i = 0; i < Math.min(sections.length, 3); i++) {
      const section = sections[i].trim();
      // A complete scene should have narrative + options, or at least 200 chars
      if (section.length > 200 || section.includes('A. **') || section.includes('1. **')) {
        // Join first few paragraphs up to and including options
        let result = section;

        // If this section doesn't have options, look for them in next section
        if (!result.includes('A. **') && !result.includes('1. **') && i + 1 < sections.length) {
          const nextSection = sections[i + 1].trim();
          if (nextSection.match(/^[A-C1-3]\.\s+\*\*/)) {
            result += '\n\n' + nextSection;
          }
        }

        logger.info(
          `[Verbalized Sampling] Extracted section ${i + 1} (${result.length} chars) as first scene`
        );
        return result;
      }
    }
  }

  // Last resort: return first 2500 chars (approximately one scene)
  // This caps the output to prevent huge duplicated responses
  const maxChars = 2500;
  if (cleaned.length > maxChars) {
    // Try to end at a paragraph boundary
    const truncatePoint = cleaned.lastIndexOf('\n\n', maxChars);
    if (truncatePoint > maxChars * 0.7) {
      logger.info(`[Verbalized Sampling] Truncated at paragraph boundary (${truncatePoint} chars)`);
      return cleaned.substring(0, truncatePoint).trim();
    }
    logger.info(`[Verbalized Sampling] Truncated at max length (${maxChars} chars)`);
    return cleaned.substring(0, maxChars).trim();
  }

  return cleaned;
}

/**
 * Normalize text for comparison - handles different dash/quote variants
 */
function normalizeForComparison(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'") // Smart quotes to straight
    .replace(/[\u2013\u2014]/g, '-') // En/em dashes to hyphen
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Validate and clean a selected response to remove any accumulated duplicates
 */
function validateAndCleanResponse(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());

  if (paragraphs.length < 2) return text;

  // Detect if later paragraphs contain accumulated earlier content
  const seen: string[] = [];
  const unique: string[] = [];

  for (const para of paragraphs) {
    const normalized = normalizeForComparison(para);
    const signature = normalized.substring(0, 60);

    // Check 1: Exact signature match (same start)
    let isDuplicate = seen.some(s => s === signature);

    // Check 2: This paragraph is a superset containing previous content
    if (!isDuplicate && unique.length >= 1) {
      for (const prevPara of unique) {
        const prevNormalized = normalizeForComparison(prevPara);
        // If this paragraph contains most of a previous paragraph, it's accumulated content
        if (prevNormalized.length > 50 && normalized.includes(prevNormalized.substring(0, 100))) {
          isDuplicate = true;
          logger.debug('[Verbalized Sampling] Detected paragraph containing previous content, removing');
          break;
        }
        // Or if a previous paragraph's significant portion appears in this one
        if (prevNormalized.length > 100) {
          const prevMiddle = prevNormalized.substring(20, 80);
          if (normalized.includes(prevMiddle) && normalized !== prevNormalized) {
            isDuplicate = true;
            logger.debug('[Verbalized Sampling] Detected overlapping content, removing');
            break;
          }
        }
      }
    }

    // Check 3: This paragraph contains multiple previous paragraph starts (accumulation pattern)
    if (!isDuplicate && unique.length >= 2) {
      const recentStarts = unique.slice(-3).map((p) => normalizeForComparison(p).substring(0, 40));
      let containsCount = 0;
      for (const start of recentStarts) {
        if (normalized.includes(start)) {
          containsCount++;
        }
      }
      if (containsCount >= 2) {
        isDuplicate = true;
        logger.debug('[Verbalized Sampling] Detected accumulated paragraph, removing');
      }
    }

    if (!isDuplicate) {
      seen.push(signature);
      unique.push(para);
    }
  }

  return unique.join('\n\n');
}

/**
 * Legacy compatibility wrapper for existing code
 * Calls parseVerbalizedResponse and returns just the text with deduplication applied
 */
export function sampleFromVerbalizedResponse(rawResponse: string): string {
  const result = parseVerbalizedResponse(rawResponse);

  if (result.parseMethod === 'fallback-first-section') {
    logger.warn('[Verbalized Sampling] XML parsing failed, used safe fallback', {
      rawResponseLength: rawResponse.length,
      firstChars: rawResponse.substring(0, 200),
    });
  }

  return result.text;
}
