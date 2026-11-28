/**
 * Exact JSON body the client posts to `POST /v1/sessions/:id/lethal-act`
 * after the player confirms a clearly lethal free-text act (#468).
 *
 * Shared on purpose: the client test asserts `submitConfirmedLethalAct`
 * sends exactly this object, and the server test posts the same object
 * through the real route.
 */

export const LETHAL_ACT_TEXT = 'I step off the edge to my death';

export const LETHAL_ACT_WIRE_BODY = { text: LETHAL_ACT_TEXT } as const;
