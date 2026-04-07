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
import { EventType, ChannelType, SpeakFrequency, ShowStatus, CharacterIntent, BudgetMode, PhaseType } from '../types/enums.js';
import { generateId } from '../utils/id.js';
import { CharacterDefinition } from '../types/character.js';
import { Show } from '../types/runtime.js';
import { ResponseConstraints, PrivateChannelRules, DecisionConfig } from '../types/primitives.js';
import { logger } from '../utils/logger.js';
import { ReplayAdapter } from '../adapters/replay-adapter.js';
import { OpenAIAdapter } from '../adapters/openai-adapter.js';
import { config } from '../config.js';

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

  /** DEBUG mode state: is execution currently paused? */
  private paused: boolean = false;

  /** Resolver function to signal that a step should proceed */
  private stepResolver: (() => void) | null = null;

  /** Promise that runShow waits on in DEBUG mode */
  private stepPromise: Promise<void> | null = null;

  /** Replay adapter used during replay mode */
  private _replayAdapter: ReplayAdapter | null = null;

  constructor(
    readonly store: IStore,
    readonly adapter: ModelAdapter,
    readonly journal: EventJournal,
    readonly hostModule: HostModule,
    readonly contextBuilder: ContextBuilder
  ) {}

  /**
   * Get the active adapter (replay adapter if in replay mode, otherwise normal adapter)
   */
  private get activeAdapter(): ModelAdapter {
    return this._replayAdapter ?? this.adapter;
  }

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
   * Set execution mode (AUTO or DEBUG)
   * @param mode - 'AUTO' for automatic execution, 'DEBUG' for step-by-step
   */
  setMode(mode: OrchestratorMode): void {
    this.mode = mode;
    logger.debug(`Orchestrator mode set to ${mode}`);
  }

  /**
   * Pause execution (only effective in DEBUG mode)
   * Suspends the show at the next step boundary
   */
  pause(): void {
    this.paused = true;
    logger.debug('Orchestrator paused');
  }

  /**
   * Resume execution after pause
   * Continues automatic execution until the show ends or pause() is called again
   */
  resume(): void {
    this.paused = false;
    // If we have a pending step resolver, trigger it to continue
    if (this.stepResolver) {
      this.stepResolver();
      this.stepResolver = null;
      this.stepPromise = null;
    }
    logger.debug('Orchestrator resumed');
  }

  /**
   * Execute one turn in DEBUG mode
   * Resolves the pending step and sets up for the next step
   * @returns Promise that resolves when the step is complete
   */
  async step(): Promise<void> {
    if (this.mode !== 'DEBUG') {
      logger.warn('step() called but mode is not DEBUG');
      return;
    }

    // Signal the current step to proceed
    if (this.stepResolver) {
      this.stepResolver();
      this.stepResolver = null;
      this.stepPromise = null;
    }
  }

  /**
   * Wait for step signal in DEBUG mode
   * @returns Promise that resolves when step() or resume() is called
   */
  private async waitForStep(): Promise<void> {
    if (this.mode !== 'DEBUG' || !this.paused) {
      return;
    }

    // Create a new promise that will be resolved by step() or resume()
    this.stepPromise = new Promise<void>((resolve) => {
      this.stepResolver = resolve;
    });

    await this.stepPromise;
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
  async runPhase(showId: string, phase: Phase, phaseIndex?: number, totalPhases?: number): Promise<void> {
    // Update internal state
    this.showId = showId;
    this.turnIndex = 0;

    // Get show record for seed and character names
    const showRecord = await this.store.getShow(showId);
    const seed = showRecord?.seed ?? '0';
    const configSnapshot = showRecord ? JSON.parse(showRecord.configSnapshot) as Record<string, unknown> : {};
    const characterDefinitions = (configSnapshot.characterDefinitions ?? []) as Array<{ id: string; name: string }>;
    const charNameMap = new Map(characterDefinitions.map((c) => [c.id, c.name]));

    // Get all characters for audienceIds
    const characters = await this.store.getCharacters(showId);
    const allCharacterIds = characters.map((c) => c.characterId);

    // Get turn order for this phase
    const turnQueue = await this.hostModule.manageTurnQueue(showId, phase);

    // Execute turns based on durationMode
    const turnsPerCharacter =
      phase.durationMode === 'turns' && typeof phase.durationValue === 'number'
        ? phase.durationValue
        : 1;
    const totalTurns = turnQueue.length * turnsPerCharacter;

    // Log phase start with timing
    const phaseNum = phaseIndex !== undefined ? phaseIndex + 1 : '?';
    const phasesTotal = totalPhases ?? '?';
    const phaseStartTime = Date.now();
    logger.info(`[Phase ${phaseNum}/${phasesTotal}] "${phase.name}" started (${totalTurns} turns expected)`);

    // Check for empty phase
    if (turnQueue.length === 0) {
      logger.warn(`[Phase ${phaseNum}/${phasesTotal}] "${phase.name}" is empty: no characters in turn queue (turnOrder: ${phase.turnOrder})`);
    }

    // Create phase_start event with progress metadata
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
        phaseIndex: phaseIndex ?? 0,
        totalPhases: totalPhases ?? 1,
        totalTurns,
      },
      seed,
    };
    await this.journal.append(phaseStartEvent);

    // Run turns until completion
    for (let round = 0; round < turnsPerCharacter; round++) {
      for (const characterId of turnQueue) {
        // Check completion condition
        if (this.isPhaseComplete(phase, this.turnIndex, totalTurns)) {
          break;
        }

        // Get character name for logging
        const charName = charNameMap.get(characterId) ?? characterId;

        // Log turn progress
        logger.info(`[Phase ${phaseNum}] Turn ${this.turnIndex + 1}/${totalTurns}: ${charName} responds`);

        // Trigger template only for first round, then empty - model continues from context
        const trigger = round === 0 ? (phase.triggerTemplate ?? '') : '';

        // Process character turn
        await this.processCharacterTurn(showId, characterId, trigger);

        // Increment turn index
        this.turnIndex++;
      }

      // Check completion condition after each round
      if (this.isPhaseComplete(phase, this.turnIndex, totalTurns)) {
        break;
      }
    }

    // Log phase end with timing
    const phaseElapsedMs = Date.now() - phaseStartTime;
    logger.info(`[Phase ${phaseNum}/${phasesTotal}] "${phase.name}" ended (${this.turnIndex} turns completed, ${phaseElapsedMs}ms)`);

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
        phaseIndex: phaseIndex ?? 0,
        totalPhases: totalPhases ?? 1,
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
   * Run a single phase with DEBUG mode support
   * Similar to runPhase but waits for step() before each turn in DEBUG mode
   *
   * @param showId - Show ID
   * @param phase - Phase configuration to run
   * @param phaseIndex - Index of current phase (for progress logging)
   * @param totalPhases - Total number of phases (for progress logging)
   */
  private async runPhaseWithDebug(showId: string, phase: Phase, phaseIndex?: number, totalPhases?: number): Promise<void> {
    // Update internal state
    this.showId = showId;
    this.turnIndex = 0;

    // Get show record for seed and character names
    const showRecord = await this.store.getShow(showId);
    const seed = showRecord?.seed ?? '0';
    const configSnapshot = showRecord ? JSON.parse(showRecord.configSnapshot) as Record<string, unknown> : {};
    const characterDefinitions = (configSnapshot.characterDefinitions ?? []) as Array<{ id: string; name: string }>;
    const charNameMap = new Map(characterDefinitions.map((c) => [c.id, c.name]));

    // Get all characters for audienceIds
    const characters = await this.store.getCharacters(showId);
    const allCharacterIds = characters.map((c) => c.characterId);

    // Get turn order for this phase
    const turnQueue = await this.hostModule.manageTurnQueue(showId, phase);

    // Execute turns based on durationMode
    const turnsPerCharacter =
      phase.durationMode === 'turns' && typeof phase.durationValue === 'number'
        ? phase.durationValue
        : 1;
    const totalTurns = turnQueue.length * turnsPerCharacter;

    // Log phase start with timing
    const phaseNum = phaseIndex !== undefined ? phaseIndex + 1 : '?';
    const phasesTotal = totalPhases ?? '?';
    const phaseStartTime = Date.now();
    logger.info(`[Phase ${phaseNum}/${phasesTotal}] "${phase.name}" started (${totalTurns} turns expected, DEBUG mode)`);

    // Check for empty phase
    if (turnQueue.length === 0) {
      logger.warn(`[Phase ${phaseNum}/${phasesTotal}] "${phase.name}" is empty: no characters in turn queue (turnOrder: ${phase.turnOrder})`);
    }

    // Create phase_start event with progress metadata
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
        phaseIndex: phaseIndex ?? 0,
        totalPhases: totalPhases ?? 1,
        totalTurns,
      },
      seed,
    };
    await this.journal.append(phaseStartEvent);

    // Run turns until completion
    for (let round = 0; round < turnsPerCharacter; round++) {
      for (const characterId of turnQueue) {
        // Check completion condition
        if (this.isPhaseComplete(phase, this.turnIndex, totalTurns)) {
          break;
        }

        // In DEBUG mode, wait for step() before each turn
        await this.waitForStep();

        // Get character name for logging
        const charName = charNameMap.get(characterId) ?? characterId;

        // Log turn progress
        logger.info(`[Phase ${phaseNum}] Turn ${this.turnIndex + 1}/${totalTurns}: ${charName} responds`);

        // Trigger template only for first round, then empty - model continues from context
        const trigger = round === 0 ? (phase.triggerTemplate ?? '') : '';

        // Process character turn
        await this.processCharacterTurn(showId, characterId, trigger);

        // Increment turn index
        this.turnIndex++;
      }

      // Check completion condition after each round
      if (this.isPhaseComplete(phase, this.turnIndex, totalTurns)) {
        break;
      }
    }

    // Log phase end with timing
    const phaseElapsedMs = Date.now() - phaseStartTime;
    logger.info(`[Phase ${phaseNum}/${phasesTotal}] "${phase.name}" ended (${this.turnIndex} turns completed, ${phaseElapsedMs}ms)`);

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
        phaseIndex: phaseIndex ?? 0,
        totalPhases: totalPhases ?? 1,
      },
      seed,
    };
    await this.journal.append(phaseEndEvent);
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
    // Use OpenAI adapter if configured, otherwise use the default adapter (mock)
    const llmCallStart = Date.now();
    let adapterToUse: ModelAdapter = this.activeAdapter;

    if (config.adapterMode === 'openai' && !this._replayAdapter) {
      adapterToUse = new OpenAIAdapter({
        apiKey: config.openaiApiKey,
        modelId: config.openaiDefaultModel,
        store: this.store,
        showId,
        characterId,
      });
    }

    const response = await adapterToUse.call(promptPackage);
    const llmCallMs = Date.now() - llmCallStart;
    logger.debug(`[LLM Call] ${characterId}: ${llmCallMs}ms (adapter: ${adapterToUse.providerId})`);

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

    // Update token budget (use same adapter that made the call)
    const tokenEstimate = adapterToUse.estimateTokens(promptPackage);
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

    // Fallback validation: prevent self-messaging
    if (targetId === requesterId) {
      logger.warn(`request_private from ${requesterId} targets self, ignoring`);
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
   * Run a complete show from start to finish.
   *
   * - Updates show status to 'running'
   * - Iterates through all phases from the template sequentially
   * - Calls runPhase() for regular phases
   * - Calls runDecisionPhase() for 'decision' type phases
   * - Checks budget before each turn (triggers gracefulFinish if needed)
   * - Runs revelation at the end
   * - Updates show status to 'completed'
   *
   * @param showId - Show ID to run
   */
  async runShow(showId: string): Promise<void> {
    // Get show record
    const showRecord = await this.store.getShow(showId);
    if (!showRecord) {
      throw new Error(`Show ${showId} not found`);
    }

    // Update internal state
    this.showId = showId;
    this.currentPhaseIndex = 0;

    // In DEBUG mode, start paused and wait for first step()
    if (this.mode === 'DEBUG') {
      this.paused = true;
      logger.debug(`Show ${showId} starting in DEBUG mode, waiting for step()`);
    }

    // Update show status to running
    await this.store.updateShow(showId, {
      status: ShowStatus.running,
      startedAt: Date.now(),
    });

    const showStartTime = Date.now();
    logger.info(`Show ${showId} started`);

    // Parse configSnapshot to get phases and decisionConfig
    const configSnapshot = JSON.parse(showRecord.configSnapshot) as Record<string, unknown>;
    const phases = configSnapshot.phases as Phase[];
    const decisionConfig = configSnapshot.decisionConfig as DecisionConfig;

    if (!phases || phases.length === 0) {
      throw new Error(`No phases found in show ${showId} configSnapshot`);
    }

    // Run all phases sequentially
    for (const [i, phase] of phases.entries()) {
      this.currentPhaseIndex = i;

      // In DEBUG mode, wait for step() or resume() before each phase
      await this.waitForStep();

      // Update currentPhaseId in show record
      await this.store.updateShow(showId, {
        currentPhaseId: phase.id,
      });

      // Check budget before running phase
      const budgetMode = await this.checkBudget(showId);
      if (budgetMode === BudgetMode.graceful_finish) {
        logger.info(`Budget exhausted for show ${showId}, triggering graceful finish`);
        await this.gracefulFinish(showId);
        return;
      }

      // Run the phase based on its type
      if (phase.type === PhaseType.decision) {
        // Decision phase uses special runDecisionPhase flow
        const decisionCallback = async (
          characterId: string,
          trigger: string,
          _previousDecisions: Array<{ characterId: string; decision: string }>
        ) => {
          // In DEBUG mode, wait for step() before each character turn
          if (this.mode === 'DEBUG') {
            await this.waitForStep();
          }
          return this.processCharacterTurn(showId, characterId, trigger);
        };
        await this.hostModule.runDecisionPhase(showId, decisionConfig, decisionCallback);
      } else {
        // Regular phases use runPhase (or runPhaseWithDebug in DEBUG mode)
        if (this.mode === 'DEBUG') {
          await this.runPhaseWithDebug(showId, phase, i, phases.length);
        } else {
          await this.runPhase(showId, phase, i, phases.length);
        }
      }
    }

    // Run revelation at the end
    await this.hostModule.runRevelation(showId, decisionConfig);

    // Update show status to completed
    await this.store.updateShow(showId, {
      status: ShowStatus.completed,
      completedAt: Date.now(),
    });

    const showElapsedMs = Date.now() - showStartTime;
    logger.info(`Show ${showId} completed (total time: ${showElapsedMs}ms)`);
  }

  /**
   * Rollback the orchestrator to the beginning of a specific phase (DEBUG mode).
   *
   * - Uses EventJournal.rollbackToPhase() to delete events from that phase onwards
   * - Resets orchestrator state (currentPhaseIndex, turnIndex) to the phase start
   * - Creates a 'system' event with metadata.rollback: true
   *
   * Note on Rerun mode: In Rerun scenarios, rollback creates a new branch of events.
   * The original events are deleted, and new events from the replayed phase onwards
   * form a divergent timeline from the rollback point.
   *
   * @param showId - Show ID
   * @param phaseId - Phase ID to rollback to
   */
  async rollbackToPhase(showId: string, phaseId: string): Promise<void> {
    // Get show record
    const showRecord = await this.store.getShow(showId);
    if (!showRecord) {
      throw new Error(`Show ${showId} not found`);
    }

    // Parse configSnapshot to find phase index
    const configSnapshot = JSON.parse(showRecord.configSnapshot) as Record<string, unknown>;
    const phases = configSnapshot.phases as Phase[];

    if (!phases) {
      throw new Error(`No phases found in show ${showId} configSnapshot`);
    }

    const phaseIndex = phases.findIndex((p) => p.id === phaseId);
    if (phaseIndex === -1) {
      throw new Error(`Phase ${phaseId} not found in show ${showId}`);
    }

    // Rollback events in journal (deletes events from the phase onwards)
    await this.journal.rollbackToPhase(showId, phaseId);

    // Reset orchestrator state to the beginning of the phase
    this.showId = showId;
    this.currentPhaseIndex = phaseIndex;
    this.turnIndex = 0;

    // Update show's currentPhaseId to the rollback target
    await this.store.updateShow(showId, {
      currentPhaseId: phaseId,
    });

    // Get all characters for the system event
    const characters = await this.store.getCharacters(showId);
    const allCharacterIds = characters.map((c) => c.characterId);
    const seed = showRecord.seed;

    // Create 'system' event with metadata.rollback: true
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
      content: `Rollback to phase "${phases[phaseIndex]!.name}"`,
      metadata: {
        rollback: true,
        targetPhaseId: phaseId,
        targetPhaseIndex: phaseIndex,
      },
      seed,
    };

    await this.journal.append(systemEvent);
    logger.info(`Show ${showId} rolled back to phase ${phaseId} (index ${phaseIndex})`);
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

  /**
   * Replay a completed show using stored LLM responses.
   *
   * Uses saved raw_response from llm_calls table instead of making
   * new LLM API calls. The result is identical to the original show run.
   *
   * Prerequisites:
   * - Show must exist and be in 'completed' status
   * - Show must have replayAvailable = true (or have llm_calls recorded)
   *
   * @param showId - Show ID to replay
   * @throws Error if show not found, not completed, or replay not available
   */
  async replayShow(showId: string): Promise<void> {
    // Get show record
    const showRecord = await this.store.getShow(showId);
    if (!showRecord) {
      throw new Error(`Show ${showId} not found`);
    }

    // Check if show is completed
    if (showRecord.status !== ShowStatus.completed) {
      throw new Error(`Show ${showId} is not completed (status: ${showRecord.status}). Only completed shows can be replayed.`);
    }

    // Check if llm_calls are available for replay
    const llmCalls = await this.store.getLLMCalls(showId);
    if (llmCalls.length === 0) {
      throw new Error(`Show ${showId} has no recorded LLM calls. Replay is not available.`);
    }

    logger.info(`Starting replay for show ${showId} with ${llmCalls.length} recorded LLM calls`);

    // Create and initialize ReplayAdapter
    const replayAdapter = new ReplayAdapter(this.store, showId);
    await replayAdapter.initialize();

    // Set the replay adapter
    this._replayAdapter = replayAdapter;

    try {
      // Clear all events for the show (rollback to beginning)
      await this.store.deleteEventsAfter(showId, 0);

      // Reset token budget to initial state
      const budget = await this.store.getBudget(showId);
      if (budget) {
        // Reset used tokens but keep the same total limit
        await this.store.updateBudget(showId, -budget.usedPrompt, -budget.usedCompletion);
        await this.store.setBudgetMode(showId, BudgetMode.normal);
      }

      // Reset show status to running
      await this.store.updateShow(showId, {
        status: ShowStatus.running,
        currentPhaseId: null,
        completedAt: null,
      });

      // Run the show (will use replay adapter via activeAdapter getter)
      // Note: We call the internal run logic directly since runShow expects
      // a non-running show. We've already reset the status.
      await this.executeShowRun(showId);

      // Mark show as replayAvailable (confirmed working replay)
      await this.store.updateShow(showId, {
        replayAvailable: true,
      });

      logger.info(`Replay completed for show ${showId}`);
    } finally {
      // Clear the replay adapter
      this._replayAdapter = null;
    }
  }

  /**
   * Internal method to execute show run logic.
   * Shared between runShow and replayShow.
   */
  private async executeShowRun(showId: string): Promise<void> {
    // Get show record
    const showRecord = await this.store.getShow(showId);
    if (!showRecord) {
      throw new Error(`Show ${showId} not found`);
    }

    // Update internal state
    this.showId = showId;
    this.currentPhaseIndex = 0;

    // In DEBUG mode, start paused and wait for first step()
    if (this.mode === 'DEBUG') {
      this.paused = true;
      logger.debug(`Show ${showId} starting in DEBUG mode, waiting for step()`);
    }

    // Update show status to running
    await this.store.updateShow(showId, {
      status: ShowStatus.running,
      startedAt: Date.now(),
    });

    const showStartTime = Date.now();
    logger.info(`Show ${showId} started`);

    // Parse configSnapshot to get phases and decisionConfig
    const configSnapshot = JSON.parse(showRecord.configSnapshot) as Record<string, unknown>;
    const phases = configSnapshot.phases as Phase[];
    const decisionConfig = configSnapshot.decisionConfig as DecisionConfig;

    if (!phases || phases.length === 0) {
      throw new Error(`No phases found in show ${showId} configSnapshot`);
    }

    // Run all phases sequentially
    for (const [i, phase] of phases.entries()) {
      this.currentPhaseIndex = i;

      // In DEBUG mode, wait for step() or resume() before each phase
      await this.waitForStep();

      // Update currentPhaseId in show record
      await this.store.updateShow(showId, {
        currentPhaseId: phase.id,
      });

      // Check budget before running phase
      const budgetMode = await this.checkBudget(showId);
      if (budgetMode === BudgetMode.graceful_finish) {
        logger.info(`Budget exhausted for show ${showId}, triggering graceful finish`);
        await this.gracefulFinish(showId);
        return;
      }

      // Run the phase based on its type
      if (phase.type === PhaseType.decision) {
        // Decision phase uses special runDecisionPhase flow
        const decisionCallback = async (
          characterId: string,
          trigger: string,
          _previousDecisions: Array<{ characterId: string; decision: string }>
        ) => {
          // In DEBUG mode, wait for step() before each character turn
          if (this.mode === 'DEBUG') {
            await this.waitForStep();
          }
          return this.processCharacterTurn(showId, characterId, trigger);
        };
        await this.hostModule.runDecisionPhase(showId, decisionConfig, decisionCallback);
      } else {
        // Regular phases use runPhase (or runPhaseWithDebug in DEBUG mode)
        if (this.mode === 'DEBUG') {
          await this.runPhaseWithDebug(showId, phase, i, phases.length);
        } else {
          await this.runPhase(showId, phase, i, phases.length);
        }
      }
    }

    // Run revelation at the end
    await this.hostModule.runRevelation(showId, decisionConfig);

    // Update show status to completed
    await this.store.updateShow(showId, {
      status: ShowStatus.completed,
      completedAt: Date.now(),
    });

    const showElapsedMs = Date.now() - showStartTime;
    logger.info(`Show ${showId} completed (total time: ${showElapsedMs}ms)`);
  }
}
