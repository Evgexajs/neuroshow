/**
 * Neuroshow Enums
 * Based on PRD.md Appendix A - TypeScript Interfaces
 */

/**
 * Event types for ShowEvent
 */
export enum EventType {
  speech = 'speech',
  host_trigger = 'host_trigger',
  phase_start = 'phase_start',
  phase_end = 'phase_end',
  channel_change = 'channel_change',
  decision = 'decision',
  revelation = 'revelation',
  private_injection = 'private_injection', // Non-MVP (structurally supported in MVP)
  system = 'system',
}

/**
 * Channel types for message visibility
 */
export enum ChannelType {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
  ZONE = 'ZONE',
}

/**
 * Character intent in responses
 */
export enum CharacterIntent {
  speak = 'speak',
  request_private = 'request_private',
  reveal_wildcard = 'reveal_wildcard',
  end_turn = 'end_turn',
  request_to_speak = 'request_to_speak', // Non-MVP
  request_interrupt = 'request_interrupt', // Non-MVP
}

/**
 * Phase types for show phases
 */
export enum PhaseType {
  discussion = 'discussion',
  voting = 'voting',
  private_talks = 'private_talks',
  decision = 'decision',
  revelation = 'revelation',
}

/**
 * Show runtime status
 */
export enum ShowStatus {
  running = 'running',
  paused = 'paused',
  completed = 'completed',
  aborted = 'aborted',
}

/**
 * Token budget mode
 */
export enum BudgetMode {
  normal = 'normal',
  budget_saving = 'budget_saving',
  graceful_finish = 'graceful_finish',
}

/**
 * Character speak frequency
 */
export enum SpeakFrequency {
  low = 'low',
  medium = 'medium',
  high = 'high',
}
