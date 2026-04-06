/**
 * ContextBuilder - Assembles context for character prompts
 * Based on PRD.md - Context Builder pattern
 */

import { EventJournal } from './event-journal.js';
import { IStore } from '../types/interfaces/store.interface.js';
import { EventType } from '../types/enums.js';
import { EventSummary } from '../types/events.js';
import { PromptPackage } from '../types/adapter.js';
import { CharacterDefinition } from '../types/character.js';
import { Show } from '../types/runtime.js';
import { ShowFormatTemplate } from '../types/template.js';

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
   * - secrets: character's hidden information
   * - goals: character's objectives
   * - active alliances: current partnerships
   * - unrevealed wildcards: wildcards that haven't been revealed yet
   * - revealed wildcards: from journal events (own and others')
   *
   * @param characterId - Character ID to build facts for
   * @param showId - Show ID
   * @returns Array of fact strings
   */
  async buildFactsList(characterId: string, showId: string): Promise<string[]> {
    const facts: string[] = [];

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
        facts.push(`[Alliance] Partner: ${alliance.partnerId}, Agreement: ${alliance.agreement}`);
      }
    }

    // Add unrevealed wildcards
    for (const wildcard of privateContext.wildcards) {
      if (!wildcard.isRevealed) {
        facts.push(`[Wildcard] ${wildcard.content}`);
      }
    }

    // Add revealed wildcards from journal (own and others')
    const revealedWildcards = await this.getRevealedWildcards(showId, characterId);
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
   * @returns Array of EventSummary objects
   */
  async buildSlidingWindow(
    characterId: string,
    showId: string,
    limit: number
  ): Promise<EventSummary[]> {
    // Get visible events using EventJournal's filtering
    const events = await this.journal.getVisibleEvents(showId, characterId, limit);

    // Convert ShowEvent to EventSummary
    return events.map((event) => ({
      senderId: event.senderId,
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
    // Build system prompt from character definition
    const systemPrompt = this.buildSystemPrompt(character);

    // Get context window size from show's config snapshot
    const template = show.configSnapshot as unknown as ShowFormatTemplate;
    const contextWindowSize = template?.contextWindowSize ?? 50;

    // Build context layers
    const factsList = await this.buildFactsList(character.id, show.id);
    const slidingWindow = await this.buildSlidingWindow(
      character.id,
      show.id,
      contextWindowSize
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
   */
  private buildSystemPrompt(character: CharacterDefinition): string {
    const parts: string[] = [];

    // Character name and public card
    parts.push(`You are ${character.name}.`);
    parts.push(`Public information about you: ${character.publicCard}`);

    // Personality
    parts.push('');
    parts.push('## Personality');
    parts.push(character.personalityPrompt);

    // Motivation
    parts.push('');
    parts.push('## Motivation');
    parts.push(character.motivationPrompt);

    // Boundary rules
    if (character.boundaryRules.length > 0) {
      parts.push('');
      parts.push('## Boundaries (you will NEVER do these things)');
      for (const rule of character.boundaryRules) {
        parts.push(`- ${rule}`);
      }
    }

    // Format instruction for JSON response
    parts.push('');
    parts.push('## Response Format');
    parts.push('You MUST respond with a valid JSON object containing:');
    parts.push('- "text": Your spoken response (required)');
    parts.push('- "intent": One of "speak", "request_private", "reveal_wildcard", "end_turn" (optional)');
    parts.push('- "target": Character ID for private request (optional)');
    parts.push('- "decisionValue": Your choice for voting/decision (optional)');

    return parts.join('\n');
  }

  /**
   * Get revealed wildcards from journal events
   * Includes both character's own revelations and others' visible revelations
   */
  private async getRevealedWildcards(showId: string, characterId: string): Promise<string[]> {
    const revealed: string[] = [];

    // Get all visible events for this character
    const events = await this.journal.getVisibleEvents(showId, characterId);

    // Filter for revelation events
    for (const event of events) {
      if (event.type === EventType.revelation) {
        const isOwn = event.senderId === characterId;
        const prefix = isOwn ? '[My Revealed Wildcard]' : `[Revealed by ${event.senderId}]`;
        revealed.push(`${prefix} ${event.content}`);
      }
    }

    return revealed;
  }
}
