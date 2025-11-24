import React from 'react';
import { Hammer, Clock, Heart } from 'lucide-react';

export const FounderStorySection: React.FC = () => {
  return (
    <section className="py-24 bg-gray-900 relative overflow-hidden">
      {/* Background Texture Image */}
      <div className="absolute inset-0">
        <img
          src="/founder-bg.jpg"
          alt="Industrial background"
          className="w-full h-full object-cover opacity-10"
        />
        {/* Additional dark overlay for grittiness */}
        <div className="absolute inset-0 bg-gradient-to-b from-gray-900/80 via-gray-900/90 to-gray-900"></div>
      </div>

      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-4xl mx-auto bg-gradient-to-br from-gray-800/60 to-gray-900/60 rounded-2xl p-8 md:p-12 border border-purple-500/20 shadow-2xl backdrop-blur-sm">

          {/* Decorative Elements */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

          <div className="relative z-10">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-8 flex items-center gap-3">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-purple-200">
                Built to Escape the Grind
              </span>
            </h2>

            <div className="space-y-6 text-lg text-gray-300 leading-relaxed">
              <p>
                <strong className="text-white">I didn't build this in a boardroom.</strong>
              </p>

              <p>
                I've worked in manufacturing for 16 years. I love TTRPGs, but working 10-hour shifts meant I could never align schedules with a regular group. The desire to play was there, but the "Real World" kept getting in the way.
              </p>

              <p>
                I spent the last 3 years teaching AI how to be the Game Master I couldn't find—while still working those factory shifts. I didn't want a chatbot that hallucinates; I wanted a GM that knows the rules, does the voices, and remembers that tavern I burned down three sessions ago.
              </p>

              <p className="text-xl text-white font-medium pt-4">
                I built Infinite Realms so I could finally play. Now, I want you to play too.
              </p>

              {/* Signature Section with Script Font */}
              <div className="pt-8 flex items-center gap-4 border-t border-gray-700/50 mt-8">
                <div className="w-12 h-12 bg-purple-600 rounded-full flex items-center justify-center font-bold text-xl text-white shadow-lg">
                  R
                </div>
                <div>
                  {/* Handwritten Signature - Using Dancing Script font */}
                  <p className="text-amber-400 text-4xl font-dancing mb-1">Rob</p>
                  <p className="text-purple-400 text-sm">Creator, Infinite Realms</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Add Google Fonts for script signature */}
      <style jsx>{`
        @import url('https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap');
        .font-dancing {
          font-family: 'Dancing Script', cursive;
        }
      `}</style>
    </section>
  );
};
