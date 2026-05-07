import React, { useMemo } from 'react';

import type { Token } from '@/types/token';

// ===========================
// Vision Cone Arc Component
// ===========================

interface VisionConeArcProps {
  token: Token;
  range: number;
  color: string;
}

/**
 * Render vision cone arc for limited-angle vision
 *
 * ⚡ Bolt: Wrapped in React.memo to prevent redundant re-renders.
 */
const VisionConeArc: React.FC<VisionConeArcProps> = React.memo(({ token, range, color }) => {
  const pathData = useMemo(() => {
    const halfAngle = (token.vision.angle / 2) * (Math.PI / 180);
    const centerAngle = token.rotation * (Math.PI / 180);

    const startAngle = centerAngle - halfAngle;
    const endAngle = centerAngle + halfAngle;

    const startX = token.x + Math.cos(startAngle) * range;
    const startY = token.y + Math.sin(startAngle) * range;
    const endX = token.x + Math.cos(endAngle) * range;
    const endY = token.y + Math.sin(endAngle) * range;

    const largeArcFlag = token.vision.angle > 180 ? 1 : 0;

    return `
      M ${token.x} ${token.y}
      L ${startX} ${startY}
      A ${range} ${range} 0 ${largeArcFlag} 1 ${endX} ${endY}
      Z
    `;
  }, [token, range]);

  return (
    <path
      d={pathData}
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeOpacity={0.3}
      strokeDasharray="5,5"
      pointerEvents="none"
    />
  );
});

// ===========================
// Vision Boundary Component
// ===========================

export interface VisionBoundaryProps {
  token: Token;
  range?: number;
  color?: string;
}

/**
 * Show vision range boundary (debug/GM tool)
 *
 * Renders a simple circle showing maximum vision range
 *
 * ⚡ Bolt: Wrapped in React.memo to prevent redundant re-renders.
 */
export const VisionBoundary: React.FC<VisionBoundaryProps> = React.memo(
  ({ token, range, color = '#ffffff' }) => {
    const effectiveRange = range !== undefined ? range : token.vision.range * 20;

    if (!token.vision.enabled || effectiveRange === 0) {
      return null;
    }

    return (
      <g className="vision-boundary">
        {/* Full circle for 360° vision */}
        {token.vision.angle >= 360 ? (
          <circle
            cx={token.x}
            cy={token.y}
            r={effectiveRange}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeOpacity={0.3}
            strokeDasharray="5,5"
            pointerEvents="none"
          />
        ) : (
          /* Arc for limited vision cone */
          <VisionConeArc token={token} range={effectiveRange} color={color} />
        )}
      </g>
    );
  },
);

export default VisionBoundary;
