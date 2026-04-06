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
export {
  ResponseConstraints,
  AllianceRecord,
  WildcardRecord,
  DecisionConfig,
  PrivateChannelRules,
  DayConfig,
} from './primitives.js';

// Events
export { ShowEvent, EventSummary } from './events.js';

// Context
export { PrivateContext, ContextLayers } from './context.js';

// Character
export { CharacterDefinition } from './character.js';

// Template
export { Phase, ShowFormatTemplate, ScoringRule } from './template.js';

// Adapter
export { PromptPackage, CharacterResponse, ModelAdapter } from './adapter.js';

// Store Interface
export {
  IStore,
  ShowRecord,
  ShowCharacterRecord,
  LlmCallRecord,
  TokenBudgetRecord,
} from './interfaces/store.interface.js';
