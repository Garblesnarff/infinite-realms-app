/**
 * Vision Section - Sell the Dream
 *
 * PURPOSE: Paint a vivid picture of the future AI Dungeon Master experience
 * Split view layout: Text on left, magical map on right
 */

import { Sparkles } from 'lucide-react';
import React from 'react';

import { launchPageContent } from '@/data/launchPageContent';

export const VisionSection: React.FC = () => {
  const { vision } = launchPageContent;

  return (
    <section id="vision" className="relative py-24 bg-infinite-dark">
      <div className="max-w-7xl mx-auto px-6">
        {/* Split View: Text Left, Magical Map Right */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left Column: Text Content */}
          <div className="text-left">
            {/* Headline */}
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-8 leading-tight uppercase tracking-tight text-balance">
              <span className="text-white">A </span>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-infinite-gold to-infinite-teal">
                Persistent World
              </span>{' '}
              <span className="text-white">That </span>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-infinite-gold to-infinite-teal">
                Remembers You
              </span>
            </h2>

            {/* Vision Content - Subheadline */}
            <p className="text-lg text-gray-300 leading-relaxed mb-8">{vision.content}</p>

            {/* Vision Quote Box */}
            <div className="flex items-start gap-4 p-8 bg-[#0c1220] border border-infinite-gold/30 rounded-xl backdrop-blur-sm">
              <Sparkles className="w-10 h-10 text-infinite-gold flex-shrink-0 mt-1" />
              <div>
                <p className="text-xl text-infinite-gold font-semibold mb-3">Our Vision</p>
                <p className="text-gray-300 text-xl leading-relaxed">{vision.quote}</p>
              </div>
            </div>
          </div>

          {/* Right Column: Magical Map with Float Animation */}
          <div className="relative">
            <div className="relative lg:h-[700px] h-[400px] rounded-2xl overflow-hidden border border-infinite-gold/20 shadow-2xl animate-float">
              <img
                src="/vision-side.jpg"
                alt="Magical fantasy map"
                className="w-full h-full object-cover"
              />
              {/* Magical glow overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-infinite-dark/30 to-transparent"></div>
              {/* Subtle gold glow around the image */}
              <div className="absolute inset-0 shadow-[0_0_60px_rgba(213,176,112,0.3)]"></div>
            </div>
          </div>
        </div>
      </div>

      {/* Add float animation */}
      {/* @ts-expect-error #192 styled-jsx `jsx` attribute has no type in this Vite app */}
      <style jsx>{`
        @keyframes float {
          0%,
          100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-10px);
          }
        }
        .animate-float {
          animation: float 6s ease-in-out infinite;
        }
      `}</style>
    </section>
  );
};
