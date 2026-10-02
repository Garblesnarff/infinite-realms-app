import { Skull } from 'lucide-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Z_INDEX } from '@/constants/z-index';

interface DeathScreenProps {
  /** Name of the fallen player character, when known. */
  characterName?: string | null;
  /** Dismiss the overlay so the player can read the story so far. */
  onDismiss: () => void;
}

/**
 * #2456: end screen rendered when the server reports a handled terminal
 * `party_defeated` state. The adventure is over — the player gets clear
 * choices instead of the generic processing error and the infinite
 * "Checking whose turn it is… / Resuming…" wedge.
 */
export const DeathScreen: React.FC<DeathScreenProps> = ({ characterName, onDismiss }) => {
  const navigate = useNavigate();
  const name = characterName?.trim() || 'Your character';

  return (
    <div
      data-testid="death-screen"
      className="absolute inset-0 flex items-center justify-center bg-background/95 backdrop-blur-md p-4"
      style={{ zIndex: Z_INDEX.MODAL }}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="death-screen-title"
      aria-describedby="death-screen-description"
    >
      <Card className="max-w-lg w-full p-8 text-center space-y-6 border-border/60 shadow-2xl">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <Skull className="w-8 h-8 text-destructive" aria-hidden="true" />
          </div>
        </div>

        <div className="space-y-3">
          <h2 id="death-screen-title" className="text-2xl font-bold text-card-foreground">
            {name} has fallen
          </h2>
          <p id="death-screen-description" className="text-muted-foreground leading-relaxed">
            The party was defeated and the tale of {name} ends here. The story cannot continue
            with a fallen hero — but every ending is a new beginning.
          </p>
        </div>

        <div className="flex flex-col gap-3 pt-2">
          <Button
            data-testid="death-screen-new-character"
            onClick={() => navigate('/app/characters/create')}
            className="w-full"
          >
            Create a new character
          </Button>
          <Button
            data-testid="death-screen-explore"
            variant="secondary"
            onClick={() => navigate('/explore')}
            className="w-full"
          >
            Explore campaigns
          </Button>
          <Button
            data-testid="death-screen-read-epilogue"
            variant="ghost"
            onClick={onDismiss}
            className="w-full"
          >
            Read the story so far
          </Button>
        </div>
      </Card>
    </div>
  );
};

interface DismissibleDeathScreenProps {
  characterName?: string | null;
  /** When the terminal response arrived; a new arrival resets the dismissed state. */
  receivedAt: number;
}

/**
 * Wraps DeathScreen with per-arrival dismiss state. Dismissing lets the
 * player read the story so far; the screen reappears on the next message
 * because the terminal state persists server-side.
 */
export const DismissibleDeathScreen: React.FC<DismissibleDeathScreenProps> = ({
  characterName,
  receivedAt,
}) => {
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    setDismissed(false);
  }, [receivedAt]);

  if (dismissed) return null;
  return <DeathScreen characterName={characterName} onDismiss={() => setDismissed(true)} />;
};
