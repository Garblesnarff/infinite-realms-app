/**
 * Shared shapes for the combat damage/healing integrators.
 */

import type { DamageType } from '@/types/combat';

export interface DamageApplication {
  participantId: string;
  encounterId: string;
  damageAmount: number;
  damageType: DamageType;
  sourceParticipantId?: string;
  sourceDescription?: string;
  roundNumber: number;
}

export interface HealingApplication {
  participantId: string;
  healingAmount: number;
  sourceDescription?: string;
}

export interface HPUpdateResult {
  success: boolean;
  participantId: string;
  previousHP: number;
  newHP: number;
  maxHP: number;
  tempHP: number;
  damageDealt?: number;
  healingApplied?: number;
  becameUnconscious?: boolean;
  becameConscious?: boolean;
  error?: string;
}
