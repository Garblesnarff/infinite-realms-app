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
    <section id="vision" className="relative py-24 bg-gray-900">
      <div className="max-w-7xl mx-auto px-6">
        {/* Split View: Text Left, Magical Map Right */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

          {/* Left Column: Text Content */}
          <div className="text-left">
            {/* Headline */}
            <h2 className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-8 leading-tight uppercase tracking-tight">
              <span className="text-gray-200">A </span>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-purple-400">
                Persistent World
              </span>
              <br />
              <span className="text-gray-200">That </span>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-purple-400">
                Remembers You
              </span>
            </h2>

            {/* Vision Content - Subheadline */}
            <p className="text-lg text-gray-300 leading-relaxed mb-8">
              {vision.content}
            </p>

            {/* Vision Quote Box */}
            <div className="flex items-start gap-4 p-8 bg-gradient-to-r from-purple-900/30 to-amber-900/30 border border-purple-500/30 rounded-xl backdrop-blur-sm">
              <Sparkles className="w-10 h-10 text-amber-400 flex-shrink-0 mt-1" />
              <div>
                <p className="text-xl text-amber-400 font-semibold mb-3">Our Vision</p>
                <p className="text-gray-300 text-xl leading-relaxed">{vision.quote}</p>
              </div>
            </div>
          </div>

          {/* Right Column: Magical Map with Float Animation */}
          <div className="relative">
            <div className="relative lg:h-[700px] h-[400px] rounded-2xl overflow-hidden border border-purple-500/20 shadow-2xl animate-float">
              <img
                src="/vision-side.jpg"
                alt="Magical fantasy map"
                className="w-full h-full object-cover"
              />
              {/* Magical glow overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-purple-900/30 to-transparent"></div>
              {/* Subtle purple glow around the image */}
              <div className="absolute inset-0 shadow-[0_0_60px_rgba(168,85,247,0.3)]"></div>
            </div>
          </div>

        </div>
      </div>

      {/* Add float animation */}
      <style jsx>{`
        @keyframes float {
          0%, 100% {
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
