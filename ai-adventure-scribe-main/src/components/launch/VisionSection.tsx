/**
 * Vision Section - Sell the Dream
 *
 * PURPOSE: Paint a vivid picture of the future AI Dungeon Master experience
 * Split view layout: Text on left, epic image on right
 */

import { Sparkles } from 'lucide-react';
import React from 'react';

import { launchPageContent } from '@/data/launchPageContent';

export const VisionSection: React.FC = () => {
  const { vision } = launchPageContent;

  return (
    <section id="vision" className="relative py-24 bg-gray-900">
      <div className="max-w-7xl mx-auto px-6">
        {/* Split View: Text Left, Image Right */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

          {/* Left Column: Text Content */}
          <div className="text-left">
            {/* Headline */}
            <h2 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white mb-8 leading-tight">
              {vision.headline.split(' ').map((word, index) => (
                <span
                  key={index}
                  className={
                    index >= 4
                      ? 'text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-purple-400'
                      : ''
                  }
                >
                  {word}
                  {index < vision.headline.split(' ').length - 1 ? ' ' : ''}
                </span>
              ))}
            </h2>

            {/* Vision Content */}
            <p className="text-2xl sm:text-3xl text-gray-300 leading-relaxed mb-10 font-light">
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

          {/* Right Column: Epic Image */}
          <div className="relative lg:h-[700px] h-[400px] rounded-2xl overflow-hidden border border-purple-500/20 shadow-2xl">
            <img
              src="/hero-bg-v2.jpg"
              alt="Epic fantasy adventure scene"
              className="w-full h-full object-cover"
            />
            {/* Subtle overlay for depth */}
            <div className="absolute inset-0 bg-gradient-to-t from-purple-900/40 to-transparent"></div>
          </div>

        </div>
      </div>
    </section>
  );
};
