/**
 * #1797 harness: the real TacticalMapProvider and TacticalMapBoard in a rail-width column.
 * The spec swaps the combat context module for a shim that reads `window.harness.encounter`,
 * so the board sees a recorded fight; the map arrives over the network mock and window events.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';

import { requestMapMoveMode, useMoveModeArmed } from '../src/features/game-session/components/tactical/map-move-mode';
import { TacticalMapBoard } from '../src/features/game-session/components/tactical/TacticalMapBoard';
import { TacticalMapProvider } from '../src/features/game-session/components/tactical/TacticalMapProvider';
import '../src/index.css';

const SESSION_ID = 'session-1797';

/** Mirrors the action bar's Move button: it calls the same function and reads the same armed flag. */
function MoveButton(): React.ReactElement {
  const armed = useMoveModeArmed();
  return (
    <button type="button" aria-pressed={armed} onClick={() => requestMapMoveMode()}>
      Move
    </button>
  );
}

function App(): React.ReactElement {
  return (
    <TacticalMapProvider sessionId={SESSION_ID}>
      <div data-testid="rail" style={{ width: 360, padding: 8 }}>
        {/* The action bar's Move button calls this same function (CombatActionBar onMove). */}
        <MoveButton />
        <TacticalMapBoard sessionId={SESSION_ID} />
      </div>
    </TacticalMapProvider>
  );
}

const root = createRoot(document.getElementById('root')!);
(window as unknown as { harness: { render: () => void } }).harness = {
  render: () => root.render(<App />),
};
root.render(<App />);
