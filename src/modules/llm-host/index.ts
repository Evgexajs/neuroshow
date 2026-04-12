/**
 * LLM Host Module - AI-ведущий шоу
 *
 * Manages show hosting through LLM-generated interventions:
 * - Comments on events, adding drama
 * - Asks questions to characters
 * - Makes announcements about show state
 * - Issues private directives (when enabled)
 *
 * Works on top of the deterministic HostModule, providing
 * "voice" and "personality" without controlling rules or decisions.
 */

import type { IStore } from '../../types/interfaces/store.interface.js';
import type { EventJournal } from '../../core/event-journal.js';
import type { ShowEvent } from '../../types/events.js';
import type { ModelAdapter } from '../../types/adapter.js';
import { EventType } from '../../types/enums.js';
import type {
  ILLMHostModule,
  LLMHostConfig,
  HostBudgetRecord,
  HostBudgetMode,
} from './types.js';
import { LLMHostAgent } from './llm-host-agent.js';
import { BudgetManager } from './budget-manager.js';
import { MockAdapter } from '../../adapters/mock-adapter.js';
import { OpenAIAdapter } from '../../adapters/openai-adapter.js';
import { config as appConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';

export const LLM_HOST_MODULE_NAME = 'llm-host';

/**
 * Default LLM Host configuration
 */
export const DEFAULT_LLM_HOST_CONFIG: LLMHostConfig = {
  hostEnabled: false,
  hostPersona: 'classic_host',
  hostModelAdapter: 'openai',
  hostModelId: 'gpt-4o-mini',

  hostBudget: 10000,
  hostBudgetSavingThreshold: 70,
  hostBudgetExhaustedThreshold: 90,

  interventionRules: [
    {
      trigger: 'phase_start',
      enabled: true,
      priority: 10,
      cooldownTurns: 0,
      interventionType: 'announcement',
      maxTokens: 150,
    },
    {
      trigger: 'phase_end',
      enabled: true,
      priority: 9,
      cooldownTurns: 0,
      interventionType: 'comment',
      maxTokens: 100,
    },
    {
      trigger: 'revelation',
      enabled: true,
      priority: 10,
      cooldownTurns: 0,
      interventionType: 'comment',
      maxTokens: 100,
    },
    {
      trigger: 'conflict_detected',
      enabled: true,
      priority: 7,
      cooldownTurns: 3,
      interventionType: 'question',
      maxTokens: 80,
      // Uses DEFAULT_CONFLICT_KEYWORDS when condition is not specified
    },
    {
      trigger: 'silence_detected',
      enabled: true,
      priority: 6,
      cooldownTurns: 5,
      interventionType: 'question',
      maxTokens: 80,
      condition: 'consecutiveEndTurns:3', // Trigger after 3 consecutive end_turn
    },
    {
      trigger: 'periodic_commentary',
      enabled: true,
      priority: 3,
      cooldownTurns: 5,
      interventionType: 'comment',
      maxTokens: 80,
    },
  ],
  interventionCooldown: 2,
  maxInterventionsPerPhase: 10,

  allowHostDirectives: false,
  maxDirectivesPerPhase: 2,
  maxDirectivesPerCharacter: 1,

  hostContextWindowSize: 10,
  verboseLogging: false,
};

/**
 * LLMHostModule - implements ILLMHostModule
 *
 * Coordinates LLM-powered show hosting:
 * - Evaluates triggers on each event
 * - Generates interventions via LLM
 * - Manages token budget across the show
 */
export class LLMHostModule implements ILLMHostModule {
  readonly name = LLM_HOST_MODULE_NAME;

  private config: LLMHostConfig | null = null;

  /** Cached LLMHostAgent instances per show */
  private agents: Map<string, LLMHostAgent> = new Map();

  /** Cached BudgetManager instances per show */
  private budgetManagers: Map<string, BudgetManager> = new Map();

  /** Cached ModelAdapter instances per show */
  private modelAdapters: Map<string, ModelAdapter> = new Map();

  constructor(
    private readonly store: IStore,
    private readonly eventJournal: EventJournal
  ) {}

  /**
   * Get the store instance (for use by subcomponents)
   * @internal
   */
  getStore(): IStore {
    return this.store;
  }

  /**
   * Get the event journal (for use by subcomponents)
   * @internal
   */
  getEventJournal(): EventJournal {
    return this.eventJournal;
  }

  /**
   * Initialize the module
   * Called once when module is registered
   */
  async init(): Promise<void> {
    // Module initialization - nothing special needed here
    // Agents and budgets are initialized per-show via initializeBudget()
    logger.debug('[LLMHostModule] Initialized');
  }

  /**
   * Dispose the module and release resources
   * Called on shutdown or when module is unregistered
   */
  async dispose(): Promise<void> {
    this.config = null;
    this.agents.clear();
    this.budgetManagers.clear();
    this.modelAdapters.clear();
    logger.debug('[LLMHostModule] Disposed');
  }

  /**
   * Called when a new event is appended to the journal
   * Evaluates triggers and potentially generates an intervention
   *
   * Flow:
   * 1. Check if host is enabled
   * 2. Get or create LLMHostAgent for this show
   * 3. Call shouldIntervene() to check triggers
   * 4. If yes, generate and emit intervention
   */
  async onEventAppended(event: ShowEvent): Promise<void> {
    // Check if config is set and host is enabled
    if (!this.config || !this.config.hostEnabled) {
      return;
    }

    // Don't process our own events (prevent infinite loop)
    if (event.type === EventType.host_trigger && this.isLLMHostEvent(event)) {
      return;
    }

    try {
      // Get or create agent for this show
      const agent = await this.getOrCreateAgent(event.showId);
      if (!agent) {
        return;
      }

      // Check if we should intervene
      const result = await agent.shouldIntervene(event);
      if (!result.shouldIntervene || !result.trigger) {
        if (this.config.verboseLogging && result.skipReason) {
          logger.debug(`[LLMHostModule] Skipped: ${result.skipReason}`);
        }
        return;
      }

      // Generate the intervention
      const response = await agent.generateIntervention(event.showId, result.trigger);

      // Emit the intervention as a ShowEvent
      const emittedEvent = await agent.emitIntervention(event.showId, response, result.trigger);

      if (this.config.verboseLogging) {
        logger.debug(
          `[LLMHostModule] Emitted intervention: ${emittedEvent.id} (type: ${response.interventionType})`
        );
      }
    } catch (error) {
      // Log error but don't throw - host failures shouldn't break the show
      logger.error('[LLMHostModule] Error processing event:', error);
    }
  }

  /**
   * Initialize budget for a show
   *
   * Creates budget record in store and sets up BudgetManager
   */
  async initializeBudget(showId: string, config: LLMHostConfig): Promise<void> {
    this.config = config;

    // Create BudgetManager for this show
    const budgetManager = new BudgetManager(this.store, config);
    this.budgetManagers.set(showId, budgetManager);

    // Initialize budget record in store
    await budgetManager.initialize(showId);

    if (config.verboseLogging) {
      logger.debug(`[LLMHostModule] Budget initialized for show ${showId}: ${config.hostBudget} tokens`);
    }
  }

  /**
   * Get current status of the host for a show
   *
   * Returns:
   * - budget: Current budget record
   * - interventionCount: Number of LLM host interventions emitted
   * - lastInterventionSequence: Sequence number of the last intervention
   */
  async getStatus(showId: string): Promise<{
    budget: HostBudgetRecord;
    interventionCount: number;
    lastInterventionSequence: number | null;
  }> {
    // Get budget from BudgetManager or store
    const budgetManager = this.budgetManagers.get(showId);
    let budget: HostBudgetRecord | null;
    if (budgetManager) {
      budget = await budgetManager.getBudget(showId);
    } else {
      budget = await this.store.getHostBudget(showId);
    }

    // If no budget found, use default
    const resolvedBudget: HostBudgetRecord = budget ?? {
      showId,
      totalLimit: this.config?.hostBudget ?? 10000,
      usedPrompt: 0,
      usedCompletion: 0,
      mode: 'normal' as HostBudgetMode,
      lastUpdated: Date.now(),
    };

    // Count LLM host interventions by querying events
    const events = await this.eventJournal.getEvents(showId);
    const hostInterventions = events.filter(
      (e) => e.type === EventType.host_trigger && this.isLLMHostEvent(e)
    );

    const interventionCount = hostInterventions.length;
    const lastInterventionSequence =
      hostInterventions.length > 0
        ? hostInterventions[hostInterventions.length - 1]!.sequenceNumber
        : null;

    return {
      budget: resolvedBudget,
      interventionCount,
      lastInterventionSequence,
    };
  }

  // ─── Helper Methods ─────────────────────────────────────────────────────────

  /**
   * Check if an event is from the LLM host (has interventionType metadata)
   */
  private isLLMHostEvent(event: ShowEvent): boolean {
    return (
      event.metadata !== undefined &&
      event.metadata !== null &&
      typeof event.metadata === 'object' &&
      'interventionType' in event.metadata
    );
  }

  /**
   * Get or create LLMHostAgent for a show
   */
  private async getOrCreateAgent(showId: string): Promise<LLMHostAgent | null> {
    // Return cached agent if exists
    if (this.agents.has(showId)) {
      return this.agents.get(showId)!;
    }

    // Need config to create agent
    if (!this.config) {
      return null;
    }

    // Get or create ModelAdapter
    const modelAdapter = this.getOrCreateModelAdapter(showId);

    // Create agent
    const agent = new LLMHostAgent(
      this.store,
      this.eventJournal,
      this.config,
      modelAdapter
    );

    this.agents.set(showId, agent);
    return agent;
  }

  /**
   * Get or create ModelAdapter for a show based on config
   */
  private getOrCreateModelAdapter(showId: string): ModelAdapter {
    // Return cached adapter if exists
    if (this.modelAdapters.has(showId)) {
      return this.modelAdapters.get(showId)!;
    }

    // Create adapter based on config
    const adapter = this.createModelAdapter(showId);
    this.modelAdapters.set(showId, adapter);
    return adapter;
  }

  /**
   * Create ModelAdapter based on hostModelAdapter config
   */
  private createModelAdapter(showId: string): ModelAdapter {
    const adapterType = this.config?.hostModelAdapter ?? 'mock';
    const modelId = this.config?.hostModelId ?? 'gpt-4o-mini';

    if (adapterType === 'openai') {
      return new OpenAIAdapter({
        apiKey: appConfig.openaiApiKey,
        modelId,
        store: this.store,
        showId,
        characterId: '__host__', // Special ID for host LLM calls
      });
    }

    // Default to MockAdapter for testing
    return new MockAdapter();
  }

  /**
   * Get the current configuration
   */
  getConfig(): LLMHostConfig | null {
    return this.config;
  }

  /**
   * Set the configuration
   */
  setConfig(config: LLMHostConfig): void {
    this.config = config;
  }
}

// Re-export types for convenience
export type {
  ILLMHostModule,
  LLMHostConfig,
  TriggerType,
  InterventionType,
  VoiceStyle,
  HostBudgetMode,
  InterventionRule,
  HostPersona,
  HostBudgetRecord,
  HostContext,
  HostInterventionResponse,
  EvaluatedTrigger,
  ConditionalTriggerContext,
} from './types.js';

// Re-export trigger evaluator utilities
export { MANDATORY_TRIGGERS, CONDITIONAL_TRIGGERS } from './trigger-evaluator.js';

// Re-export conditional trigger utilities
export {
  SilenceDetector,
  ConflictDetector,
  ConditionalTriggerEvaluator,
  parseCondition,
  DEFAULT_SILENCE_THRESHOLD,
  DEFAULT_CONFLICT_KEYWORDS,
  type ConditionalTriggerResult,
  type ParsedCondition,
} from './conditional-triggers.js';
