/**
 * Zod validation schemas for API endpoints and data loading
 * Based on TASK-057 - Input validation and sanitization
 */

import { z } from 'zod';
import { ChannelType, PhaseType, SpeakFrequency } from '../types/enums.js';

/**
 * Sanitize user-provided strings to prevent injection attacks
 * - Removes null bytes
 * - Removes control characters (except newlines and tabs)
 * - Trims whitespace
 * - Optionally limits length
 */
export function sanitizeString(input: string, maxLength?: number): string {
  // Remove null bytes
  let sanitized = input.replace(/\0/g, '');

  // Remove control characters except newlines (\n) and tabs (\t)
  // Control characters are 0x00-0x1F and 0x7F, we keep 0x09 (tab) and 0x0A (newline)
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Trim whitespace
  sanitized = sanitized.trim();

  // Limit length if specified
  if (maxLength !== undefined && sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
  }

  return sanitized;
}

/**
 * Custom string schema with sanitization
 */
const sanitizedString = (maxLength?: number) =>
  z.string().transform((val) => sanitizeString(val, maxLength));

/**
 * Non-empty sanitized string
 */
const nonEmptySanitizedString = (maxLength?: number) =>
  sanitizedString(maxLength).refine((val) => val.length > 0, {
    message: 'String cannot be empty',
  });

// =============================================================================
// Primitive Schemas
// =============================================================================

/**
 * ResponseConstraints schema
 */
export const responseConstraintsSchema = z.object({
  maxTokens: z.number().int().positive().max(100000),
  format: z.enum(['free', 'structured', 'choice']),
  language: nonEmptySanitizedString(50),
});

/**
 * AllianceRecord schema
 */
export const allianceRecordSchema = z.object({
  partnerId: nonEmptySanitizedString(100),
  agreement: sanitizedString(2000),
  isActive: z.boolean(),
});

/**
 * WildcardRecord schema
 */
export const wildcardRecordSchema = z.object({
  content: sanitizedString(2000),
  isRevealed: z.boolean(),
});

/**
 * DecisionConfig schema
 */
export const decisionConfigSchema = z.object({
  timing: z.enum(['simultaneous', 'sequential']),
  visibility: z.enum(['secret_until_reveal', 'public_immediately']),
  revealMoment: z.enum(['after_all', 'after_each']),
  format: z.enum(['choice', 'free_text', 'ranking']),
  options: z.array(sanitizedString(500)).nullable(),
});

/**
 * PrivateChannelRules schema
 */
export const privateChannelRulesSchema = z.object({
  initiator: z.enum(['host_only', 'character_request_host_approves', 'character_free']),
  maxPrivatesPerPhase: z.number().int().nonnegative().max(100),
  maxPrivatesPerCharacterPerPhase: z.number().int().nonnegative().max(50),
  requestQueueMode: z.enum(['fifo', 'host_priority']),
  requestFormat: z.enum(['public_ask', 'structured_signal']),
});

/**
 * DayConfig schema
 */
export const dayConfigSchema = z.object({
  dayIndex: z.number().int().nonnegative(),
  label: nonEmptySanitizedString(100),
  phaseIds: z.array(nonEmptySanitizedString(100)),
});

// =============================================================================
// Context Schemas
// =============================================================================

/**
 * PrivateContext schema
 */
export const privateContextSchema = z.object({
  secrets: z.array(sanitizedString(2000)),
  alliances: z.array(allianceRecordSchema),
  goals: z.array(sanitizedString(2000)),
  wildcards: z.array(wildcardRecordSchema),
});

// =============================================================================
// Template Schemas
// =============================================================================

/**
 * ScoringRule schema
 */
export const scoringRuleSchema = z.object({
  id: nonEmptySanitizedString(100),
  description: sanitizedString(1000),
  condition: sanitizedString(500),
  points: z.number().int(),
});

/**
 * Phase schema
 */
export const phaseSchema = z.object({
  id: nonEmptySanitizedString(100),
  name: nonEmptySanitizedString(200),
  type: z.nativeEnum(PhaseType),
  durationMode: z.enum(['turns', 'timer', 'condition']),
  durationValue: z.union([z.number().int().positive(), sanitizedString(500)]),
  turnOrder: z.enum(['sequential', 'frequency_weighted', 'host_controlled']),
  allowedChannels: z.array(z.nativeEnum(ChannelType)),
  triggerTemplate: sanitizedString(5000).nullable(),
  completionCondition: sanitizedString(500),
  dayIndex: z.number().int().nonnegative().optional(),
  slotLabel: sanitizedString(100).optional(),
});

/**
 * ShowFormatTemplate schema
 */
export const showFormatTemplateSchema = z.object({
  id: nonEmptySanitizedString(100),
  name: nonEmptySanitizedString(200),
  description: sanitizedString(5000),
  minParticipants: z.number().int().positive().max(100),
  maxParticipants: z.number().int().positive().max(100),
  phases: z.array(phaseSchema).min(1),
  days: z.array(dayConfigSchema).optional(),
  decisionConfig: decisionConfigSchema,
  channelTypes: z.array(z.nativeEnum(ChannelType)),
  privateChannelRules: privateChannelRulesSchema,
  contextWindowSize: z.number().int().positive().max(1000000),
  allowCharacterInitiative: z.boolean().optional(),
  scoringRules: z.array(scoringRuleSchema).optional(),
  winCondition: sanitizedString(1000).optional(),
}).refine((data) => data.minParticipants <= data.maxParticipants, {
  message: 'minParticipants must be less than or equal to maxParticipants',
  path: ['minParticipants'],
});

// =============================================================================
// Character Schemas
// =============================================================================

/**
 * CharacterDefinition schema
 */
export const characterDefinitionSchema = z.object({
  id: nonEmptySanitizedString(100),
  name: nonEmptySanitizedString(200),
  publicCard: sanitizedString(5000),
  personalityPrompt: sanitizedString(10000),
  motivationPrompt: sanitizedString(10000),
  boundaryRules: z.array(sanitizedString(2000)),
  startingPrivateContext: privateContextSchema,
  speakFrequency: z.nativeEnum(SpeakFrequency),
  responseConstraints: responseConstraintsSchema,
});

/**
 * CharacterDefinition with optional modelAdapterId (for API)
 */
export const characterWithAdapterSchema = characterDefinitionSchema.extend({
  modelAdapterId: sanitizedString(100).optional(),
});

// =============================================================================
// API Request Schemas
// =============================================================================

/**
 * POST /shows request body schema
 */
export const createShowRequestSchema = z.object({
  formatId: showFormatTemplateSchema,
  characters: z.array(characterWithAdapterSchema).min(1),
  seed: z.number().int().optional(),
  tokenBudget: z.number().int().positive().max(10000000).optional(),
});

/**
 * POST /shows/:id/control request body schema
 */
export const controlShowRequestSchema = z.object({
  action: z.enum(['start', 'pause', 'resume', 'step', 'rollback']),
  phaseId: sanitizedString(100).optional(),
}).refine(
  (data) => data.action !== 'rollback' || data.phaseId !== undefined,
  {
    message: 'phaseId is required for rollback action',
    path: ['phaseId'],
  }
);

// =============================================================================
// Validation Helper Functions
// =============================================================================

/**
 * Format Zod errors into a human-readable message
 */
export function formatValidationError(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return issues.join('; ');
}

/**
 * Validate ShowFormatTemplate
 * @throws Error with validation message if invalid
 */
export function validateShowFormatTemplate(data: unknown): import('../types/template.js').ShowFormatTemplate {
  const result = showFormatTemplateSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid ShowFormatTemplate: ${formatValidationError(result.error)}`);
  }
  return result.data as import('../types/template.js').ShowFormatTemplate;
}

/**
 * Validate CharacterDefinition
 * @throws Error with validation message if invalid
 */
export function validateCharacterDefinition(data: unknown): import('../types/character.js').CharacterDefinition {
  const result = characterDefinitionSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid CharacterDefinition: ${formatValidationError(result.error)}`);
  }
  return result.data as import('../types/character.js').CharacterDefinition;
}

/**
 * Validate POST /shows request
 * @returns Validated and sanitized data, or error message
 */
export function validateCreateShowRequest(
  data: unknown
): { success: true; data: z.infer<typeof createShowRequestSchema> } | { success: false; error: string } {
  const result = createShowRequestSchema.safeParse(data);
  if (!result.success) {
    return { success: false, error: formatValidationError(result.error) };
  }
  return { success: true, data: result.data };
}

/**
 * Validate POST /shows/:id/control request
 * @returns Validated and sanitized data, or error message
 */
export function validateControlShowRequest(
  data: unknown
): { success: true; data: z.infer<typeof controlShowRequestSchema> } | { success: false; error: string } {
  const result = controlShowRequestSchema.safeParse(data);
  if (!result.success) {
    return { success: false, error: formatValidationError(result.error) };
  }
  return { success: true, data: result.data };
}

// Type exports for use in API
export type CreateShowRequest = z.infer<typeof createShowRequestSchema>;
export type ControlShowRequest = z.infer<typeof controlShowRequestSchema>;
