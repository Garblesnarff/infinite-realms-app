import React from 'react';

/**
 * Keyframe animations for QuickActionMenu's backdrop, center button, and
 * radial action buttons.
 */
export const QuickActionMenuAnimations: React.FC = () => (
  <style>{`
    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    @keyframes radialAppear {
      from {
        opacity: 0;
        transform: translate(-50%, -50%) scale(0);
      }
      to {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }
    }

    @keyframes radialCenter {
      from {
        opacity: 0;
        transform: translate(-50%, -50%) scale(0);
      }
      to {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }
    }
  `}</style>
);
