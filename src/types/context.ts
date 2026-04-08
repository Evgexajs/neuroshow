/**
 * Neuroshow Context Types
 * Based on PRD.md Appendix A - TypeScript Interfaces
 *
 * PrivateContext: Character's internal state (secrets, alliances, goals, wildcards)
 * ContextLayers: Data structure for Context Builder
 */

import { AllianceRecord, WildcardRecord, SecretMission } from './primitives.js';
import { EventSummary } from './events.js';

/**
 * Character's private internal state
 *
 * Each character maintains their own private context that
 * includes information not visible to other characters:
 * - secrets: hidden information about the character
 * - alliances: pre-show agreements with other characters
 * - goals: character's objectives in the show
 * - wildcards: special information that can be strategically revealed
 */
export interface PrivateContext {
  /** Character's secrets (not visible to others) */
  secrets: string[];

  /** Pre-show alliances with other characters */
  alliances: AllianceRecord[];

  /** Character's goals and objectives */
  goals: string[];

  /** Wildcards that can be revealed strategically */
  wildcards: WildcardRecord[];

  /** Secret mission assigned to this character (optional, 30-50% of characters get one) */
  secretMission?: SecretMission;
}

/**
 * Context layers used by Context Builder to assemble prompts
 *
 * The Context Builder uses these layers to provide relevant
 * information to characters during the show:
 * - factsList: static facts that don't change during the show
 * - slidingWindow: recent events visible to the character
 * - summary: LLM-generated summary of older events (TASK-105)
 */
export interface ContextLayers {
  /** Static facts about the show format, rules, and character cards */
  factsList: string[];

  /** Recent events visible to this character (sliding window or buffer) */
  slidingWindow: EventSummary[];

  /** LLM-generated summary of older events (TASK-105: SummaryMemory) */
  summary?: string | null;
}
