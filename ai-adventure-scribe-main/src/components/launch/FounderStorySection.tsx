import React from 'react';
import { Hammer, Clock, Heart } from 'lucide-react';

export const FounderStorySection: React.FC = () => {
  return (
    <section className="py-24 bg-gray-900 relative">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-8 md:p-12 border border-purple-500/20 shadow-2xl relative overflow-hidden">

          {/* Background Decorative Elements */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>

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

              <div className="flex items-center gap-4 py-4 border-t border-b border-gray-700/50 my-6">
                <div className="flex flex-col gap-1">
                   <span className="text-sm text-gray-400 uppercase tracking-wider">Mission</span>
                   <span className="text-white font-medium">Democratize Adventure</span>
                </div>
                <div className="w-px h-10 bg-gray-700/50"></div>
                <div className="flex flex-col gap-1">
                   <span className="text-sm text-gray-400 uppercase tracking-wider">Status</span>
                   <span className="text-amber-400 font-medium">Beta Ready</span>
                </div>
              </div>

              <p>
                I built Infinite Realms so I could finally play. Now, I want you to play too.
              </p>

              <div className="pt-4 flex items-center gap-4">
                <div className="w-12 h-12 bg-purple-600 rounded-full flex items-center justify-center font-bold text-xl text-white">
                  R
                </div>
                <div>
                  <p className="text-white font-bold">Rob Hanson</p>
                  <p className="text-purple-400 text-sm">Creator, Infinite Realms</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
