/**
 * Neuroshow Character Types
 * Based on PRD.md Appendix A - TypeScript Interfaces
 *
 * CharacterDefinition: Complete definition of a character for use in a show
 */

import { PrivateContext } from './context.js';
import { ResponseConstraints } from './primitives.js';
import { SpeakFrequency } from './enums.js';

/**
 * Complete definition of a character
 *
 * Used to instantiate characters in a show. Contains both
 * public information (visible to other characters) and
 * private context (only visible to this character).
 */
export interface CharacterDefinition {
  /** Unique identifier for this character definition */
  id: string;

  /** Display name of the character */
  name: string;

  /** Public information visible to all participants */
  publicCard: string;

  /** Personality traits and behavior guidance for the LLM */
  personalityPrompt: string;

  /** Character's motivations and goals guidance for the LLM */
  motivationPrompt: string;

  /** Rules defining what the character will not do */
  boundaryRules: string[];

  /** Initial private context when the show starts */
  startingPrivateContext: PrivateContext;

  /** How often this character tends to speak */
  speakFrequency: SpeakFrequency;

  /** Constraints for LLM response generation */
  responseConstraints: ResponseConstraints;
}
