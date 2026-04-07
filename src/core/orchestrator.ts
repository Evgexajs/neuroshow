/**
 * Orchestrator - Main show execution engine
 * Based on PRD.md - Orchestrator responsibilities
 */

import { IStore } from '../types/interfaces/store.interface.js';
import { ModelAdapter, CharacterResponse } from '../types/adapter.js';
import { EventJournal } from './event-journal.js';
import { HostModule } from './host-module.js';
import { ContextBuilder } from './context-builder.js';
import { Phase } from '../types/template.js';
import { ShowEvent } from '../types/events.js';
import { EventType, ChannelType, SpeakFrequency, ShowStatus, CharacterIntent, BudgetMode } from '../types/enums.js';
import { generateId } from '../utils/id.js';
import { CharacterDefinition } from '../types/character.js';
import { Show } from '../types/runtime.js';
import { ResponseConstraints, PrivateChannelRules, DecisionConfig } from '../types/primitives.js';
import { logger } from '../utils/logger.js';

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

  /**
   * Process a single character's turn
   *
   * - Collects PromptPackage via ContextBuilder
   * - Calls adapter.call()
   * - Records 'speech' event in journal
   * - Updates token budget
   * - Returns CharacterResponse for further processing
   *
   * @param showId - Show ID
   * @param characterId - Character ID
   * @param trigger - The trigger/prompt for this turn
   * @returns CharacterResponse from the LLM
   */
  async processCharacterTurn(
    showId: string,
    characterId: string,
    trigger: string
  ): Promise<CharacterResponse> {
    // Get show record from store
    const showRecord = await this.store.getShow(showId);
    if (!showRecord) {
      throw new Error(`Show ${showId} not found`);
    }

    // Parse configSnapshot to get character definition
    const configSnapshot = JSON.parse(showRecord.configSnapshot) as Record<string, unknown>;
    const characterDefinitions = configSnapshot.characterDefinitions as Array<{
      id: string;
      name: string;
      publicCard: string;
      personalityPrompt: string;
      motivationPrompt: string;
      boundaryRules: string[];
      speakFrequency: string;
      responseConstraints: { maxTokens: number; format: string; language: string };
    }>;

    // Find the character definition
    const charDefData = characterDefinitions?.find((c) => c.id === characterId);
    if (!charDefData) {
      throw new Error(`Character definition for ${characterId} not found in configSnapshot`);
    }

    // Get character's current private context from store
    const showCharacter = await this.store.getCharacter(showId, characterId);
    if (!showCharacter) {
      throw new Error(`Character ${characterId} not found in show ${showId}`);
    }

    // Build CharacterDefinition with current private context
    const characterDefinition: CharacterDefinition = {
      id: charDefData.id,
      name: charDefData.name,
      publicCard: charDefData.publicCard,
      personalityPrompt: charDefData.personalityPrompt,
      motivationPrompt: charDefData.motivationPrompt,
      boundaryRules: charDefData.boundaryRules,
      startingPrivateContext: showCharacter.privateContext,
      speakFrequency: charDefData.speakFrequency as SpeakFrequency,
      responseConstraints: charDefData.responseConstraints as ResponseConstraints,
    };

    // Build Show object from record
    const show: Show = {
      id: showRecord.id,
      formatId: showRecord.formatId,
      seed: parseInt(showRecord.seed, 10),
      status: showRecord.status as ShowStatus,
      currentPhaseId: showRecord.currentPhaseId,
      startedAt: new Date(showRecord.startedAt ?? Date.now()),
      completedAt: showRecord.completedAt ? new Date(showRecord.completedAt) : null,
      configSnapshot: configSnapshot as Record<string, unknown>,
    };

    // Build PromptPackage via ContextBuilder
    const promptPackage = await this.contextBuilder.buildPromptPackage(
      characterDefinition,
      show,
      trigger
    );

    // Call the adapter to get response
    const response = await this.adapter.call(promptPackage);

    // Get all characters for audienceIds (speech is public)
    const characters = await this.store.getCharacters(showId);
    const allCharacterIds = characters.map((c) => c.characterId);

    // Record 'speech' event in journal
    const speechEvent: Omit<ShowEvent, 'sequenceNumber'> = {
      id: generateId(),
      showId,
      timestamp: Date.now(),
      phaseId: showRecord.currentPhaseId ?? '',
      type: EventType.speech,
      channel: ChannelType.PUBLIC,
      visibility: ChannelType.PUBLIC,
      senderId: characterId,
      receiverIds: allCharacterIds,
      audienceIds: allCharacterIds,
      content: response.text,
      metadata: {
        intent: response.intent,
        target: response.target,
        decisionValue: response.decisionValue,
      },
      seed: showRecord.seed,
    };

    await this.journal.append(speechEvent);

    // Update token budget
    const tokenEstimate = this.adapter.estimateTokens(promptPackage);
    await this.store.updateBudget(
      showId,
      tokenEstimate.prompt,
      tokenEstimate.estimatedCompletion
    );

    return response;
  }

  /**
   * Handle the intent from a character's response
   *
   * - 'speak': No additional action needed (speech event already created)
   * - 'request_private': Validates and opens private channel if allowed
   * - 'reveal_wildcard': Creates a 'revelation' event with the wildcard content
   * - 'end_turn': Logs the turn skip
   *
   * @param showId - Show ID
   * @param response - Character's response with intent
   * @param senderId - Character ID who sent the response
   */
  async handleIntent(
    showId: string,
    response: CharacterResponse,
    senderId: string
  ): Promise<void> {
    // If no intent, default to 'speak' (no action needed)
    if (!response.intent) {
      return;
    }

    switch (response.intent) {
      case CharacterIntent.speak:
        // Nothing additional needed - speech event already created in processCharacterTurn
        break;

      case CharacterIntent.request_private:
        await this.handleRequestPrivate(showId, senderId, response.target);
        break;

      case CharacterIntent.reveal_wildcard:
        await this.handleRevealWildcard(showId, senderId, response.text);
        break;

      case CharacterIntent.end_turn:
        this.handleEndTurn(senderId);
        break;

      // Non-MVP intents are silently ignored for now
      case CharacterIntent.request_to_speak:
      case CharacterIntent.request_interrupt:
        logger.debug(`Non-MVP intent ${response.intent} from ${senderId} ignored`);
        break;
    }
  }

  /**
   * Handle 'request_private' intent
   * Validates the request using HostModule and opens private channel if allowed
   */
  private async handleRequestPrivate(
    showId: string,
    requesterId: string,
    targetId: string | undefined
  ): Promise<void> {
    if (!targetId) {
      logger.warn(`request_private from ${requesterId} has no target, ignoring`);
      return;
    }

    // Get private channel rules from config snapshot
    const showRecord = await this.store.getShow(showId);
    if (!showRecord) {
      logger.error(`Show ${showId} not found when handling request_private`);
      return;
    }

    const configSnapshot = JSON.parse(showRecord.configSnapshot) as Record<string, unknown>;
    const rules = configSnapshot.privateChannelRules as PrivateChannelRules | undefined;

    if (!rules) {
      logger.warn(`No privateChannelRules found in config, denying request_private`);
      return;
    }

    // Validate the request through HostModule
    const isValid = await this.hostModule.validatePrivateRequest(
      showId,
      requesterId,
      targetId,
      rules
    );

    if (isValid) {
      // Open private channel between requester and target
      await this.hostModule.openPrivateChannel(showId, [requesterId, targetId]);
      logger.debug(`Private channel opened between ${requesterId} and ${targetId}`);
    } else {
      logger.debug(`Private channel request from ${requesterId} to ${targetId} denied (limit reached)`);
    }
  }

  /**
   * Handle 'reveal_wildcard' intent
   * Creates a 'revelation' event with the wildcard content
   */
  private async handleRevealWildcard(
    showId: string,
    senderId: string,
    wildcardContent: string
  ): Promise<void> {
    const showRecord = await this.store.getShow(showId);
    if (!showRecord) {
      logger.error(`Show ${showId} not found when handling reveal_wildcard`);
      return;
    }

    const seed = showRecord.seed;
    const phaseId = showRecord.currentPhaseId ?? '';

    // Get all characters for audienceIds (revelation is public)
    const characters = await this.store.getCharacters(showId);
    const allCharacterIds = characters.map((c) => c.characterId);

    // Create revelation event for the wildcard
    const revelationEvent: Omit<ShowEvent, 'sequenceNumber'> = {
      id: generateId(),
      showId,
      timestamp: Date.now(),
      phaseId,
      type: EventType.revelation,
      channel: ChannelType.PUBLIC,
      visibility: ChannelType.PUBLIC,
      senderId,
      receiverIds: allCharacterIds,
      audienceIds: allCharacterIds,
      content: wildcardContent,
      metadata: {
        isWildcard: true,
        revealedBy: senderId,
      },
      seed,
    };

    await this.journal.append(revelationEvent);
    logger.debug(`Wildcard revealed by ${senderId}: ${wildcardContent.substring(0, 50)}...`);
  }

  /**
   * Handle 'end_turn' intent
   * Logs that the character is ending their turn early
   */
  private handleEndTurn(senderId: string): void {
    logger.info(`Character ${senderId} ended their turn (skipped)`);
  }

  /**
   * Check token budget and return current mode.
   *
   * - At 80% usage: switches to 'budget_saving' mode
   * - At 100% usage: switches to 'graceful_finish' mode
   * - Creates 'system' events when mode changes
   * - In budget_saving mode: reduces maxTokens by 50%, limits privates
   *
   * @param showId - Show ID
   * @returns Current BudgetMode
   */
  async checkBudget(showId: string): Promise<BudgetMode> {
    const budget = await this.store.getBudget(showId);
    if (!budget) {
      logger.warn(`No budget found for show ${showId}, returning normal mode`);
      return BudgetMode.normal;
    }

    const totalUsed = budget.usedPrompt + budget.usedCompletion;
    const usagePercent = (totalUsed / budget.totalLimit) * 100;

    let newMode: BudgetMode;
    if (usagePercent >= 100) {
      newMode = BudgetMode.graceful_finish;
    } else if (usagePercent >= 80) {
      newMode = BudgetMode.budget_saving;
    } else {
      newMode = BudgetMode.normal;
    }

    // Only create event if mode is changing
    if (newMode !== budget.mode) {
      await this.store.setBudgetMode(showId, newMode);
      await this.createBudgetModeChangeEvent(showId, budget.mode, newMode, usagePercent);
      logger.info(
        `Budget mode changed for show ${showId}: ${budget.mode} -> ${newMode} (${usagePercent.toFixed(1)}% used)`
      );
    }

    return newMode;
  }

  /**
   * Create a 'system' event when budget mode changes
   */
  private async createBudgetModeChangeEvent(
    showId: string,
    oldMode: BudgetMode,
    newMode: BudgetMode,
    usagePercent: number
  ): Promise<void> {
    const showRecord = await this.store.getShow(showId);
    if (!showRecord) {
      return;
    }

    const characters = await this.store.getCharacters(showId);
    const allCharacterIds = characters.map((c) => c.characterId);

    const systemEvent: Omit<ShowEvent, 'sequenceNumber'> = {
      id: generateId(),
      showId,
      timestamp: Date.now(),
      phaseId: showRecord.currentPhaseId ?? '',
      type: EventType.system,
      channel: ChannelType.PUBLIC,
      visibility: ChannelType.PUBLIC,
      senderId: '',
      receiverIds: allCharacterIds,
      audienceIds: allCharacterIds,
      content: `Budget mode changed: ${oldMode} -> ${newMode}`,
      metadata: {
        budgetModeChange: true,
        oldMode,
        newMode,
        usagePercent,
      },
      seed: showRecord.seed,
    };

    await this.journal.append(systemEvent);
  }

  /**
   * Get response constraints adjusted for current budget mode.
   * In budget_saving mode, maxTokens is reduced by 50%.
   *
   * @param showId - Show ID
   * @param baseConstraints - Original response constraints
   * @returns Adjusted constraints based on budget mode
   */
  async getAdjustedConstraints(
    showId: string,
    baseConstraints: ResponseConstraints
  ): Promise<ResponseConstraints> {
    const mode = await this.checkBudget(showId);

    if (mode === BudgetMode.budget_saving) {
      return {
        ...baseConstraints,
        maxTokens: Math.floor(baseConstraints.maxTokens * 0.5),
      };
    }

    return baseConstraints;
  }

  /**
   * Check if private channels should be limited in current budget mode.
   * In budget_saving mode, privates are restricted.
   *
   * @param showId - Show ID
   * @returns true if private channels should be limited
   */
  async shouldLimitPrivates(showId: string): Promise<boolean> {
    const mode = await this.checkBudget(showId);
    return mode === BudgetMode.budget_saving || mode === BudgetMode.graceful_finish;
  }

  /**
   * Gracefully finish a show.
   *
   * - Completes the current turn
   * - Closes open private channels
   * - Skips remaining phases and runs Decision Phase
   * - Collects decisions and executes Revelation
   * - Creates a 'system' event with graceful_finish: true
   *
   * @param showId - Show ID
   */
  async gracefulFinish(showId: string): Promise<void> {
    // Get show record
    const showRecord = await this.store.getShow(showId);
    if (!showRecord) {
      throw new Error(`Show ${showId} not found`);
    }

    // Get all characters for event creation
    const characters = await this.store.getCharacters(showId);
    const allCharacterIds = characters.map((c) => c.characterId);
    const seed = showRecord.seed;
    const phaseId = showRecord.currentPhaseId ?? '';

    // Close open private channels
    await this.hostModule.closePrivateChannel(showId);

    // Get decisionConfig from configSnapshot
    const configSnapshot = JSON.parse(showRecord.configSnapshot) as Record<string, unknown>;
    const decisionConfig = configSnapshot.decisionConfig as DecisionConfig;

    // Run Decision Phase using callback for character decisions
    const decisionCallback = async (
      characterId: string,
      trigger: string,
      _previousDecisions: Array<{ characterId: string; decision: string }>
    ) => {
      return this.processCharacterTurn(showId, characterId, trigger);
    };

    await this.hostModule.runDecisionPhase(showId, decisionConfig, decisionCallback);

    // Run Revelation
    await this.hostModule.runRevelation(showId, decisionConfig);

    // Create 'system' event with graceful_finish: true
    const systemEvent: Omit<ShowEvent, 'sequenceNumber'> = {
      id: generateId(),
      showId,
      timestamp: Date.now(),
      phaseId,
      type: EventType.system,
      channel: ChannelType.PUBLIC,
      visibility: ChannelType.PUBLIC,
      senderId: '',
      receiverIds: allCharacterIds,
      audienceIds: allCharacterIds,
      content: 'Show ended via graceful finish',
      metadata: {
        graceful_finish: true,
      },
      seed,
    };

    await this.journal.append(systemEvent);

    // Update show status to completed
    await this.store.updateShow(showId, {
      status: ShowStatus.completed,
      completedAt: Date.now(),
    });

    logger.info(`Show ${showId} gracefully finished`);
  }
}
