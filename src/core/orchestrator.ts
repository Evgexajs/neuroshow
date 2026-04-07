/**
 * Orchestrator - Main show execution engine
 * Based on PRD.md - Orchestrator responsibilities
 */

import { IStore } from '../types/interfaces/store.interface.js';
import { ModelAdapter } from '../types/adapter.js';
import { EventJournal } from './event-journal.js';
import { HostModule } from './host-module.js';
import { ContextBuilder } from './context-builder.js';

/**
 * Orchestrator execution mode
 * - AUTO: Runs phases automatically without human intervention
 * - DEBUG: Allows step-by-step execution and rollback
 */
export type OrchestratorMode = 'AUTO' | 'DEBUG';

/**
 * Orchestrator runtime state
 */
export interface OrchestratorState {
  /** Current show ID (null if no show is running) */
  showId: string | null;

  /** Index of current phase in template.phases array */
  currentPhaseIndex: number;

  /** Index of current turn within the phase */
  turnIndex: number;

  /** Execution mode */
  mode: OrchestratorMode;
}

/**
 * Orchestrator is the main execution engine for running shows.
 *
 * Responsibilities:
 * - Coordinates all modules (Store, Adapter, Journal, Host, ContextBuilder)
 * - Manages show execution state
 * - Runs phases and processes character turns
 * - Handles budget monitoring and graceful finish
 */
export class Orchestrator {
  private showId: string | null = null;
  private currentPhaseIndex: number = 0;
  private turnIndex: number = 0;
  private mode: OrchestratorMode = 'AUTO';

  constructor(
    readonly store: IStore,
    readonly adapter: ModelAdapter,
    readonly journal: EventJournal,
    readonly hostModule: HostModule,
    readonly contextBuilder: ContextBuilder
  ) {}

  /**
   * Get current orchestrator state
   * @returns OrchestratorState with current execution state
   */
  getState(): OrchestratorState {
    return {
      showId: this.showId,
      currentPhaseIndex: this.currentPhaseIndex,
      turnIndex: this.turnIndex,
      mode: this.mode,
    };
  }
}
