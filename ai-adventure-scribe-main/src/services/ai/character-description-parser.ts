/**
 * Character Description Parser
 *
 * Functions for parsing and extracting structured character description data from AI responses.
 * Extracted from character-description-generator.ts for modularity.
 */

import type { CharacterData, EnhancedDescription } from './prompts/character-description-prompts';

import logger from '@/lib/logger';

/**
 * Parse the AI response and extract different description components
 */
export function parseDescriptionResponse(
  response: string,
  characterData: CharacterData,
): EnhancedDescription {
  try {
    const sections = extractSections(response);
    logger.debug('Extracted sections:', sections);

    const result = {
      description:
        sections.DESCRIPTION ||
        sections.description ||
        `${characterData.name || 'The character'} is a ${characterData.race || 'heroic'} ${characterData.class || 'adventurer'}.`,
      appearance:
        sections.APPEARANCE ||
        sections.appearance ||
        `A typical ${characterData.race || 'adventurer'} with ${characterData.class || 'heroic'} characteristics.`,
      personality_traits:
        sections.PERSONALITY ||
        sections.personality ||
        'Determined and adventurous, ready for any challenge.',
      backstory_elements:
        sections.BACKSTORY ||
        sections.backstory ||
        `${characterData.name || 'This character'} has chosen the adventuring life to fulfill their destiny.`,
    };
    logger.debug('Parsed description result:', result);
    return result;
  } catch (error) {
    logger.error('Error parsing description response:', error);

    // If parsing fails, use the entire response as description
    const cleanResponse = response.replace(/[A-Z]+:/g, '').trim();
    const sentences = cleanResponse.split('.').filter((s) => s.trim());

    return {
      description:
        sentences.slice(0, 2).join('.') + '.' ||
        `${characterData.name || 'The character'} is a ${characterData.race || 'heroic'} ${characterData.class || 'adventurer'}.`,
      appearance:
        sentences.slice(2, 4).join('.') + '.' ||
        `A typical ${characterData.race || 'adventurer'} with ${characterData.class || 'heroic'} characteristics.`,
      personality_traits:
        sentences.slice(4, 6).join('.') + '.' ||
        'Determined and adventurous, ready for any challenge.',
      backstory_elements:
        sentences.slice(6, 8).join('.') + '.' ||
        `${characterData.name || 'This character'} has chosen the adventuring life to fulfill their destiny.`,
    };
  }
}

/**
 * Extract sections from AI response text
 */
export function extractSections(text: string): Record<string, string> {
  const sections: Record<string, string> = {};

  logger.debug('=== PARSING DEBUG ===');
  logger.debug('Full text to parse:', text);
  logger.debug('Text length:', text.length);

  // First, let's try a more reliable approach by splitting the text by section headers
  const sectionHeaders = [
    '**DESCRIPTION:**',
    '**APPEARANCE:**',
    '**PERSONALITY:**',
    '**BACKSTORY:**',
  ];

  // Find all section positions
  const sectionPositions: Array<{ header: string; start: number }> = [];
  sectionHeaders.forEach((header) => {
    const index = text.indexOf(header);
    if (index !== -1) {
      sectionPositions.push({ header, start: index });
    }
  });

  logger.debug('Found section positions:', sectionPositions);

  // Sort by position
  sectionPositions.sort((a, b) => a.start - b.start);

  // Extract each section
  for (let i = 0; i < sectionPositions.length; i++) {
    const currentPos = sectionPositions[i];
    const nextPos = sectionPositions[i + 1];

    // Extract the header
    const header = currentPos.header.replace(/^\*\*(.*):\*\*$/, '$1').toUpperCase();

    // Extract the content
    const contentStart = currentPos.start + currentPos.header.length;
    const contentEnd = nextPos ? nextPos.start : text.length;
    const content = text.substring(contentStart, contentEnd).trim();

    if (content) {
      sections[header] = content;
      logger.debug(`✅ Extracted ${header}:`, content.substring(0, 100) + '...');
    }
  }

  // If no sections were found with the position-based approach, try the original regex as fallback
  if (Object.keys(sections).length === 0) {
    logger.debug('Position-based approach failed, trying regex fallback...');

    // Try bold markdown headers with colon (**SECTION:**)
    const boldMarkdownRegex =
      /\*\*(DESCRIPTION|APPEARANCE|PERSONALITY|BACKSTORY)\*\*:\s*([\s\S]*?)(?=\*\*[A-Z]+:\*\*|$)/g;
    let match;
    while ((match = boldMarkdownRegex.exec(text)) !== null) {
      const [, key, value] = match;
      const sectionKey = key.trim().toUpperCase();
      const cleanedValue = value.trim();
      if (cleanedValue) {
        sections[sectionKey] = cleanedValue;
        logger.debug(
          `Extracted ${sectionKey} (regex fallback):`,
          cleanedValue.substring(0, 100) + '...',
        );
      }
    }
  }

  // Log final extraction results
  logger.debug('=== PARSING RESULTS ===');
  logger.debug('Final extracted sections:', Object.keys(sections));
  logger.debug('Section count:', Object.keys(sections).length);
  Object.entries(sections).forEach(([key, value]) => {
    logger.debug(`${key}: ${value.substring(0, 150)}...`);
  });

  return sections;
}
