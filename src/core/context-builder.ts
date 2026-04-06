/**
 * ContextBuilder - Assembles context for character prompts
 * Based on PRD.md - Context Builder pattern
 */

import { EventJournal } from './event-journal.js';
import { IStore } from '../types/interfaces/store.interface.js';
import { EventType } from '../types/enums.js';

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
