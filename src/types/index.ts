/**
 * Neuroshow Types - Public API
 *
 * Re-exports all public types from the types module.
 * Import from this file for external usage:
 *
 * import { ShowEvent, CharacterDefinition, ModelAdapter } from './types/index.js';
 */

// Enums
export {
  EventType,
  ChannelType,
  CharacterIntent,
  PhaseType,
  ShowStatus,
  BudgetMode,
  SpeakFrequency,
} from './enums.js';

// Primitives
export type {
  ResponseConstraints,
  AllianceRecord,
  WildcardRecord,
  DecisionConfig,
  PrivateChannelRules,
  DayConfig,
  RelationshipType,
  Relationship,
} from './primitives.js';

// Events
export type { ShowEvent, EventSummary } from './events.js';

// Context
export type { PrivateContext, ContextLayers } from './context.js';

// Character
export type { CharacterDefinition } from './character.js';

// Template
export type { Phase, ShowFormatTemplate, ScoringRule } from './template.js';

// Adapter
export type { PromptPackage, CharacterResponse, ModelAdapter, TokenEstimate } from './adapter.js';

// Runtime
export type { Show, TokenBudgetState, ShowCharacter } from './runtime.js';

// Store Interface
export type {
  IStore,
  ShowRecord,
  ShowCharacterRecord,
  LlmCallRecord,
  TokenBudgetRecord,
} from './interfaces/store.interface.js';
