/**
 * One cap for player turn text (#1307), shared by every route that reads it and
 * by the composer that sends it.
 *
 * The caps used to disagree: session messages accepted 100_000 chars while
 * generate (`player_input`), combat intents (`playerInput`) and combat entry
 * (`playerInput`) all capped at 20_000. A typed turn of 20,001–100,000 chars
 * therefore saved as a player message and then 422'd at generate (and in combat
 * at intents) — the player saw a failed turn, not a length message.
 *
 * The unified value is 20_000, the value three of the four routes already
 * enforced: unifying upward to 100_000 would loosen validation 5x on three
 * routes, while unifying here only tightens session messages down to the
 * existing strict value — and the composer enforces the same cap, so users
 * never hit the 422.
 *
 * This covers player turn text only. The generate route's `prompt` field is a
 * different field (the assembled DM prompt, not the player's words) and is
 * intentionally NOT capped here (out of scope per #1307). Likewise, in
 * session-messages the cap applies to player messages only: DM, system, and
 * companion saves flow through that route and keep their prior bound.
 */
export const PLAYER_INPUT_MAX_CHARS = 20_000;
