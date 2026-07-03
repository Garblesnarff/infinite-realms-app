export const keyframes = {
  'accordion-down': {
    from: {
      height: '0',
    },
    to: {
      height: 'var(--radix-accordion-content-height)',
    },
  },
  'accordion-up': {
    from: {
      height: 'var(--radix-accordion-content-height)',
    },
    to: {
      height: '0',
    },
  },
  // Fantasy-Tech Fusion Animations
  'fade-in': {
    '0%': { opacity: '0' },
    '100%': { opacity: '1' },
  },
  'fade-in-up': {
    '0%': { opacity: '0', transform: 'translateY(20px)' },
    '100%': { opacity: '1', transform: 'translateY(0)' },
  },
  'fade-in-down': {
    '0%': { opacity: '0', transform: 'translateY(-20px)' },
    '100%': { opacity: '1', transform: 'translateY(0)' },
  },
  'slide-in-left': {
    '0%': { opacity: '0', transform: 'translateX(-20px)' },
    '100%': { opacity: '1', transform: 'translateX(0)' },
  },
  'slide-in-right': {
    '0%': { opacity: '0', transform: 'translateX(20px)' },
    '100%': { opacity: '1', transform: 'translateX(0)' },
  },
  'scale-in': {
    '0%': { opacity: '0', transform: 'scale(0.95)' },
    '100%': { opacity: '1', transform: 'scale(1)' },
  },
  'glow-pulse': {
    '0%, 100%': {
      boxShadow: '0 0 10px rgba(124, 58, 237, 0.3), 0 0 20px rgba(124, 58, 237, 0.2)',
    },
    '50%': {
      boxShadow: '0 0 20px rgba(124, 58, 237, 0.5), 0 0 40px rgba(124, 58, 237, 0.3)',
    },
  },
  'gold-glow-pulse': {
    '0%, 100%': {
      boxShadow: '0 0 10px rgba(245, 158, 11, 0.3), 0 0 20px rgba(245, 158, 11, 0.2)',
    },
    '50%': {
      boxShadow: '0 0 20px rgba(245, 158, 11, 0.5), 0 0 40px rgba(245, 158, 11, 0.3)',
    },
  },
  shimmer: {
    '0%': { backgroundPosition: '-200% 0' },
    '100%': { backgroundPosition: '200% 0' },
  },
  float: {
    '0%, 100%': { transform: 'translateY(0px)' },
    '50%': { transform: 'translateY(-10px)' },
  },
  'bounce-subtle': {
    '0%, 100%': { transform: 'translateY(0)' },
    '50%': { transform: 'translateY(-5px)' },
  },
  'spin-slow': {
    '0%': { transform: 'rotate(0deg)' },
    '100%': { transform: 'rotate(360deg)' },
  },
  'dice-roll': {
    '0%': { transform: 'rotate(0deg) scale(1)' },
    '50%': { transform: 'rotate(180deg) scale(1.1)' },
    '100%': { transform: 'rotate(360deg) scale(1)' },
  },
  sparkle: {
    '0%': { opacity: '0', transform: 'scale(0) rotate(0deg)' },
    '50%': { opacity: '1', transform: 'scale(1) rotate(180deg)' },
    '100%': { opacity: '0', transform: 'scale(0.5) rotate(360deg)' },
  },
  celebration: {
    '0%': { opacity: '0', transform: 'scale(0.8)' },
    '50%': { opacity: '1', transform: 'scale(1.1)' },
    '100%': { opacity: '1', transform: 'scale(1)' },
  },
  'pulse-soft': {
    '0%, 100%': { opacity: '1' },
    '50%': { opacity: '0.8' },
  },
};
