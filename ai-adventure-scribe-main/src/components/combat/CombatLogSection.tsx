import { RefreshCw } from 'lucide-react';
import React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { summarizeEngineLine } from '@/features/game-session/components/game/EngineOutcomeChip';

interface CombatLogSectionProps {
  /** Engine lines, latest first. The parent decides which lines the chat shows. */
  lines: readonly string[];
}

/**
 * Read-only log for the combat tracker (#2257). It lists the same `⚙️ Engine:` lines the chat
 * shows, latest first, so the tracker and the chat cannot disagree about what happened.
 */
const CombatLogSection: React.FC<CombatLogSectionProps> = ({ lines }) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <RefreshCw className="w-5 h-5" aria-hidden="true" />
        Combat log
      </CardTitle>
    </CardHeader>
    <CardContent>
      {lines.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Nothing has happened yet.</p>
      ) : (
        <ol className="max-h-64 space-y-2 overflow-y-auto" aria-label="Combat log entries">
          {lines.map((line, index) => (
            <li
              key={`${index}-${line}`}
              className="rounded-md bg-muted/50 p-2 text-sm text-foreground"
            >
              {summarizeEngineLine(line).detail}
            </li>
          ))}
        </ol>
      )}
    </CardContent>
  </Card>
);

export default CombatLogSection;
