/**
 * ContextBuilder - Assembles context for character prompts
 * Based on PRD.md - Context Builder pattern
 */

import { EventJournal } from './event-journal.js';
import { IStore } from '../types/interfaces/store.interface.js';
import { EventType } from '../types/enums.js';
import { EventSummary } from '../types/events.js';
import { PromptPackage, ModelAdapter } from '../types/adapter.js';
import { CharacterDefinition } from '../types/character.js';
import { Show } from '../types/runtime.js';
import { ShowFormatTemplate } from '../types/template.js';
import { ResponseConstraints } from '../types/primitives.js';

/**
 * ContextBuilder assembles context layers for character prompts
 *
 * Responsible for:
 * - Building facts list from character's private context
 * - Building sliding window of recent visible events
 * - Trimming context to fit token budgets
 */
export class ContextBuilder {
  constructor(
    private readonly journal: EventJournal,
    private readonly store: IStore
  ) {}

  /**
   * Build facts list from character's private context
   *
   * Includes:
   * - prologue: game intro/rules if defined in template
   * - secrets: character's hidden information
   * - goals: character's objectives
   * - active alliances: current partnerships
   * - unrevealed wildcards: wildcards that haven't been revealed yet
   * - revealed wildcards: from journal events (own and others')
   *
   * @param characterId - Character ID to build facts for
   * @param showId - Show ID
   * @param nameMap - Map of character IDs to display names
   * @returns Array of fact strings
   */
  async buildFactsList(
    characterId: string,
    showId: string,
    nameMap?: Map<string, string>
  ): Promise<string[]> {
    const facts: string[] = [];

    // Get show record for prologue
    const showRecord = await this.store.getShow(showId);
    if (showRecord) {
      const configSnapshot = JSON.parse(showRecord.configSnapshot) as Record<string, unknown>;
      const prologue = configSnapshot.prologue as string | undefined;
      if (prologue) {
        facts.push(`[Game Rules] ${prologue}`);
      }
    }

    // Get character's private context from store
    const character = await this.store.getCharacter(showId, characterId);
    if (!character) {
      return facts;
    }

    const { privateContext } = character;

    // Add secrets
    for (const secret of privateContext.secrets) {
      facts.push(`[Secret] ${secret}`);
    }

    // Add goals
    for (const goal of privateContext.goals) {
      facts.push(`[Goal] ${goal}`);
    }

    // Add active alliances
    for (const alliance of privateContext.alliances) {
      if (alliance.isActive) {
        const partnerName = nameMap?.get(alliance.partnerId) ?? alliance.partnerId;
        facts.push(`[Alliance] Partner: ${partnerName}, Agreement: ${alliance.agreement}`);
      }
    }

    // Add unrevealed wildcards
    for (const wildcard of privateContext.wildcards) {
      if (!wildcard.isRevealed) {
        facts.push(`[Wildcard] ${wildcard.content}`);
      }
    }

    // Add revealed wildcards from journal (own and others')
    const revealedWildcards = await this.getRevealedWildcards(showId, characterId, nameMap);
    for (const revealed of revealedWildcards) {
      facts.push(revealed);
    }

    return facts;
  }

  /**
   * Build sliding window of recent visible events
   *
   * Returns the last N events visible to this character,
   * converted to EventSummary format for the context window.
   *
   * @param characterId - Character ID to build window for
   * @param showId - Show ID
   * @param limit - Maximum number of events to return
   * @param nameMap - Map of character IDs to display names
   * @returns Array of EventSummary objects
   */
  async buildSlidingWindow(
    characterId: string,
    showId: string,
    limit: number,
    nameMap?: Map<string, string>
  ): Promise<EventSummary[]> {
    // Get visible events using EventJournal's filtering
    const events = await this.journal.getVisibleEvents(showId, characterId, limit);

    // Convert ShowEvent to EventSummary with sender names
    return events.map((event) => ({
      senderId: event.senderId,
      senderName: nameMap?.get(event.senderId) ?? event.senderId,
      channel: event.channel,
      content: event.content,
      timestamp: event.timestamp,
    }));
  }

  /**
   * Build complete PromptPackage for a character's turn
   *
   * Assembles all components needed for an LLM call:
   * - systemPrompt: personality + motivation + boundaries + format instruction
   * - contextLayers: facts list + sliding window of recent events
   * - trigger: the prompt/question for this turn
   * - responseConstraints: limits from character definition
   *
   * @param character - Character definition with prompts and constraints
   * @param show - Current show state
   * @param trigger - The trigger/prompt for this turn
   * @returns Complete PromptPackage ready for ModelAdapter.call()
   */
  async buildPromptPackage(
    character: CharacterDefinition,
    show: Show,
    trigger: string
  ): Promise<PromptPackage> {
    // Get context window size from show's config snapshot
    const template = show.configSnapshot as unknown as ShowFormatTemplate;
    const contextWindowSize = template?.contextWindowSize ?? 50;

    // Build character name map from configSnapshot
    const characterDefinitions = (show.configSnapshot as Record<string, unknown>)
      .characterDefinitions as Array<{ id: string; name: string }> | undefined;
    const nameMap = new Map<string, string>();
    if (characterDefinitions) {
      for (const def of characterDefinitions) {
        nameMap.set(def.id, def.name);
      }
    }

    // Build system prompt from character definition with other participants
    const otherParticipants = characterDefinitions
      ?.filter((c) => c.id !== character.id)
      .map((c) => c.name) ?? [];
    const systemPrompt = this.buildSystemPrompt(
      character,
      character.responseConstraints,
      otherParticipants
    );

    // Build context layers
    const factsList = await this.buildFactsList(character.id, show.id, nameMap);
    const slidingWindow = await this.buildSlidingWindow(
      character.id,
      show.id,
      contextWindowSize,
      nameMap
    );

    return {
      systemPrompt,
      contextLayers: {
        factsList,
        slidingWindow,
      },
      trigger,
      responseConstraints: character.responseConstraints,
    };
  }

  /**
   * Build system prompt from character definition
   *
   * Includes:
   * - personalityPrompt: how the character behaves
   * - motivationPrompt: what drives the character
   * - boundaryRules: what the character won't do
   * - format instruction: JSON response format
   * - language instruction: respond in specified language
   * - other participants: list of other characters by name
   */
  private buildSystemPrompt(
    character: CharacterDefinition,
    responseConstraints: ResponseConstraints,
    otherParticipants: string[] = []
  ): string {
    const parts: string[] = [];
    const isRussian = responseConstraints.language === 'ru';

    // Language instruction at the very top for Russian
    if (isRussian) {
      parts.push('ВАЖНО: Отвечай ТОЛЬКО на русском языке.');
      parts.push('');
    }

    // Character name and public card
    if (isRussian) {
      parts.push(`Ты — ${character.name}.`);
      parts.push(`Публичная информация о тебе: ${character.publicCard}`);
    } else {
      parts.push(`You are ${character.name}.`);
      parts.push(`Public information about you: ${character.publicCard}`);
    }

    // Other participants
    if (otherParticipants.length > 0) {
      parts.push('');
      if (isRussian) {
        parts.push(`Другие участники: ${otherParticipants.join(', ')}.`);
      } else {
        parts.push(`Other participants: ${otherParticipants.join(', ')}.`);
      }
    }

    // Personality
    parts.push('');
    parts.push(isRussian ? '## Личность' : '## Personality');
    parts.push(character.personalityPrompt);

    // Motivation
    parts.push('');
    parts.push(isRussian ? '## Мотивация' : '## Motivation');
    parts.push(character.motivationPrompt);

    // Boundary rules
    if (character.boundaryRules.length > 0) {
      parts.push('');
      parts.push(
        isRussian
          ? '## Границы (ты НИКОГДА не будешь делать это)'
          : '## Boundaries (you will NEVER do these things)'
      );
      for (const rule of character.boundaryRules) {
        parts.push(`- ${rule}`);
      }
    }

    // Format instruction for JSON response
    parts.push('');
    parts.push(isRussian ? '## Формат ответа' : '## Response Format');
    if (isRussian) {
      parts.push('Ты ДОЛЖЕН ответить валидным JSON объектом, содержащим:');
      parts.push('- "text": Твой устный ответ (обязательно)');
      parts.push(
        '- "intent": Одно из "speak", "request_private", "reveal_wildcard", "end_turn" (опционально)'
      );
      parts.push('- "target": ID персонажа для приватного запроса (опционально)');
      parts.push('- "decisionValue": Твой выбор для голосования/решения (опционально)');
      parts.push('');
      parts.push('## Правила приватных каналов');
      parts.push('- "request_private" используется ТОЛЬКО для общения с ДРУГИМИ участниками');
      parts.push('- "target" должен быть именем ДРУГОГО участника, НЕ твоим собственным');
      parts.push(
        '- Приватное сообщение должно отличаться от публичного "text" — не дублируй одно и то же'
      );
    } else {
      parts.push('You MUST respond with a valid JSON object containing:');
      parts.push('- "text": Your spoken response (required)');
      parts.push(
        '- "intent": One of "speak", "request_private", "reveal_wildcard", "end_turn" (optional)'
      );
      parts.push('- "target": Character ID for private request (optional)');
      parts.push('- "decisionValue": Your choice for voting/decision (optional)');
      parts.push('');
      parts.push('## Private Channel Rules');
      parts.push('- "request_private" is ONLY for communicating with OTHER participants');
      parts.push('- "target" must be the name of ANOTHER participant, NOT your own');
      parts.push('- Private message should differ from your public "text" — do not duplicate');
    }

    return parts.join('\n');
  }

  /**
   * Get revealed wildcards from journal events
   * Includes both character's own revelations and others' visible revelations
   */
  private async getRevealedWildcards(
    showId: string,
    characterId: string,
    nameMap?: Map<string, string>
  ): Promise<string[]> {
    const revealed: string[] = [];

    // Get all visible events for this character
    const events = await this.journal.getVisibleEvents(showId, characterId);

    // Filter for revelation events
    for (const event of events) {
      if (event.type === EventType.revelation) {
        const isOwn = event.senderId === characterId;
        const senderName = nameMap?.get(event.senderId) ?? event.senderId;
        const prefix = isOwn ? '[My Revealed Wildcard]' : `[Revealed by ${senderName}]`;
        revealed.push(`${prefix} ${event.content}`);
      }
    }

    return revealed;
  }

  /**
   * Trim PromptPackage to fit within token budget
   *
   * Uses adapter.estimateTokens() to check if package exceeds budget.
   * If over budget, trims slidingWindow (oldest events first).
   * NEVER trims factsList - facts are always preserved.
   *
   * @param pkg - The PromptPackage to trim
   * @param maxTokens - Maximum allowed tokens (prompt + completion)
   * @param adapter - ModelAdapter used for token estimation
   * @returns PromptPackage that fits within the budget
   */
  trimToTokenBudget(
    pkg: PromptPackage,
    maxTokens: number,
    adapter: ModelAdapter
  ): PromptPackage {
    // Start with a copy of the package
    const result: PromptPackage = {
      systemPrompt: pkg.systemPrompt,
      contextLayers: {
        factsList: [...pkg.contextLayers.factsList], // Never trim facts
        slidingWindow: [...pkg.contextLayers.slidingWindow],
      },
      trigger: pkg.trigger,
      responseConstraints: { ...pkg.responseConstraints },
    };

    // Check if already within budget
    let estimate = adapter.estimateTokens(result);
    let totalTokens = estimate.prompt + estimate.estimatedCompletion;

    // Trim slidingWindow from the beginning (oldest events) until within budget
    while (totalTokens > maxTokens && result.contextLayers.slidingWindow.length > 0) {
      // Remove the oldest event (first element)
      result.contextLayers.slidingWindow.shift();

      // Re-estimate tokens
      estimate = adapter.estimateTokens(result);
      totalTokens = estimate.prompt + estimate.estimatedCompletion;
    }

    return result;
  }
}
