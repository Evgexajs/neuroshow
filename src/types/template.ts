/**
 * Neuroshow Template Types
 * Based on PRD.md Appendix A - TypeScript Interfaces
 *
 * Defines Phase and ShowFormatTemplate for show format configuration.
 */

import type { PhaseType, ChannelType } from './enums.js';
import type { DecisionConfig, PrivateChannelRules, DayConfig } from './primitives.js';

/**
 * Scoring rule for evaluating character performance (Non-MVP: structurally supported)
 */
export interface ScoringRule {
  id: string;
  description: string;
  condition: string;
  points: number;
}

/**
 * A phase within the show format
 */
export interface Phase {
  id: string;
  name: string;
  type: PhaseType;
  durationMode: 'turns' | 'timer' | 'condition';
  durationValue: number | string;
  turnOrder: 'sequential' | 'frequency_weighted' | 'host_controlled';
  allowedChannels: ChannelType[];
  triggerTemplate: string | null;
  completionCondition: string;
  dayIndex?: number;
  slotLabel?: string;
  /** Provocative conflict triggers for creating tension (30-50% chance to use instead of triggerTemplate) */
  conflictTriggers?: string[];
}

/**
 * Template defining the format and rules for a show
 */
export interface ShowFormatTemplate {
  id: string;
  name: string;
  description: string;
  minParticipants: number;
  maxParticipants: number;
  phases: Phase[];
  days?: DayConfig[];
  decisionConfig: DecisionConfig;
  channelTypes: ChannelType[];
  privateChannelRules: PrivateChannelRules;
  contextWindowSize: number;
  allowCharacterInitiative?: boolean;
  scoringRules?: ScoringRule[];
  winCondition?: string;
  /** Prologue/intro text explaining the game, prize, and rules to characters */
  prologue?: string;
}
