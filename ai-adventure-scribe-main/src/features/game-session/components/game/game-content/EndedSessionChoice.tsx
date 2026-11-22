import React from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { stripAssetTags } from '@/lib/utils';
import { userDataApi } from '@/services/user-data-api';

/**
 * #1669: the choice a hero gets when a new session would otherwise start by itself. It is shown
 * when a game link has no active session but the hero has sessions that can be resumed, when an
 * ended session is opened by its link, and on the premade path after End session.
 *
 * - Start new session: a new session in this adventure, the scene carried over (the same
 *   continuation as before; the URL flag `continue=1` tells the game load to skip this choice).
 * - Resume session: a list of this hero's resumable sessions, newest first. Choosing one resumes
 *   it. With none, Resume is disabled and says why.
 */

type ResumableRow = {
  id: string;
  session_number: number | null;
  end_time: string | null;
  current_scene_description: string | null;
};

const MISSING_HERO = 'This link has no hero. Pick a hero first.';

/** The last non-empty line of the scene text, with the asset tags removed. */
export function lastSceneLine(text: string | null | undefined): string {
  const lines = stripAssetTags(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : 'No scene recorded';
}

export function EndedSessionChoice({
  campaignId,
  characterId,
  starterCampaignId,
}: {
  campaignId: string | null;
  characterId: string | null;
  starterCampaignId: string | null;
}): React.ReactElement {
  const navigate = useNavigate();
  const [rows, setRows] = React.useState<ResumableRow[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [showList, setShowList] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const missingHero = !campaignId || !characterId;

  // #1691: when the list opens, keyboard and screen-reader focus moves to it.
  React.useEffect(() => {
    if (showList) listRef.current?.focus();
  }, [showList]);

  React.useEffect(() => {
    if (!campaignId || !characterId) return undefined;
    let cancelled = false;
    userDataApi.listResumableSessions(campaignId, characterId).then(
      (list: ResumableRow[]) => {
        if (cancelled) return;
        // Newest first: the session number decides the order, not the order the server returned.
        setRows([...list].sort((a, b) => (b.session_number ?? 0) - (a.session_number ?? 0)));
      },
      (err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Could not load this hero’s sessions.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [campaignId, characterId]);

  function startNew(): void {
    if (!campaignId || !characterId) {
      setError(MISSING_HERO);
      return;
    }
    const params = new URLSearchParams({ character: characterId, continue: '1' });
    if (starterCampaignId) params.set('starterCampaign', starterCampaignId);
    setError(null);
    navigate(`/app/game/${campaignId}?${params.toString()}`);
  }

  async function resume(row: ResumableRow): Promise<void> {
    if (!campaignId || !characterId) {
      setError(MISSING_HERO);
      return;
    }
    setBusy(row.id);
    setError(null);
    try {
      await userDataApi.resumeSession(row.id);
      // Full load of the game for the reopened session, so every part of the screen starts from it.
      window.location.assign(`/app/game/${campaignId}?character=${characterId}&session=${row.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resume that session.');
      setBusy(null);
    }
  }

  const resumeReason = loadError
    ? loadError
    : rows === null
      ? 'Loading sessions…'
      : rows.length === 0
        ? 'No session to resume'
        : null;
  const canOpenList = !missingHero && rows !== null && rows.length > 0;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6 text-center">
      <div className="max-w-xl space-y-2">
        <h1 className="ir-display text-[24px] text-infinite-gold-light">Choose how to continue</h1>
        <p className="text-muted-foreground">
          Start new session begins a new session in this adventure, with the scene carried over.
          Resume session reopens one of your sessions, with its chat and its story so far.
        </p>
      </div>

      {missingHero ? (
        <p role="alert" className="text-sm text-destructive">
          {MISSING_HERO}
        </p>
      ) : (
        <div className="flex w-full max-w-sm flex-col gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={startNew}
            disabled={busy !== null}
            className="min-h-11 w-full"
          >
            Start new session
          </Button>
          <Button
            type="button"
            onClick={() => setShowList((open) => !open)}
            disabled={!canOpenList || busy !== null}
            aria-expanded={showList}
            className="min-h-11 w-full"
          >
            Resume session
          </Button>
          {resumeReason && <p className="text-sm text-muted-foreground">{resumeReason}</p>}
        </div>
      )}

      {showList && rows && rows.length > 0 && (
        // #1691: the list is capped in height and scrolls, so a long list does not make a very long page.
        <ul
          ref={listRef}
          tabIndex={-1}
          className="flex max-h-[60vh] w-full max-w-xl flex-col gap-3 overflow-y-auto text-left"
          aria-label="Sessions to resume"
        >
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-2 rounded-md border border-border p-4 md:flex-row md:items-center md:justify-between"
            >
              <div className="space-y-1">
                <p className="font-semibold">
                  Session {row.session_number ?? '—'}
                  {row.end_time && (
                    <span className="font-normal text-muted-foreground">
                      {' '}
                      · Ended{' '}
                      {new Date(row.end_time).toLocaleDateString(undefined, {
                        dateStyle: 'medium',
                      })}
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {lastSceneLine(row.current_scene_description)}
                </p>
              </div>
              <Button
                type="button"
                onClick={() => void resume(row)}
                disabled={busy !== null}
                aria-label={`Resume session ${row.session_number ?? ''}`.trim()}
                className="min-h-11 md:w-44"
              >
                {busy === row.id ? 'Resuming…' : 'Resume this session'}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
