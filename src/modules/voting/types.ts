/**
 * Types for the voting module
 */

import { IModule } from '../../core/types/module.js';
import { CharacterResponse } from '../../types/adapter.js';
import { DecisionConfig } from '../../types/primitives.js';

/**
 * Callback type for collecting decisions from characters
 * Used by runDecisionPhase to call the LLM for each character
 */
export type DecisionCallback = (
  characterId: string,
  trigger: string,
  previousDecisions: Array<{ characterId: string; decision: string }>
) => Promise<CharacterResponse>;

/**
 * IVotingModule - interface for the voting module
 * Extends IModule with voting-specific methods
 */
export interface IVotingModule extends IModule {
  /**
   * Run the decision phase for all characters
   * Collects votes from each character and stores decision events
   *
   * @param showId - Show ID
   * @param decisionConfig - Configuration for decision phase
   * @param callCharacter - Callback to invoke LLM for each character
   */
  runDecisionPhase(
    showId: string,
    decisionConfig: DecisionConfig,
    callCharacter: DecisionCallback
  ): Promise<void>;

  /**
   * Run revelation phase - reveal voting results
   * Creates revelation events with vote counts and winner
   *
   * @param showId - Show ID
   * @param decisionConfig - Configuration for revelation
   */
  runRevelation(showId: string, decisionConfig: DecisionConfig): Promise<void>;
}
