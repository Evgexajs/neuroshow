/**
 * Types for the voting module
 */

import { IModule } from '../../core/types/module.js';
import { CharacterResponse } from '../../types/adapter.js';
import { DecisionConfig } from '../../types/primitives.js';

/**
 * Result of runRevelation - indicates if tiebreaker is needed
 */
export interface RevelationResult {
  /** Finalists if tie detected and revote mode, undefined otherwise */
  tiebreakerNeeded?: string[];
  /** Winner name if determined, undefined if tie */
  winner?: string;
}

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
   * Returns tiebreakerNeeded with finalists if revote mode and tie detected
   *
   * @param showId - Show ID
   * @param decisionConfig - Configuration for revelation
   * @returns RevelationResult with tiebreakerNeeded if revote required
   */
  runRevelation(showId: string, decisionConfig: DecisionConfig): Promise<RevelationResult>;

  /**
   * Run tiebreaker revote between finalists
   * Only non-finalists vote, only for finalists
   * If still tied, random selection is used
   *
   * @param showId - Show ID
   * @param finalists - Array of finalist names (tied candidates)
   * @param decisionConfig - Configuration for decision phase
   * @param callCharacter - Callback to invoke LLM for each voter
   */
  runTiebreaker(
    showId: string,
    finalists: string[],
    decisionConfig: DecisionConfig,
    callCharacter: DecisionCallback
  ): Promise<void>;

  /**
   * Run duel tiebreaker - finalists give final speeches, then revote
   * Each finalist gets 1 turn to convince others why they deserve to win
   * After speeches, runs revote
   *
   * @param showId - Show ID
   * @param finalists - Array of finalist names (tied candidates)
   * @param decisionConfig - Configuration for decision phase
   * @param callCharacter - Callback to invoke LLM for each character
   */
  runDuelTiebreaker(
    showId: string,
    finalists: string[],
    decisionConfig: DecisionConfig,
    callCharacter: DecisionCallback
  ): Promise<void>;

  /**
   * Run winner speech - winner gives victory speech after announcement
   * Creates winner_speech event with gratitude and plans
   *
   * @param showId - Show ID
   * @param winnerName - Name of the winner
   * @param callCharacter - Callback to invoke LLM for winner
   */
  runWinnerSpeech(
    showId: string,
    winnerName: string,
    callCharacter: DecisionCallback
  ): Promise<void>;

  /**
   * Run loser reactions - each loser reacts to the result
   * Creates loser_reaction events for each non-winner
   *
   * @param showId - Show ID
   * @param winnerName - Name of the winner
   * @param callCharacter - Callback to invoke LLM for each loser
   */
  runLoserReactions(
    showId: string,
    winnerName: string,
    callCharacter: DecisionCallback
  ): Promise<void>;
}
