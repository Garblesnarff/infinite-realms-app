import { useEffect, useState } from 'react';

import type { VisionBlocker } from '@/types/scene';
import type { Token } from '@/types/token';
import type { VisionPolygon as VisionPolygonType } from '@/utils/vision-polygon';

import { calculateVisionPolygon } from '@/utils/vision-polygon';

/**
 * Hook to calculate and cache vision polygons
 *
 * @example
 * ```tsx
 * const { polygon, isCalculating } = useVisionPolygon(token, walls, range);
 * ```
 */
export function useVisionPolygon(
  token: Token | null,
  walls: VisionBlocker[],
  range?: number,
): {
  polygon: VisionPolygonType | null;
  isCalculating: boolean;
} {
  const [polygon, setPolygon] = useState<VisionPolygonType | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  useEffect(() => {
    if (!token) {
      setPolygon(null);
      return;
    }

    setIsCalculating(true);

    // Use requestIdleCallback for non-blocking calculation
    const handle = requestIdleCallback(
      () => {
        const poly = calculateVisionPolygon(token, walls, range);
        setPolygon(poly);
        setIsCalculating(false);
      },
      { timeout: 100 },
    );

    return () => {
      cancelIdleCallback(handle);
      setIsCalculating(false);
    };
  }, [token, walls, range]);

  return { polygon, isCalculating };
}
