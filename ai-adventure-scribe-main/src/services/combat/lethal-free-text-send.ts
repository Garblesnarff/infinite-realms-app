import { submitConfirmedLethalAct, type LethalActResponse } from './lethal-act-api';
import { requestLethalActionConfirmation } from './lethal-action-confirmation-bridge';
import { isClearlyLethalAction } from '../../../shared/lethal-action-detector';

export type LethalFreeTextDecision =
  | { kind: 'send-normal' }
  | { kind: 'cancelled' }
  | { kind: 'engine'; result: LethalActResponse };

/**
 * #468 item 2: a clearly lethal free-text act outside a fight asks "Are you
 * sure?" first. Cancel means nothing is sent. Confirm asks the engine to
 * resolve the save or check.
 */
export async function decideLethalFreeTextSend(input: {
  text: string;
  inCombat: boolean;
  intent?: string;
  confirm?: (text: string) => Promise<boolean>;
  resolve?: (sessionId: string, text: string) => Promise<LethalActResponse>;
  sessionId: string;
}): Promise<LethalFreeTextDecision> {
  if (
    input.intent === 'dice_roll' ||
    input.intent === 'resume_unanswered' ||
    input.inCombat ||
    !isClearlyLethalAction(input.text)
  ) {
    return { kind: 'send-normal' };
  }

  const confirmed = input.confirm
    ? await input.confirm(input.text)
    : await requestLethalActionConfirmation({ playerMessage: input.text });
  if (!confirmed) return { kind: 'cancelled' };

  const result = await (input.resolve ?? submitConfirmedLethalAct)(input.sessionId, input.text);
  return { kind: 'engine', result };
}
