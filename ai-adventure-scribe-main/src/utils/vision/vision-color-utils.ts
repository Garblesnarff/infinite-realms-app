import type { TokenVisionConfig } from '@/types/token';

/**
 * Get the color for a vision type
 *
 * @param visionMode - The vision mode
 * @returns Hex color string
 */
export function getVisionColor(visionMode: TokenVisionConfig['visionMode']): string {
  const colors: Record<NonNullable<TokenVisionConfig['visionMode']>, string> = {
    basic: '#ffffff',
    darkvision: '#6366f1', // indigo/blue
    monochrome: '#9ca3af', // gray
    tremorsense: '#92400e', // brown
    blindsight: '#fbbf24', // yellow
    truesight: '#fbbf24', // gold
  };

  return colors[visionMode || 'basic'];
}

/**
 * Get opacity for vision type
 *
 * @param visionMode - The vision mode
 * @returns Opacity value 0-1
 */
export function getVisionOpacity(visionMode: TokenVisionConfig['visionMode']): number {
  const opacities: Record<NonNullable<TokenVisionConfig['visionMode']>, number> = {
    basic: 0.15,
    darkvision: 0.2,
    monochrome: 0.2,
    tremorsense: 0.25,
    blindsight: 0.3,
    truesight: 0.35,
  };

  return opacities[visionMode || 'basic'];
}
