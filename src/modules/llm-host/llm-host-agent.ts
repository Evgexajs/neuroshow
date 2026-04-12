/**
 * LLMHostAgent - Main agent class for LLM-powered show host
 *
 * HOST-008: Orchestrates all host components to generate interventions:
 * - TriggerEvaluator: Determines when to intervene
 * - BudgetManager: Tracks token usage and budget mode
 * - HostContextBuilder: Builds context for LLM
 * - Prompt templates: Generates system/user prompts
 * - ModelAdapter: Calls the LLM
 * - InterventionEmitter: Records interventions as events
 */

import type { IStore } from '../../types/interfaces/store.interface.js';
import type { EventJournal } from '../../core/event-journal.js';
import type { ShowEvent } from '../../types/events.js';
import type { ModelAdapter, PromptPackage } from '../../types/adapter.js';
import { HostBudgetMode, EventType } from '../../types/enums.js';
import type {
  LLMHostConfig,
  EvaluatedTrigger,
  HostInterventionResponse,
  HostPersona,
} from './types.js';

import { BudgetManager } from './budget-manager.js';
import { TriggerEvaluator, MANDATORY_TRIGGERS } from './trigger-evaluator.js';
import { HostContextBuilder } from './context-builder.js';
import { InterventionEmitter } from './intervention-emitter.js';
import { buildSystemPrompt, buildUserPrompt } from './prompt-templates.js';
import { resolvePersona } from './persona-presets.js';

// ─── Fallback Phrases ─────────────────────────────────────────────────────────

/**
 * Fallback phrases used when budget is exhausted
 * Will be expanded in HOST-016, but basic support is provided here
 */
const HOST_FALLBACK_PHRASES: Record<string, string[]> = {
  phase_start: [
    'Начинаем новый раунд.',
    'Продолжаем.',
    'Следующая фаза.',
  ],
  phase_end: [
    'Раунд завершён.',
    'Итак, подведём итоги.',
    'Время двигаться дальше.',
  ],
  revelation: [
    'Интересный поворот...',
    'Вот это да.',
    'Неожиданно.',
  ],
  default: [
    '...',
    'Продолжаем.',
  ],
};

/**
 * Get a random fallback phrase for a trigger type
 */
function getFallbackPhrase(triggerType: string): string {
  const phrases = HOST_FALLBACK_PHRASES[triggerType] ?? HOST_FALLBACK_PHRASES['default'];
  const fallbackPhrases = phrases ?? ['...'];
  return fallbackPhrases[Math.floor(Math.random() * fallbackPhrases.length)] as string;
}

// ─── LLMHostAgent ─────────────────────────────────────────────────────────────

/**
 * Result of shouldIntervene check
 */
export interface ShouldIntervenResult {
  /** Whether an intervention should happen */
  shouldIntervene: boolean;

  /** The evaluated trigger if intervention should happen */
  trigger: EvaluatedTrigger | null;

  /** Reason if intervention was skipped */
  skipReason?: string;
}

/**
 * LLMHostAgent orchestrates all components to generate host interventions
 */
export class LLMHostAgent {
  private readonly budgetManager: BudgetManager;
  private readonly triggerEvaluator: TriggerEvaluator;
  private readonly contextBuilder: HostContextBuilder;
  private readonly interventionEmitter: InterventionEmitter;
  private readonly persona: HostPersona;
  private readonly eventJournal: EventJournal;

  constructor(
    store: IStore,
    eventJournal: EventJournal,
    private readonly config: LLMHostConfig,
    private readonly modelAdapter: ModelAdapter
  ) {
    // Store event journal reference for directive counting
    this.eventJournal = eventJournal;

    // Initialize all sub-components (store and eventJournal are passed to them)
    this.budgetManager = new BudgetManager(store, config);
    this.triggerEvaluator = new TriggerEvaluator(store, config);
    this.contextBuilder = new HostContextBuilder(store, config);
    this.interventionEmitter = new InterventionEmitter(store, eventJournal);

    // Resolve persona once at construction
    this.persona = resolvePersona(config.hostPersona);
  }

  /**
   * Determine if we should intervene for the given event
   *
   * Checks:
   * 1. Is host enabled?
   * 2. Does the event match any trigger?
   * 3. Is the budget mode allowing this trigger?
   *
   * @param event - The event to evaluate
   * @returns ShouldIntervenResult with trigger if we should intervene
   */
  async shouldIntervene(event: ShowEvent): Promise<ShouldIntervenResult> {
    // Check if host is enabled
    if (!this.config.hostEnabled) {
      return {
        shouldIntervene: false,
        trigger: null,
        skipReason: 'Host is disabled',
      };
    }

    // Evaluate trigger
    const trigger = await this.triggerEvaluator.evaluate(event);
    if (!trigger) {
      return {
        shouldIntervene: false,
        trigger: null,
        skipReason: 'No matching trigger',
      };
    }

    // Check budget mode
    const budgetMode = await this.budgetManager.getMode(event.showId);

    // In exhausted mode, skip all but mandatory triggers (which will use fallback)
    if (budgetMode === HostBudgetMode.exhausted) {
      if (!MANDATORY_TRIGGERS.has(trigger.type)) {
        return {
          shouldIntervene: false,
          trigger: null,
          skipReason: 'Budget exhausted, non-mandatory trigger skipped',
        };
      }
      // Mandatory triggers still proceed but will use fallback
    }

    // In saving mode, skip non-mandatory triggers
    if (budgetMode === HostBudgetMode.saving) {
      if (!MANDATORY_TRIGGERS.has(trigger.type)) {
        return {
          shouldIntervene: false,
          trigger: null,
          skipReason: 'Budget in saving mode, non-mandatory trigger skipped',
        };
      }
    }

    return {
      shouldIntervene: true,
      trigger,
    };
  }

  /**
   * Generate an intervention using the LLM
   *
   * Steps:
   * 1. Check directive permissions (if private_directive)
   * 2. Build context
   * 3. Build prompts
   * 4. Estimate tokens
   * 5. Call LLM (or use fallback if exhausted)
   * 6. Update budget
   *
   * @param showId - Show ID
   * @param trigger - The evaluated trigger
   * @returns HostInterventionResponse with generated text
   */
  async generateIntervention(
    showId: string,
    trigger: EvaluatedTrigger
  ): Promise<HostInterventionResponse> {
    // Check directive permissions if this is a private_directive intervention
    if (trigger.rule.interventionType === 'private_directive') {
      const directiveCheck = await this.checkDirectivePermissions(showId, trigger);
      if (!directiveCheck.allowed) {
        if (this.config.verboseLogging) {
          console.log(`[LLMHostAgent] Directive blocked: ${directiveCheck.reason}`);
        }
        // Return a comment instead of directive when blocked
        return this.generateFallbackIntervention(trigger);
      }
    }

    // Check if budget is exhausted - use fallback
    const budgetMode = await this.budgetManager.getMode(showId);
    if (budgetMode === HostBudgetMode.exhausted) {
      return this.generateFallbackIntervention(trigger);
    }

    // Build context
    const context = await this.contextBuilder.build(showId, trigger);

    // Build prompts
    const systemPrompt = buildSystemPrompt(this.persona, context, this.config);
    const userPrompt = buildUserPrompt(context, trigger.rule);

    // Create prompt package for ModelAdapter
    const promptPackage: PromptPackage = {
      systemPrompt,
      contextLayers: {
        factsList: [],
        slidingWindow: [],
      },
      trigger: userPrompt,
      responseConstraints: {
        maxTokens: trigger.rule.maxTokens,
        format: 'free',
        language: 'ru',
      },
    };

    // Estimate tokens before calling
    const tokenEstimate = this.modelAdapter.estimateTokens(promptPackage);
    const estimatedTotal = tokenEstimate.prompt + tokenEstimate.estimatedCompletion;

    // Check if we have enough budget
    const budget = await this.budgetManager.getBudget(showId);
    if (budget) {
      const remaining = budget.totalLimit - (budget.usedPrompt + budget.usedCompletion);
      if (estimatedTotal > remaining) {
        // Not enough budget, use fallback
        if (this.config.verboseLogging) {
          console.log(
            `[LLMHostAgent] Insufficient budget (need ${estimatedTotal}, have ${remaining}), using fallback`
          );
        }
        return this.generateFallbackIntervention(trigger);
      }
    }

    // Call the LLM
    if (this.config.verboseLogging) {
      console.log(`[LLMHostAgent] Calling LLM for trigger: ${trigger.type}`);
    }

    const response = await this.modelAdapter.call(promptPackage);

    // Update budget with actual token usage
    // Note: We use estimates since actual usage isn't returned by the adapter interface
    // In a real implementation, the adapter might track actual usage
    await this.budgetManager.consume(
      showId,
      tokenEstimate.prompt,
      tokenEstimate.estimatedCompletion
    );

    if (this.config.verboseLogging) {
      console.log(`[LLMHostAgent] Generated intervention: ${response.text.substring(0, 50)}...`);
    }

    // Return as HostInterventionResponse
    return {
      text: response.text,
      interventionType: trigger.rule.interventionType,
      targetCharacterId: response.target,
    };
  }

  /**
   * Emit an intervention as a ShowEvent
   *
   * @param showId - Show ID
   * @param response - The generated intervention response
   * @param trigger - The trigger that caused this intervention
   * @returns The emitted ShowEvent
   */
  async emitIntervention(
    showId: string,
    response: HostInterventionResponse,
    trigger: EvaluatedTrigger
  ): Promise<ShowEvent> {
    // Emit the intervention event
    const event = await this.interventionEmitter.emit(showId, response, trigger);

    // Record trigger activation for cooldown tracking
    await this.triggerEvaluator.recordTriggerActivation(
      showId,
      trigger.type,
      event.sequenceNumber
    );

    if (this.config.verboseLogging) {
      console.log(
        `[LLMHostAgent] Emitted intervention ${event.id} (seq: ${event.sequenceNumber})`
      );
    }

    return event;
  }

  /**
   * Generate a fallback intervention when LLM cannot be called
   *
   * @param trigger - The trigger that caused this intervention
   * @returns HostInterventionResponse with fallback text
   */
  private generateFallbackIntervention(
    trigger: EvaluatedTrigger
  ): HostInterventionResponse {
    const fallbackText = getFallbackPhrase(trigger.type);

    if (this.config.verboseLogging) {
      console.log(`[LLMHostAgent] Using fallback phrase for ${trigger.type}: ${fallbackText}`);
    }

    return {
      text: fallbackText,
      interventionType: trigger.rule.interventionType,
      // No target for fallback interventions
    };
  }

  // ─── Directive Validation ─────────────────────────────────────────────────────

  /**
   * Check if a private directive is allowed
   *
   * Validates:
   * 1. allowHostDirectives is true
   * 2. maxDirectivesPerPhase limit not exceeded
   * 3. maxDirectivesPerCharacter limit not exceeded for target
   *
   * @param showId - Show ID
   * @param trigger - The evaluated trigger
   * @returns Object with allowed flag and reason if blocked
   */
  private async checkDirectivePermissions(
    showId: string,
    trigger: EvaluatedTrigger
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Check if directives are enabled
    if (!this.config.allowHostDirectives) {
      return {
        allowed: false,
        reason: 'allowHostDirectives is false',
      };
    }

    // Get current phase ID from trigger event or context
    const currentPhaseId = trigger.triggerEvent?.phaseId;

    // Count directives in current phase
    const phaseDirectiveCount = await this.countDirectivesInPhase(showId, currentPhaseId);
    if (phaseDirectiveCount >= this.config.maxDirectivesPerPhase) {
      return {
        allowed: false,
        reason: `maxDirectivesPerPhase (${this.config.maxDirectivesPerPhase}) exceeded`,
      };
    }

    // Get target character ID from conditional context (for silence_detected)
    // or we'll get it from the LLM response later
    const targetCharacterId = trigger.conditionalContext?.silentCharacterId;
    if (targetCharacterId) {
      const characterDirectiveCount = await this.countDirectivesForCharacter(
        showId,
        targetCharacterId
      );
      if (characterDirectiveCount >= this.config.maxDirectivesPerCharacter) {
        return {
          allowed: false,
          reason: `maxDirectivesPerCharacter (${this.config.maxDirectivesPerCharacter}) exceeded for ${targetCharacterId}`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Count private_directive interventions in a specific phase
   *
   * @param showId - Show ID
   * @param phaseId - Optional phase ID (counts all if not specified)
   * @returns Number of directives in the phase
   */
  private async countDirectivesInPhase(
    showId: string,
    phaseId?: string
  ): Promise<number> {
    const events = await this.eventJournal.getEvents(showId);
    return events.filter((e) => {
      if (e.type !== EventType.host_trigger) return false;
      if (e.metadata?.interventionType !== 'private_directive') return false;
      if (phaseId && e.phaseId !== phaseId) return false;
      return true;
    }).length;
  }

  /**
   * Count private_directive interventions for a specific character
   *
   * @param showId - Show ID
   * @param characterId - Character ID
   * @returns Number of directives sent to the character
   */
  private async countDirectivesForCharacter(
    showId: string,
    characterId: string
  ): Promise<number> {
    const events = await this.eventJournal.getEvents(showId);
    return events.filter((e) => {
      if (e.type !== EventType.host_trigger) return false;
      if (e.metadata?.interventionType !== 'private_directive') return false;
      if (e.metadata?.targetCharacterId !== characterId) return false;
      return true;
    }).length;
  }

  // ─── Accessors ────────────────────────────────────────────────────────────────

  /**
   * Get the BudgetManager instance
   * Useful for external status queries
   */
  getBudgetManager(): BudgetManager {
    return this.budgetManager;
  }

  /**
   * Get the TriggerEvaluator instance
   * Useful for external trigger queries
   */
  getTriggerEvaluator(): TriggerEvaluator {
    return this.triggerEvaluator;
  }

  /**
   * Get the resolved persona
   */
  getPersona(): HostPersona {
    return this.persona;
  }
}
