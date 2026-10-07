import { userDataApi, type AdvanceNpcTurnsResponse } from '@/services/user-data-api';

/** The server's NPC loop is bounded per call; a few more calls cover a long run of creatures. */
const MAX_CAP_CONTINUATIONS = 3;
const CAP_LINE = 'NPC turn loop stopped after';

/**
 * Runs the NPC turns after a player's turn, and runs them again when the server's loop stopped at
 * its safety cap with a creature still up.
 *
 * The server has no auto-advance: a creature that holds the turn when the loop stops waits until
 * the client asks again, which for a player who has just ended their turn means until they type
 * something (#2641). The cap is a per-call bound, not a verdict, so the client continues, a few
 * times at most, and reports one batch: every result in order, and the cap line only when the
 * last call still stopped on it.
 */
export async function advanceNpcTurnsToPlayer(
  sessionId: string,
  expectedCurrentParticipantId: string | undefined,
  signal?: AbortSignal,
): Promise<AdvanceNpcTurnsResponse> {
  const call = (expected: string | undefined): Promise<AdvanceNpcTurnsResponse> =>
    signal
      ? userDataApi.advanceNpcTurns(sessionId, expected, signal)
      : userDataApi.advanceNpcTurns(sessionId, expected);

  let last = await call(expectedCurrentParticipantId);
  const earlier: AdvanceNpcTurnsResponse[] = [];
  while (
    earlier.length < MAX_CAP_CONTINUATIONS &&
    last.capReached &&
    !last.combatEnded &&
    last.currentParticipant &&
    last.currentParticipant.participantType !== 'player'
  ) {
    earlier.push(last);
    last = await call(last.currentParticipant.id);
  }
  if (!earlier.length) return last;
  return {
    ...last,
    results: [...earlier.flatMap((batch) => batch.results), ...last.results],
    iterationCount: [...earlier, last].reduce((sum, batch) => sum + batch.iterationCount, 0),
    transcriptLines: [
      ...earlier.flatMap((batch) =>
        batch.transcriptLines.filter((line) => !line.includes(CAP_LINE)),
      ),
      ...last.transcriptLines,
    ],
  };
}
