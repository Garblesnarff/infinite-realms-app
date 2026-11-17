/**
 * #621 B2b: the bodies the client now sends for the enemy attack, the action-bar dash, dodge,
 * hide, grapple and shove, and the Fighter's Second Wind and Action Surge. Each body is the
 * shared fixture the client tests assert the handlers send, so a body the route refuses fails
 * here, not in production.
 *
 * The check is the route's own request validator (`combatIntentRequestValidator`), the same one
 * `POST /v1/combat/:encounterId/intent` runs before dispatch.
 */
import { describe, expect, it } from 'bun:test';

import {
  enemyAttackWireBody,
  dashClientIntent,
  dodgeClientIntent,
  grappleClientIntent,
  hideClientIntent,
  playerActionWireBody,
  featureWireBody,
  secondWindClientIntent,
  actionSurgeClientIntent,
  shoveClientIntent,
  B2B_ENCOUNTER_VERSION,
} from '../../../../../../shared/test-fixtures/combat-b2b-intent-bodies';
import { combatIntentRequestValidator } from '../intent-schema.js';

describe('#621 B2b intent bodies pass the route validator', () => {
  it('accepts the enemy attack, sent as a DM-source intent with no version', () => {
    expect(combatIntentRequestValidator.Check(enemyAttackWireBody)).toBe(true);
  });

  it.each([
    ['dash', dashClientIntent],
    ['dodge', dodgeClientIntent],
    ['hide', hideClientIntent],
    ['grapple', grappleClientIntent],
    ['shove', shoveClientIntent],
  ])('accepts the player action-bar %s with the version the executor read', (_name, intent) => {
    const body = playerActionWireBody(intent);
    expect(body.intent.expectedVersion).toBe(B2B_ENCOUNTER_VERSION);
    expect(combatIntentRequestValidator.Check(body)).toBe(true);
  });

  it.each([
    ['second_wind', secondWindClientIntent],
    ['action_surge', actionSurgeClientIntent],
  ])('accepts the Fighter feature %s as the DM panel posts it', (_name, intent) => {
    expect(combatIntentRequestValidator.Check(featureWireBody(intent))).toBe(true);
  });

  it('refuses a player action sent with no version', () => {
    const body = { intent: dashClientIntent, source: 'player', origin: 'action_bar' };
    expect(combatIntentRequestValidator.Check(body)).toBe(false);
  });
});
