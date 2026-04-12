/**
 * Types for the LLM Host module
 * AI-ведущий - LLM агент который управляет шоу, задаёт вопросы, раскрывает секреты
 *
 * Based on PRD-llm-host.md
 */

import type { IModule } from '../../core/types/module.js';
import type { Phase } from '../../types/template.js';
import type { ShowEvent, EventSummary } from '../../types/events.js';

// ─── Trigger Types ────────────────────────────────────────────────────────────

/**
 * Types of triggers that activate the LLM host
 * Mandatory: phase_start, phase_end, revelation, wildcard_reveal (always trigger)
 * Conditional: conflict_detected, alliance_hint, etc. (trigger when condition is met)
 * Periodic: periodic_commentary, phase_midpoint (trigger at intervals)
 */
export type TriggerType =
  | 'phase_start'
  | 'phase_end'
  | 'revelation'
  | 'wildcard_reveal'
  | 'conflict_detected'
  | 'alliance_hint'
  | 'silence_detected'
  | 'budget_milestone'
  | 'dramatic_moment'
  | 'private_channel_open'
  | 'private_channel_close'
  | 'periodic_commentary'
  | 'phase_midpoint';

// ─── Intervention Types ───────────────────────────────────────────────────────

/**
 * Types of interventions the LLM host can make
 *
 * - comment: Add atmosphere, drama without requiring response
 * - question: Direct question to a character, requires response
 * - announcement: Information about show state, rules, results
 * - private_directive: Secret instruction to a character (requires allowHostDirectives)
 */
export type InterventionType = 'comment' | 'question' | 'announcement' | 'private_directive';

// ─── Voice Style ──────────────────────────────────────────────────────────────

/**
 * Voice style for the host persona
 */
export type VoiceStyle =
  | 'professional' // Neutral, business-like
  | 'dramatic' // Emotional, theatrical
  | 'ironic' // Ironic, with jabs
  | 'warm' // Friendly, supportive
  | 'provocative'; // Provocative, edgy

// ─── Budget Mode ──────────────────────────────────────────────────────────────

/**
 * Budget mode for token spending
 *
 * - normal: All interventions allowed (0-70% usage)
 * - saving: Only mandatory triggers (70-90% usage)
 * - exhausted: Host is silent, fallback phrases used (90%+ usage)
 */
export type HostBudgetMode = 'normal' | 'saving' | 'exhausted';

// ─── Intervention Rule ────────────────────────────────────────────────────────

/**
 * Configuration for a single intervention rule
 */
export interface InterventionRule {
  /** Type of trigger that activates this rule */
  trigger: TriggerType;

  /** Whether this rule is enabled */
  enabled: boolean;

  /** Priority (1-10, higher = more important) */
  priority: number;

  /** Minimum turns between activations of this trigger */
  cooldownTurns: number;

  /** Type of intervention to generate */
  interventionType: InterventionType;

  /** Maximum tokens for this intervention */
  maxTokens: number;

  /** Optional condition expression (for conditional triggers) */
  condition?: string;
}

// ─── Host Persona ─────────────────────────────────────────────────────────────

/**
 * Personality definition for the LLM host
 */
export interface HostPersona {
  /** Display name of the host */
  name: string;

  /** Voice style */
  voiceStyle: VoiceStyle;

  /** Personality traits (used in system prompt) */
  personalityTraits: string[];

  /** Signature phrases */
  catchphrases: string[];

  /** Things the host does NOT do (boundaries) */
  boundaries: string[];

  /** Language code (ru, en, etc.) */
  language: string;
}

// ─── LLM Host Config ──────────────────────────────────────────────────────────

/**
 * Full configuration for the LLM host module
 */
export interface LLMHostConfig {
  // Core settings
  /** Whether LLM host is enabled */
  hostEnabled: boolean;

  /** Host persona (object or preset ID like 'classic_host') */
  hostPersona: HostPersona | string;

  /** Model adapter ID (e.g., 'openai', 'anthropic') */
  hostModelAdapter: string;

  /** Specific model ID (e.g., 'gpt-4o', 'claude-3-opus') */
  hostModelId?: string;

  // Budget settings
  /** Total token budget for host (default: 10000) */
  hostBudget: number;

  /** Threshold for switching to saving mode (default: 70) */
  hostBudgetSavingThreshold: number;

  /** Threshold for exhausted mode (default: 90) */
  hostBudgetExhaustedThreshold: number;

  // Trigger settings
  /** Rules for intervention triggers */
  interventionRules: InterventionRule[];

  /** Minimum turns between any interventions (default: 2) */
  interventionCooldown: number;

  /** Maximum interventions per phase (default: 10) */
  maxInterventionsPerPhase: number;

  // Directive settings
  /** Whether private directives are allowed (default: false) */
  allowHostDirectives: boolean;

  /** Max directives per phase (default: 2) */
  maxDirectivesPerPhase: number;

  /** Max directives per character (default: 1) */
  maxDirectivesPerCharacter: number;

  // Additional settings
  /** Number of recent events in host context (default: 10) */
  hostContextWindowSize: number;

  /** Whether to log all prompts/responses (default: false) */
  verboseLogging: boolean;
}

// ─── Host Budget Record ───────────────────────────────────────────────────────

/**
 * Record tracking host's token budget usage
 */
export interface HostBudgetRecord {
  /** Show ID this budget belongs to */
  showId: string;

  /** Total token limit */
  totalLimit: number;

  /** Tokens used for prompts (input) */
  usedPrompt: number;

  /** Tokens used for completions (output) */
  usedCompletion: number;

  /** Current budget mode */
  mode: HostBudgetMode;

  /** Last update timestamp (Unix ms) */
  lastUpdated: number;
}

// ─── Host Context ─────────────────────────────────────────────────────────────

/**
 * Context passed to LLM for generating interventions
 * Does NOT include privateContext of characters (security boundary)
 */
export interface HostContext {
  /** Show ID */
  showId: string;

  /** Current phase */
  currentPhase: Phase;

  /** Names of all characters */
  characterNames: string[];

  /** Recent events (sliding window) */
  recentEvents: EventSummary[];

  /** Event that triggered this intervention */
  triggerEvent?: ShowEvent;

  /** Type of trigger */
  triggerType: TriggerType;

  /** Current host budget state */
  hostBudget: HostBudgetRecord;
}

// ─── Host Intervention Response ───────────────────────────────────────────────

/**
 * Response from LLM host generation
 */
export interface HostInterventionResponse {
  /** Text of the intervention */
  text: string;

  /** Type of intervention */
  interventionType: InterventionType;

  /** Target character ID (for question/private_directive) */
  targetCharacterId?: string;
}

// ─── Evaluated Trigger ────────────────────────────────────────────────────────

/**
 * A trigger that has been evaluated and is ready for intervention
 */
export interface EvaluatedTrigger {
  /** The trigger type */
  type: TriggerType;

  /** The intervention rule that matched */
  rule: InterventionRule;

  /** The event that triggered this (if any) */
  triggerEvent?: ShowEvent;

  /** Priority score */
  priority: number;
}

// ─── ILLMHostModule ───────────────────────────────────────────────────────────

/**
 * Interface for the LLM Host module
 * Extends IModule with host-specific methods
 */
export interface ILLMHostModule extends IModule {
  /**
   * Called when a new event is appended to the journal
   * Evaluates triggers and potentially generates an intervention
   *
   * @param event - The newly appended event
   */
  onEventAppended(event: ShowEvent): Promise<void>;

  /**
   * Initialize budget for a show
   *
   * @param showId - Show ID
   * @param config - LLM host configuration
   */
  initializeBudget(showId: string, config: LLMHostConfig): Promise<void>;

  /**
   * Get current status of the host for a show
   *
   * @param showId - Show ID
   */
  getStatus(showId: string): Promise<{
    budget: HostBudgetRecord;
    interventionCount: number;
    lastInterventionSequence: number | null;
  }>;

  /**
   * Get the current configuration
   */
  getConfig(): LLMHostConfig | null;

  /**
   * Set the configuration
   *
   * @param config - New configuration
   */
  setConfig(config: LLMHostConfig): void;
}
