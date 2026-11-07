import React from 'react';
import { createRoot } from 'react-dom/client';

import { DiceRollResultFlash } from '../src/components/game/DiceRollResultFlash';
import '../src/index.css';

document.body.classList.add('ir-table-look');
createRoot(document.getElementById('root')!).render(
  <main className="ir-app ir-table-walnut min-h-screen p-8 text-foreground">
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold">Roll results</h1>
      <section aria-label="Resolved narrative check">
        <h2 className="mb-2 text-xl">Strength (Athletics)</h2>
        <DiceRollResultFlash die={10} modifier={2} total={12} checkSuccess />
      </section>
      <section aria-label="Resolved engine attack">
        <h2 className="mb-2 text-xl">Longsword attack</h2>
        <DiceRollResultFlash
          die={13}
          modifier={5}
          total={18}
          engineOutcome={{
            rollId: 'fixture-attack',
            kind: 'attack',
            d20: 20,
            bonus: 5,
            total: 25,
            hit: true,
            isCritical: true,
          }}
        />
      </section>
      <section aria-label="Missed engine attack">
        <h2 className="mb-2 text-xl">Attack missed</h2>
        <DiceRollResultFlash
          die={13}
          modifier={5}
          total={18}
          engineOutcome={{
            rollId: 'fixture-miss',
            kind: 'attack',
            d20: 4,
            bonus: 5,
            total: 9,
            hit: false,
            isCritical: false,
          }}
        />
      </section>
    </div>
  </main>,
);
