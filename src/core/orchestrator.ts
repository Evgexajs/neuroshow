/**
 * Orchestrator - Main show execution engine
 * Based on PRD.md - Orchestrator responsibilities
 */

import { IStore } from '../types/interfaces/store.interface.js';
import { ModelAdapter } from '../types/adapter.js';
import { EventJournal } from './event-journal.js';
import { HostModule } from './host-module.js';
import { ContextBuilder } from './context-builder.js';
import { Phase } from '../types/template.js';
import { ShowEvent } from '../types/events.js';
import { EventType, ChannelType } from '../types/enums.js';
import { generateId } from '../utils/id.js';

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

  /**
   * Run a single phase of the show
   * - Creates phase_start event
   * - Executes turns according to turnOrder until completionCondition is met
   * - Creates phase_end event
   *
   * @param showId - Show ID
   * @param phase - Phase configuration to run
   */
  async runPhase(showId: string, phase: Phase): Promise<void> {
    // Update internal state
    this.showId = showId;
    this.turnIndex = 0;

    // Get show record for seed
    const showRecord = await this.store.getShow(showId);
    const seed = showRecord?.seed ?? '0';

    // Get all characters for audienceIds
    const characters = await this.store.getCharacters(showId);
    const allCharacterIds = characters.map((c) => c.characterId);

    // Create phase_start event
    const phaseStartEvent: Omit<ShowEvent, 'sequenceNumber'> = {
      id: generateId(),
      showId,
      timestamp: Date.now(),
      phaseId: phase.id,
      type: EventType.phase_start,
      channel: ChannelType.PUBLIC,
      visibility: ChannelType.PUBLIC,
      senderId: '',
      receiverIds: allCharacterIds,
      audienceIds: allCharacterIds,
      content: `Phase "${phase.name}" started`,
      metadata: {
        phaseType: phase.type,
        durationMode: phase.durationMode,
        durationValue: phase.durationValue,
        turnOrder: phase.turnOrder,
      },
      seed,
    };
    await this.journal.append(phaseStartEvent);

    // Get turn order for this phase
    const turnQueue = await this.hostModule.manageTurnQueue(showId, phase);

    // Execute turns based on durationMode
    const turnsPerCharacter =
      phase.durationMode === 'turns' && typeof phase.durationValue === 'number'
        ? phase.durationValue
        : 1;

    // Run turns until completion
    for (let round = 0; round < turnsPerCharacter; round++) {
      for (const _characterId of turnQueue) {
        // Check completion condition
        if (this.isPhaseComplete(phase, this.turnIndex, turnQueue.length * turnsPerCharacter)) {
          break;
        }

        // Increment turn index (actual character turn processing will be in processCharacterTurn)
        this.turnIndex++;
      }

      // Check completion condition after each round
      if (this.isPhaseComplete(phase, this.turnIndex, turnQueue.length * turnsPerCharacter)) {
        break;
      }
    }

    // Create phase_end event
    const phaseEndEvent: Omit<ShowEvent, 'sequenceNumber'> = {
      id: generateId(),
      showId,
      timestamp: Date.now(),
      phaseId: phase.id,
      type: EventType.phase_end,
      channel: ChannelType.PUBLIC,
      visibility: ChannelType.PUBLIC,
      senderId: '',
      receiverIds: allCharacterIds,
      audienceIds: allCharacterIds,
      content: `Phase "${phase.name}" ended`,
      metadata: {
        totalTurns: this.turnIndex,
        completionCondition: phase.completionCondition,
      },
      seed,
    };
    await this.journal.append(phaseEndEvent);
  }

  /**
   * Check if phase completion condition is met
   * @param phase - Phase configuration
   * @param currentTurn - Current turn index
   * @param totalTurns - Total expected turns
   * @returns true if phase should end
   */
  private isPhaseComplete(phase: Phase, currentTurn: number, totalTurns: number): boolean {
    // For 'turns' mode, complete when all turns are done
    if (phase.durationMode === 'turns') {
      return currentTurn >= totalTurns;
    }

    // For 'condition' mode, check the completionCondition string
    if (phase.completionCondition === 'turns_complete') {
      return currentTurn >= totalTurns;
    }

    // Default: complete when turns are done
    return currentTurn >= totalTurns;
  }
}
