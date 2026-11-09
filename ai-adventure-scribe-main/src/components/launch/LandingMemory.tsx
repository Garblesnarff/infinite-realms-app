/**
 * Landing "Memory" block (Table 12, Landing board): the board's copy and three example notes.
 */

import React from 'react';

const MEMORY_EXAMPLES = [
  {
    mark: 'P',
    text: 'The iron piton is new, hammered in by the last expedition.',
    when: 'Session 1 · just now',
  },
  {
    mark: 'C',
    text: 'The Vitruvian Spider is stitched from the dead of the last expedition.',
    when: 'Session 1 · just now',
  },
  {
    mark: 'I',
    text: 'A torn page: “Day 9. The ropes were cut from below.”',
    when: 'Session 1 · 2 minutes ago',
  },
];

export const LandingMemory: React.FC = () => (
  <section
    aria-labelledby="landing-memory"
    className="mx-auto grid max-w-[1216px] items-center gap-12 px-4 py-16 lg:grid-cols-2 lg:gap-[72px]"
  >
    <div>
      <div className="text-sm font-bold tracking-[0.16em] text-[#4fb6c4]">MEMORY</div>
      <h2
        id="landing-memory"
        className="mt-3 font-heading text-3xl font-bold leading-[1.12] text-balance text-[#eaeefa] sm:text-[44px]"
      >
        A WORLD THAT REMEMBERS YOU
      </h2>
      <p className="mt-5 text-lg leading-relaxed text-[#d4dbef] sm:text-xl">
        Every place, person and promise goes into the DM’s notebook. Open it any time and see what
        the DM knows.
      </p>
    </div>
    <div className="flex w-full max-w-[340px] flex-col gap-2.5 justify-self-center rounded-2xl bg-[#0c1220] p-4 shadow-[0_0_0_1px_rgba(213,176,112,0.3),0_24px_50px_rgba(0,0,0,0.55)]">
      <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#aab3cc]">
        Example
      </div>
      <div className="text-[15px] font-bold text-[#f3deb0]">The DM remembers this story.</div>
      <ul className="flex flex-col gap-2.5">
        {MEMORY_EXAMPLES.map((m) => (
          <li
            key={m.mark}
            className="flex gap-2.5 rounded-xl border border-[#d5b070]/20 bg-[#121b30] p-3"
          >
            <span
              aria-hidden="true"
              className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#4fb6c4]/15 text-xs font-bold text-[#4fb6c4]"
            >
              {m.mark}
            </span>
            <div className="min-w-0">
              <div
                className="text-[17px] leading-snug text-[#eaeefa]"
                style={{ fontFamily: "'EB Garamond', Georgia, serif" }}
              >
                {m.text}
              </div>
              <div className="mt-1 text-[13px] text-[#aab3cc]">{m.when}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  </section>
);

export default LandingMemory;
