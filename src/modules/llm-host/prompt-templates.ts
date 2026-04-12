/**
 * Prompt Templates for LLM Host
 *
 * Functions for building system and user prompts for the LLM Host.
 * Templates are based on PRD-llm-host.md section 6.
 */

import type { EventSummary } from '../../types/events.js';
import type {
  HostPersona,
  HostContext,
  InterventionType,
  InterventionRule,
  TriggerType,
  LLMHostConfig,
} from './types.js';
import { getVoiceStyleDescription, resolvePersona } from './persona-presets.js';

// ─── Formatting Helpers ───────────────────────────────────────────────────────

/**
 * Format personality traits as a bulleted list for the prompt.
 */
function formatPersonalityTraits(traits: string[]): string {
  return traits.map((trait) => `- ${trait}`).join('\n');
}

/**
 * Format catchphrases as a comma-separated list.
 */
function formatCatchphrases(catchphrases: string[]): string {
  return catchphrases.map((phrase) => `"${phrase}"`).join(', ');
}

/**
 * Format boundaries as a bulleted list of restrictions.
 */
function formatBoundaries(boundaries: string[]): string {
  return boundaries.map((boundary) => `- ${boundary}`).join('\n');
}

/**
 * Format character names as a comma-separated list.
 */
function formatCharacterNames(names: string[]): string {
  return names.join(', ');
}

/**
 * Format event summaries for the prompt context.
 * Shows recent events in a readable format.
 */
function formatRecentEvents(events: EventSummary[]): string {
  if (events.length === 0) {
    return '(нет событий)';
  }

  return events
    .map((event) => {
      const actor = event.senderName || 'Система';
      const content = event.content || '...';
      return `[${actor}]: ${content}`;
    })
    .join('\n');
}

/**
 * Get human-readable description for a trigger type.
 */
function getTriggerDescription(triggerType: TriggerType, context: HostContext): string {
  const descriptions: Record<TriggerType, string> = {
    phase_start: `Началась новая фаза: ${context.currentPhase.name}`,
    phase_end: `Завершилась фаза: ${context.currentPhase.name}`,
    revelation: 'Раскрытие важной информации',
    wildcard_reveal: 'Участник раскрыл козырь',
    conflict_detected: 'Обнаружен конфликт между участниками',
    alliance_hint: 'Намёк на формирование альянса',
    silence_detected: 'Участник молчит несколько ходов подряд',
    budget_milestone: 'Достигнута веха бюджета',
    dramatic_moment: 'Драматический момент',
    private_channel_open: 'Открыт приватный канал',
    private_channel_close: 'Закрыт приватный канал',
    periodic_commentary: 'Периодический комментарий',
    phase_midpoint: 'Середина фазы',
  };

  return descriptions[triggerType];
}

// ─── System Prompt Builder ────────────────────────────────────────────────────

/**
 * Build the system prompt for the LLM Host.
 *
 * The system prompt establishes:
 * - Host's role and purpose
 * - Voice style and personality
 * - Strict boundaries and limitations
 * - Current show context
 *
 * @param persona - Host persona configuration
 * @param context - Current show context
 * @param config - LLM host configuration (for max tokens, etc.)
 * @returns Complete system prompt string
 */
export function buildSystemPrompt(
  persona: HostPersona,
  context: HostContext,
  config: LLMHostConfig
): string {
  const resolvedPersona = resolvePersona(persona);
  const voiceStyleDescription = getVoiceStyleDescription(resolvedPersona.voiceStyle);
  const personalityTraits = formatPersonalityTraits(resolvedPersona.personalityTraits);
  const catchphrases = formatCatchphrases(resolvedPersona.catchphrases);
  const boundaries = formatBoundaries(resolvedPersona.boundaries);
  const characterNames = formatCharacterNames(context.characterNames);
  const recentEvents = formatRecentEvents(context.recentEvents);
  const triggerDescription = getTriggerDescription(context.triggerType, context);

  // Find max tokens for the current intervention type from rules
  const matchingRule = config.interventionRules.find(
    (rule) => rule.trigger === context.triggerType
  );
  const maxTokens = matchingRule?.maxTokens ?? 100;

  // Budget mode warning
  let budgetWarning = '';
  if (context.hostBudget.mode === 'saving') {
    budgetWarning = '\nВНИМАНИЕ: Бюджет ограничен. Будь краток.';
  }

  return `Ты — ведущий интерактивного AI-шоу.

ТВОЯ РОЛЬ:
- Комментировать происходящее, добавляя драму и интригу
- Задавать вопросы участникам, чтобы направить диалог
- Делать объявления о правилах и состоянии шоу
- Поддерживать темп и вовлечённость

СТИЛЬ: ${voiceStyleDescription}

ХАРАКТЕР:
${personalityTraits}

ФИРМЕННЫЕ ФРАЗЫ (используй уместно):
${catchphrases}

СТРОГИЕ ОГРАНИЧЕНИЯ:
${boundaries}
- НЕ раскрывай информацию, которую участники не знают
- НЕ принимай решения за участников
- НЕ меняй правила шоу

ФОРМАТ ОТВЕТА:
Отвечай только текстом интервенции. Без метаданных, без пояснений.
Максимум ${maxTokens} токенов.${budgetWarning}

ТЕКУЩИЙ КОНТЕКСТ:
Фаза: ${context.currentPhase.name}
Участники: ${characterNames}
Последние события:
${recentEvents}

ТРИГГЕР: ${triggerDescription}`;
}

// ─── User Prompt Templates ────────────────────────────────────────────────────

/**
 * Intervention-specific prompt templates.
 * Each template provides specific instructions for the type of intervention.
 */
const INTERVENTION_PROMPTS: Record<InterventionType, (context: HostContext, rule: InterventionRule) => string> = {
  comment: (_context: HostContext, _rule: InterventionRule) => {
    return `Прокомментируй последнее событие. Добавь драмы, но без лишнего пафоса. 1-2 предложения.`;
  },

  question: (context: HostContext, _rule: InterventionRule) => {
    // For questions, we need to identify a target
    // The target might be specified in the trigger event metadata or chosen based on context
    const lastEvent = context.triggerEvent;
    let targetInfo: string;

    if (lastEvent?.metadata?.targetCharacterId) {
      // If we have a target character ID, use that
      targetInfo = 'выбранному участнику';
    } else if (context.triggerType === 'silence_detected') {
      targetInfo = 'молчащего участника';
    } else {
      // Pick the most relevant participant from recent events
      const recentActor = context.recentEvents[0]?.senderName;
      targetInfo = recentActor ?? 'одного из участников';
    }

    const triggerReason = getTriggerReasonForQuestion(context);

    return `Задай вопрос участнику ${targetInfo}. Причина: ${triggerReason}.
Вопрос должен требовать содержательного ответа, не да/нет.`;
  },

  announcement: (context: HostContext, _rule: InterventionRule) => {
    const phaseName = context.currentPhase.name;
    const isPhaseStart = context.triggerType === 'phase_start';
    const isPhaseEnd = context.triggerType === 'phase_end';

    if (isPhaseStart) {
      return `Объяви о начале фазы "${phaseName}".
Кратко напомни правила этой фазы, если они важны.
Вдохнови участников на активное участие.`;
    } else if (isPhaseEnd) {
      return `Объяви о завершении фазы "${phaseName}".
Кратко подведи итоги, что произошло.
Создай интригу перед следующей фазой.`;
    } else {
      return `Сделай объявление для участников.
Будь информативен, но не скучен.`;
    }
  },

  private_directive: (context: HostContext, _rule: InterventionRule) => {
    // Private directives need a specific target
    const lastEvent = context.triggerEvent;
    let targetInfo: string;

    if (lastEvent?.metadata?.targetCharacterId) {
      targetInfo = 'выбранному участнику';
    } else {
      const recentActor = context.recentEvents[0]?.senderName;
      targetInfo = recentActor ?? 'одному из участников';
    }

    return `Дай приватное задание участнику ${targetInfo}.
Задание должно быть выполнимым в рамках шоу и не нарушать правил.
НЕ приказывай конкретное решение в голосовании.
Сделай задание интригующим и создающим драму.`;
  },
};

/**
 * Get the reason for a question based on trigger type.
 */
function getTriggerReasonForQuestion(context: HostContext): string {
  switch (context.triggerType) {
    case 'silence_detected':
      return 'участник молчит несколько ходов';
    case 'conflict_detected':
      return 'обнаружен конфликт мнений';
    case 'private_channel_close':
      return 'завершилась приватная беседа';
    case 'alliance_hint':
      return 'есть признаки формирования альянса';
    case 'dramatic_moment':
      return 'произошёл драматический момент';
    default:
      return 'для продвижения диалога';
  }
}

// ─── User Prompt Builder ──────────────────────────────────────────────────────

/**
 * Build the user prompt for a specific intervention type.
 *
 * The user prompt provides specific instructions for what the host
 * should generate based on the intervention type and context.
 *
 * @param context - Current show context
 * @param rule - The intervention rule being applied
 * @returns User prompt string
 */
export function buildUserPrompt(context: HostContext, rule: InterventionRule): string {
  const interventionType = rule.interventionType;
  const promptBuilder = INTERVENTION_PROMPTS[interventionType];

  if (!promptBuilder) {
    // Fallback for unknown intervention types
    return 'Отреагируй на текущую ситуацию в шоу. Будь краток и уместен.';
  }

  return promptBuilder(context, rule);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export {
  formatPersonalityTraits,
  formatCatchphrases,
  formatBoundaries,
  formatCharacterNames,
  formatRecentEvents,
  getTriggerDescription,
};
