/**
 * Voting Module - handles decision phase and revelation
 * Extracted from HostModule as first example of modular architecture
 */

import { IStore } from '../../types/interfaces/store.interface.js';
import { EventJournal } from '../../core/event-journal.js';
import { DecisionConfig } from '../../types/primitives.js';
import { DecisionPhaseHandler } from './decision-phase.js';
import { IVotingModule, DecisionCallback, RevelationResult } from './types.js';

export const VOTING_MODULE_NAME = 'voting';

/**
 * VotingModule - implements IModule for voting/decision functionality
 */
export class VotingModule implements IVotingModule {
  readonly name = VOTING_MODULE_NAME;
  private handler: DecisionPhaseHandler;

  constructor(store: IStore, eventJournal: EventJournal) {
    this.handler = new DecisionPhaseHandler(store, eventJournal);
  }

  /**
   * Initialize the module
   * Called once when module is registered
   */
  async init(): Promise<void> {
    // No initialization needed for voting module
  }

  /**
   * Dispose the module and release resources
   * Called on shutdown or when module is unregistered
   */
  async dispose(): Promise<void> {
    // No resources to release
  }

  /**
   * Run the decision phase for all characters
   * @see DecisionPhaseHandler.runDecisionPhase
   */
  async runDecisionPhase(
    showId: string,
    decisionConfig: DecisionConfig,
    callCharacter: DecisionCallback
  ): Promise<void> {
    return this.handler.runDecisionPhase(showId, decisionConfig, callCharacter);
  }

  /**
   * Run revelation phase - reveal voting results
   * @see DecisionPhaseHandler.runRevelation
   */
  async runRevelation(showId: string, decisionConfig: DecisionConfig): Promise<RevelationResult> {
    return this.handler.runRevelation(showId, decisionConfig);
  }

  /**
   * Run tiebreaker revote between finalists
   * @see DecisionPhaseHandler.runTiebreaker
   */
  async runTiebreaker(
    showId: string,
    finalists: string[],
    decisionConfig: DecisionConfig,
    callCharacter: DecisionCallback
  ): Promise<void> {
    return this.handler.runTiebreaker(showId, finalists, decisionConfig, callCharacter);
  }

  /**
   * Run duel tiebreaker - finalists give speeches, then revote
   * @see DecisionPhaseHandler.runDuelTiebreaker
   */
  async runDuelTiebreaker(
    showId: string,
    finalists: string[],
    decisionConfig: DecisionConfig,
    callCharacter: DecisionCallback
  ): Promise<void> {
    return this.handler.runDuelTiebreaker(showId, finalists, decisionConfig, callCharacter);
  }

  /**
   * Run winner speech - winner gives victory speech after announcement
   * @see DecisionPhaseHandler.runWinnerSpeech
   */
  async runWinnerSpeech(
    showId: string,
    winnerName: string,
    callCharacter: DecisionCallback
  ): Promise<void> {
    return this.handler.runWinnerSpeech(showId, winnerName, callCharacter);
  }
}

// Re-export types for convenience
export { IVotingModule, DecisionCallback, RevelationResult } from './types.js';
