/**
 * Neuroshow Primitive Types
 * Based on PRD.md Appendix A - TypeScript Interfaces
 *
 * These are the foundational types used by other interfaces:
 * - CharacterDefinition uses ResponseConstraints
 * - PrivateContext uses AllianceRecord, WildcardRecord
 * - ShowFormatTemplate uses DecisionConfig, PrivateChannelRules, DayConfig
 */

/**
 * Constraints for LLM response generation
 */
export interface ResponseConstraints {
  maxTokens: number;
  format: 'free' | 'structured' | 'choice';
  language: string;
}

/**
 * Record of alliance between characters (pre-show agreements)
 */
export interface AllianceRecord {
  partnerId: string;
  agreement: string;
  isActive: boolean;
}

/**
 * Wildcard (secret information) that can be revealed strategically
 */
export interface WildcardRecord {
  content: string;
  isRevealed: boolean;
}

/**
 * Configuration for the decision phase
 */
export interface DecisionConfig {
  timing: 'simultaneous' | 'sequential';
  visibility: 'secret_until_reveal' | 'public_immediately';
  revealMoment: 'after_all' | 'after_each';
  format: 'choice' | 'free_text' | 'ranking';
  options: string[] | null;
}

/**
 * Rules for private channel communication
 */
export interface PrivateChannelRules {
  initiator: 'host_only' | 'character_request_host_approves' | 'character_free';
  maxPrivatesPerPhase: number;
  maxPrivatesPerCharacterPerPhase: number;
  requestQueueMode: 'fifo' | 'host_priority';
  requestFormat: 'public_ask' | 'structured_signal';
}

/**
 * Configuration for a "day" grouping of phases
 */
export interface DayConfig {
  dayIndex: number;
  label: string;
  phaseIds: string[];
}

/**
 * Type of secret mission for a character
 */
export type SecretMissionType =
  | 'rivalry'        // "Не дай {name} победить"
  | 'hidden_alliance' // "У тебя тайный союз с {name}"
  | 'betrayal'       // "В финале предай своего союзника"
  | 'information'    // "Узнай секрет {name} и используй против него"
  | 'manipulation';  // "Заставь {name} поссориться с {name2}"

/**
 * Secret mission assigned to a character
 */
export interface SecretMission {
  type: SecretMissionType;
  description: string;
  targetIds?: string[]; // Character IDs involved in the mission
}

/**
 * Type of relationship between characters
 */
export type RelationshipType =
  | 'romantic_history'
  | 'friendship'
  | 'rivalry'
  | 'family'
  | 'colleagues'
  | 'secret';

/**
 * Relationship between characters (pre-show history)
 */
export interface Relationship {
  id: string;
  type: RelationshipType;
  participantIds: [string, string];
  visibility: 'public' | 'private';
  description: string;
  knownBy: string[];
}
