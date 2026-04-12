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
import type {
  ILLMHostModule,
  LLMHostConfig,
  HostBudgetRecord,
  HostBudgetMode,
} from './types.js';

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
    },
    {
      trigger: 'silence_detected',
      enabled: true,
      priority: 6,
      cooldownTurns: 5,
      interventionType: 'question',
      maxTokens: 80,
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
 * This is the base module structure. Full implementation will be added
 * in subsequent tasks (HOST-003 through HOST-009).
 */
export class LLMHostModule implements ILLMHostModule {
  readonly name = LLM_HOST_MODULE_NAME;

  private config: LLMHostConfig | null = null;

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
    // Initialization will be implemented in HOST-009
  }

  /**
   * Dispose the module and release resources
   * Called on shutdown or when module is unregistered
   */
  async dispose(): Promise<void> {
    this.config = null;
  }

  /**
   * Called when a new event is appended to the journal
   * Evaluates triggers and potentially generates an intervention
   *
   * Implementation in HOST-009
   */
  async onEventAppended(_event: ShowEvent): Promise<void> {
    // Will be implemented in HOST-009
    // For now, this is a no-op placeholder
  }

  /**
   * Initialize budget for a show
   *
   * Implementation in HOST-002/HOST-003
   */
  async initializeBudget(showId: string, config: LLMHostConfig): Promise<void> {
    this.config = config;

    // Store operation will be implemented in HOST-002
    // For now, just validate config is set
    void showId; // Will be used in HOST-002
  }

  /**
   * Get current status of the host for a show
   *
   * Implementation in HOST-009
   */
  async getStatus(showId: string): Promise<{
    budget: HostBudgetRecord;
    interventionCount: number;
    lastInterventionSequence: number | null;
  }> {
    // Placeholder implementation
    return {
      budget: {
        showId,
        totalLimit: this.config?.hostBudget ?? 10000,
        usedPrompt: 0,
        usedCompletion: 0,
        mode: 'normal' as HostBudgetMode,
        lastUpdated: Date.now(),
      },
      interventionCount: 0,
      lastInterventionSequence: null,
    };
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
} from './types.js';
