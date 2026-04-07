/**
 * HostModule - Manages show lifecycle and orchestration
 * Based on PRD.md - Host Module responsibilities
 */

import { IStore, ShowRecord, ShowCharacterRecord, TokenBudgetRecord } from '../types/interfaces/store.interface.js';
import { EventJournal } from './event-journal.js';
import { ShowFormatTemplate, Phase } from '../types/template.js';
import { CharacterDefinition } from '../types/character.js';
import { Show } from '../types/runtime.js';
import { ShowEvent } from '../types/events.js';
import { ShowStatus, BudgetMode, EventType, ChannelType } from '../types/enums.js';
import { generateId } from '../utils/id.js';
import { config } from '../config.js';

/**
 * HostModule manages show initialization and lifecycle
 */
export class HostModule {
  constructor(
    private readonly store: IStore,
    // EventJournal will be used in future methods (emitTrigger, etc.)
    readonly eventJournal: EventJournal
  ) {}

  /**
   * Initialize a new show
   * - Creates show record with config_snapshot
   * - Creates show_characters for each character
   * - Creates token_budget for the show
   * - Generates seed if not provided
   *
   * @param template - Show format template
   * @param characters - Character definitions with optional modelAdapterId
   * @param seed - Optional seed for reproducibility
   * @returns Initialized Show object
   */
  async initializeShow(
    template: ShowFormatTemplate,
    characters: Array<CharacterDefinition & { modelAdapterId?: string }>,
    seed?: number
  ): Promise<Show> {
    const showId = generateId();
    const showSeed = seed ?? Math.floor(Math.random() * 2147483647);
    const startedAt = new Date();

    // Build config snapshot
    const configSnapshot: Record<string, unknown> = {
      templateId: template.id,
      templateName: template.name,
      contextWindowSize: template.contextWindowSize,
      decisionConfig: template.decisionConfig,
      privateChannelRules: template.privateChannelRules,
      allowCharacterInitiative: template.allowCharacterInitiative ?? false,
    };

    // Create show record
    const showRecord: ShowRecord = {
      id: showId,
      formatId: template.id,
      seed: showSeed.toString(),
      status: ShowStatus.running,
      currentPhaseId: template.phases.length > 0 ? template.phases[0]!.id : null,
      startedAt: startedAt.getTime(),
      completedAt: null,
      configSnapshot: JSON.stringify(configSnapshot),
    };

    await this.store.createShow(showRecord);

    // Create show_characters for each character
    for (const character of characters) {
      const charRecord: ShowCharacterRecord = {
        showId,
        characterId: character.id,
        modelAdapterId: character.modelAdapterId ?? config.adapterMode,
        privateContext: character.startingPrivateContext,
        speakFrequency: character.speakFrequency,
      };
      await this.store.createCharacter(charRecord);
    }

    // Create token_budget for the show
    const budgetRecord: TokenBudgetRecord = {
      showId,
      totalLimit: config.tokenBudgetPerShow,
      usedPrompt: 0,
      usedCompletion: 0,
      mode: BudgetMode.normal,
      lastUpdated: startedAt.getTime(),
    };

    await this.store.createBudget(budgetRecord);

    // Return Show object
    const show: Show = {
      id: showId,
      formatId: template.id,
      seed: showSeed,
      status: ShowStatus.running,
      currentPhaseId: template.phases.length > 0 ? template.phases[0]!.id : null,
      startedAt,
      completedAt: null,
      configSnapshot,
    };

    return show;
  }

  /**
   * Manage turn queue for a phase
   * Returns ordered list of characterIds based on phase.turnOrder
   *
   * @param showId - Show ID
   * @param phase - Phase with turnOrder configuration
   * @returns Ordered array of characterIds
   */
  async manageTurnQueue(showId: string, phase: Phase): Promise<string[]> {
    // Get all characters for this show
    const characters = await this.store.getCharacters(showId);

    if (characters.length === 0) {
      return [];
    }

    // Get show for seed (needed for deterministic ordering)
    const showRecord = await this.store.getShow(showId);
    const seed = showRecord ? parseInt(showRecord.seed, 10) : 0;

    switch (phase.turnOrder) {
      case 'sequential':
        // Return characters in their stored order
        return characters.map((c) => c.characterId);

      case 'frequency_weighted':
        // Prioritize by speakFrequency: high > medium > low
        // Within same frequency, use deterministic shuffle based on seed
        return this.orderByFrequency(characters, seed);

      case 'host_controlled':
        // For host_controlled, return in sequential order
        // The host will control the actual turn order
        return characters.map((c) => c.characterId);

      default:
        // Fallback to sequential
        return characters.map((c) => c.characterId);
    }
  }

  /**
   * Order characters by speak frequency with deterministic shuffle within same frequency
   * @param characters - Characters to order
   * @param seed - Seed for deterministic shuffle
   * @returns Ordered characterIds
   */
  private orderByFrequency(
    characters: Array<{ characterId: string; speakFrequency?: 'low' | 'medium' | 'high' }>,
    seed: number
  ): string[] {
    // Group by frequency
    const highFreq: string[] = [];
    const mediumFreq: string[] = [];
    const lowFreq: string[] = [];

    for (const char of characters) {
      const freq = char.speakFrequency ?? 'medium';
      if (freq === 'high') {
        highFreq.push(char.characterId);
      } else if (freq === 'medium') {
        mediumFreq.push(char.characterId);
      } else {
        lowFreq.push(char.characterId);
      }
    }

    // Deterministic shuffle each group using seed
    const shuffleWithSeed = (arr: string[], s: number): string[] => {
      const result = [...arr];
      // Simple seeded shuffle (Fisher-Yates with seeded random)
      let currentSeed = s;
      const seededRandom = (): number => {
        currentSeed = (currentSeed * 1103515245 + 12345) & 0x7fffffff;
        return currentSeed / 0x7fffffff;
      };

      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(seededRandom() * (i + 1));
        [result[i], result[j]] = [result[j]!, result[i]!];
      }
      return result;
    };

    // Shuffle each group with different seed offsets for variety
    const shuffledHigh = shuffleWithSeed(highFreq, seed);
    const shuffledMedium = shuffleWithSeed(mediumFreq, seed + 1);
    const shuffledLow = shuffleWithSeed(lowFreq, seed + 2);

    // Concatenate: high frequency first, then medium, then low
    return [...shuffledHigh, ...shuffledMedium, ...shuffledLow];
  }

  /**
   * Emit a trigger event to the journal
   * Used by Host to send prompts/triggers to characters
   *
   * @param showId - Show ID
   * @param phaseId - Current phase ID
   * @param triggerTemplate - Template string with optional placeholders
   * @param targetCharacterIds - Optional list of target character IDs (default: all characters)
   */
  async emitTrigger(
    showId: string,
    phaseId: string,
    triggerTemplate: string,
    targetCharacterIds?: string[]
  ): Promise<void> {
    // Get show for seed
    const showRecord = await this.store.getShow(showId);
    const seed = showRecord?.seed ?? '0';

    // Determine audience
    let audienceIds: string[];
    if (targetCharacterIds && targetCharacterIds.length > 0) {
      audienceIds = targetCharacterIds;
    } else {
      // All characters in the show
      const characters = await this.store.getCharacters(showId);
      audienceIds = characters.map((c) => c.characterId);
    }

    // Process template substitution
    const content = await this.processTemplate(showId, triggerTemplate, audienceIds);

    // Create host_trigger event
    const event: Omit<ShowEvent, 'sequenceNumber'> = {
      id: generateId(),
      showId,
      timestamp: Date.now(),
      phaseId,
      type: EventType.host_trigger,
      channel: ChannelType.PUBLIC,
      visibility: ChannelType.PUBLIC,
      senderId: '', // Host events have no sender character
      receiverIds: audienceIds,
      audienceIds,
      content,
      metadata: {
        originalTemplate: triggerTemplate,
      },
      seed,
    };

    await this.eventJournal.append(event);
  }

  /**
   * Process template string with variable substitutions
   * Supports: {{names}}, {{characterName}}, {{count}}, etc.
   *
   * @param showId - Show ID
   * @param template - Template string
   * @param audienceIds - IDs of characters in the audience
   * @returns Processed string
   */
  private async processTemplate(
    showId: string,
    template: string,
    audienceIds: string[]
  ): Promise<string> {
    const characters = await this.store.getCharacters(showId);

    // Build name map for substitution
    const charMap = new Map<string, string>();
    for (const char of characters) {
      // Use characterId as name placeholder (actual names would come from CharacterDefinition)
      charMap.set(char.characterId, char.characterId);
    }

    // Get audience names
    const audienceNames = audienceIds
      .map((id) => charMap.get(id) ?? id)
      .join(', ');

    // Perform substitutions
    let result = template;

    // {{names}} - all audience names
    result = result.replace(/\{\{names\}\}/g, audienceNames);

    // {{count}} - number of participants
    result = result.replace(/\{\{count\}\}/g, audienceIds.length.toString());

    // {{target}} - first target (for private messages)
    if (audienceIds.length > 0) {
      const targetName = charMap.get(audienceIds[0]!) ?? audienceIds[0]!;
      result = result.replace(/\{\{target\}\}/g, targetName);
    }

    return result;
  }
}
