/**
 * The one shape every client uses to render turn order. The playtest transcript only ever
 * showed the player's own initiative roll because nothing published the whole list; this is
 * derived from the same authoritative combat state the server already computes.
 */
export type InitiativeOrderEntry = {
  id: string;
  name: string;
  participantType: string;
  initiative: number;
  isCurrent: boolean;
  hasGone: boolean;
};

type TurnOrderShape = {
  turnOrder?: Array<{
    participant: { id: string; name: string; participantType: string; initiative: number };
    isCurrent: boolean;
    hasGone: boolean;
  }>;
};

export function buildInitiativeOrder(state: TurnOrderShape): InitiativeOrderEntry[] {
  return (state.turnOrder ?? []).map((entry) => ({
    id: entry.participant.id,
    name: entry.participant.name,
    participantType: entry.participant.participantType,
    initiative: entry.participant.initiative,
    isCurrent: entry.isCurrent,
    hasGone: entry.hasGone,
  }));
}
