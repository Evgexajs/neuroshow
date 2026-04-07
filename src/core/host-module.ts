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
import { PrivateChannelRules, DecisionConfig } from '../types/primitives.js';
import { CharacterResponse } from '../types/adapter.js';
import { generateId } from '../utils/id.js';
import { config } from '../config.js';

/**
 * Callback type for collecting decisions from characters
 * Used by runDecisionPhase to call the LLM for each character
 */
export type DecisionCallback = (
  characterId: string,
  trigger: string,
  previousDecisions: Array<{ characterId: string; decision: string }>
) => Promise<CharacterResponse>;

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
      // Store phases for runShow
      phases: template.phases,
      // Store character definitions for processCharacterTurn
      characterDefinitions: characters.map((c) => ({
        id: c.id,
        name: c.name,
        publicCard: c.publicCard,
        personalityPrompt: c.personalityPrompt,
        motivationPrompt: c.motivationPrompt,
        boundaryRules: c.boundaryRules,
        speakFrequency: c.speakFrequency,
        responseConstraints: c.responseConstraints,
      })),
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
      replayAvailable: false,
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

  /**
   * Open a private channel between participants
   * Creates a channel_change event in the journal
   *
   * @param showId - Show ID
   * @param participantIds - Array of character IDs participating in the private channel
   */
  async openPrivateChannel(showId: string, participantIds: string[]): Promise<void> {
    const showRecord = await this.store.getShow(showId);
    const seed = showRecord?.seed ?? '0';
    const phaseId = showRecord?.currentPhaseId ?? '';

    const event: Omit<ShowEvent, 'sequenceNumber'> = {
      id: generateId(),
      showId,
      timestamp: Date.now(),
      phaseId,
      type: EventType.channel_change,
      channel: ChannelType.PRIVATE,
      visibility: ChannelType.PRIVATE,
      senderId: '', // System event
      receiverIds: participantIds,
      audienceIds: participantIds,
      content: 'Private channel opened',
      metadata: {
        action: 'open',
        participants: participantIds,
      },
      seed,
    };

    await this.eventJournal.append(event);
  }

  /**
   * Close the current private channel and return to PUBLIC
   * Creates a channel_change event in the journal
   *
   * @param showId - Show ID
   */
  async closePrivateChannel(showId: string): Promise<void> {
    const showRecord = await this.store.getShow(showId);
    const seed = showRecord?.seed ?? '0';
    const phaseId = showRecord?.currentPhaseId ?? '';

    // Get all characters for audience
    const characters = await this.store.getCharacters(showId);
    const allCharacterIds = characters.map((c) => c.characterId);

    const event: Omit<ShowEvent, 'sequenceNumber'> = {
      id: generateId(),
      showId,
      timestamp: Date.now(),
      phaseId,
      type: EventType.channel_change,
      channel: ChannelType.PUBLIC,
      visibility: ChannelType.PUBLIC,
      senderId: '', // System event
      receiverIds: allCharacterIds,
      audienceIds: allCharacterIds,
      content: 'Returned to public channel',
      metadata: {
        action: 'close',
      },
      seed,
    };

    await this.eventJournal.append(event);
  }

  /**
   * Validate a private channel request against the rules
   * Checks limits from privateChannelRules
   *
   * @param showId - Show ID
   * @param requesterId - Character ID requesting private channel
   * @param targetId - Target character ID
   * @param rules - Private channel rules from template
   * @returns true if the request is valid, false otherwise
   */
  async validatePrivateRequest(
    showId: string,
    requesterId: string,
    targetId: string,
    rules: PrivateChannelRules
  ): Promise<boolean> {
    // Get current phase
    const showRecord = await this.store.getShow(showId);
    if (!showRecord) {
      return false;
    }
    const currentPhaseId = showRecord.currentPhaseId;

    // Get all events in current phase
    const allEvents = await this.eventJournal.getEvents(showId);
    const phaseEvents = allEvents.filter((e) => e.phaseId === currentPhaseId);

    // Count private channel openings in current phase
    const privateChannelEvents = phaseEvents.filter(
      (e) =>
        e.type === EventType.channel_change &&
        e.channel === ChannelType.PRIVATE &&
        e.metadata?.action === 'open'
    );

    // Check maxPrivatesPerPhase limit
    if (privateChannelEvents.length >= rules.maxPrivatesPerPhase) {
      return false;
    }

    // Count private channel openings by requester in current phase
    const requesterPrivateCount = privateChannelEvents.filter(
      (e) =>
        Array.isArray(e.metadata?.participants) &&
        (e.metadata.participants as string[]).includes(requesterId)
    ).length;

    // Check maxPrivatesPerCharacterPerPhase limit
    if (requesterPrivateCount >= rules.maxPrivatesPerCharacterPerPhase) {
      return false;
    }

    // Count private channel openings by target in current phase
    const targetPrivateCount = privateChannelEvents.filter(
      (e) =>
        Array.isArray(e.metadata?.participants) &&
        (e.metadata.participants as string[]).includes(targetId)
    ).length;

    // Check maxPrivatesPerCharacterPerPhase limit for target
    if (targetPrivateCount >= rules.maxPrivatesPerCharacterPerPhase) {
      return false;
    }

    return true;
  }

  /**
   * Run the decision phase, collecting decisions from all characters
   *
   * For timing: 'simultaneous' - each character makes their decision without seeing others'
   * For timing: 'sequential' - each character sees previous decisions before making theirs
   *
   * Creates 'decision' events in the journal with appropriate visibility based on decisionConfig.visibility
   *
   * @param showId - Show ID
   * @param decisionConfig - Configuration for the decision phase
   * @param callCharacter - Callback to get character's decision response
   */
  async runDecisionPhase(
    showId: string,
    decisionConfig: DecisionConfig,
    callCharacter: DecisionCallback
  ): Promise<void> {
    // Get show info for phase and seed
    const showRecord = await this.store.getShow(showId);
    if (!showRecord) {
      throw new Error(`Show ${showId} not found`);
    }
    const phaseId = showRecord.currentPhaseId ?? '';
    const seed = showRecord.seed;

    // Get all characters for this show
    const characters = await this.store.getCharacters(showId);
    if (characters.length === 0) {
      return;
    }

    // Build decision trigger template
    const triggerBase = this.buildDecisionTrigger(decisionConfig);

    // Track collected decisions for sequential mode
    const collectedDecisions: Array<{ characterId: string; decision: string }> = [];

    // Determine visibility for decision events
    const visibility =
      decisionConfig.visibility === 'secret_until_reveal'
        ? ChannelType.PRIVATE
        : ChannelType.PUBLIC;

    // Process each character
    for (const character of characters) {
      // Build trigger with previous decisions if sequential
      let trigger = triggerBase;
      if (decisionConfig.timing === 'sequential' && collectedDecisions.length > 0) {
        trigger = this.buildSequentialTrigger(triggerBase, collectedDecisions);
      }

      // Emit host_trigger for this character (for tracking/debugging)
      const triggerId = generateId();
      const triggerEvent: Omit<ShowEvent, 'sequenceNumber'> = {
        id: triggerId,
        showId,
        timestamp: Date.now(),
        phaseId,
        type: EventType.host_trigger,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: '',
        receiverIds: [character.characterId],
        audienceIds: [character.characterId],
        content: trigger,
        metadata: {
          decisionPhase: true,
          timing: decisionConfig.timing,
        },
        seed,
      };
      await this.eventJournal.append(triggerEvent);

      // Call character to get their decision
      const previousDecisions =
        decisionConfig.timing === 'simultaneous' ? [] : collectedDecisions;
      const response = await callCharacter(character.characterId, trigger, previousDecisions);

      // Extract decision value
      const decisionValue = response.decisionValue ?? response.text;

      // Store decision for sequential mode
      collectedDecisions.push({
        characterId: character.characterId,
        decision: decisionValue,
      });

      // Determine audience for this decision event
      // For secret_until_reveal: only the deciding character sees their decision
      // For public_immediately: all characters see the decision
      const audienceIds =
        decisionConfig.visibility === 'secret_until_reveal'
          ? [character.characterId]
          : characters.map((c) => c.characterId);

      // Create decision event in journal
      const decisionEvent: Omit<ShowEvent, 'sequenceNumber'> = {
        id: generateId(),
        showId,
        timestamp: Date.now(),
        phaseId,
        type: EventType.decision,
        channel: visibility,
        visibility,
        senderId: character.characterId,
        receiverIds: audienceIds,
        audienceIds,
        content: response.text,
        metadata: {
          decisionValue,
          format: decisionConfig.format,
          options: decisionConfig.options,
          timing: decisionConfig.timing,
        },
        seed,
      };

      await this.eventJournal.append(decisionEvent);
    }
  }

  /**
   * Build the base decision trigger based on config
   */
  private buildDecisionTrigger(decisionConfig: DecisionConfig): string {
    const parts: string[] = ['It is time to make your decision.'];

    if (decisionConfig.format === 'choice' && decisionConfig.options) {
      parts.push(`Choose one of the following options: ${decisionConfig.options.join(', ')}`);
    } else if (decisionConfig.format === 'ranking' && decisionConfig.options) {
      parts.push(
        `Rank the following options from most to least preferred: ${decisionConfig.options.join(', ')}`
      );
    } else {
      parts.push('Please provide your decision.');
    }

    if (decisionConfig.timing === 'simultaneous') {
      parts.push('Your decision will be kept secret until all participants have decided.');
    }

    return parts.join(' ');
  }

  /**
   * Build trigger with previous decisions for sequential mode
   */
  private buildSequentialTrigger(
    baseTrigger: string,
    previousDecisions: Array<{ characterId: string; decision: string }>
  ): string {
    const decisionsText = previousDecisions
      .map((d) => `- ${d.characterId}: ${d.decision}`)
      .join('\n');

    return `Previous decisions:\n${decisionsText}\n\n${baseTrigger}`;
  }

  /**
   * Run the revelation phase, revealing decisions to all participants
   *
   * For revealMoment: 'after_all' - creates one revelation event with all decisions
   * For revealMoment: 'after_each' - creates one revelation event per decision
   *
   * All revelation events are PUBLIC with audienceIds = all characters
   *
   * @param showId - Show ID
   * @param decisionConfig - Configuration for the revelation
   */
  async runRevelation(showId: string, decisionConfig: DecisionConfig): Promise<void> {
    // Get show info for phase and seed
    const showRecord = await this.store.getShow(showId);
    if (!showRecord) {
      throw new Error(`Show ${showId} not found`);
    }
    const phaseId = showRecord.currentPhaseId ?? '';
    const seed = showRecord.seed;

    // Get all characters for this show (for audienceIds)
    const characters = await this.store.getCharacters(showId);
    if (characters.length === 0) {
      return;
    }
    const allCharacterIds = characters.map((c) => c.characterId);

    // Get all events to find decision events from current phase
    const allEvents = await this.eventJournal.getEvents(showId);
    const decisionEvents = allEvents.filter(
      (e) => e.type === EventType.decision && e.phaseId === phaseId
    );

    if (decisionEvents.length === 0) {
      return;
    }

    if (decisionConfig.revealMoment === 'after_all') {
      // Create one revelation event with all decisions
      const decisionsContent = decisionEvents
        .map((e) => {
          const decisionValue = e.metadata?.decisionValue ?? e.content;
          return `${e.senderId}: ${decisionValue}`;
        })
        .join('\n');

      const revelationEvent: Omit<ShowEvent, 'sequenceNumber'> = {
        id: generateId(),
        showId,
        timestamp: Date.now(),
        phaseId,
        type: EventType.revelation,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: '', // System event
        receiverIds: allCharacterIds,
        audienceIds: allCharacterIds,
        content: `Decision results:\n${decisionsContent}`,
        metadata: {
          revealMoment: 'after_all',
          decisions: decisionEvents.map((e) => ({
            characterId: e.senderId,
            decision: e.metadata?.decisionValue ?? e.content,
          })),
        },
        seed,
      };

      await this.eventJournal.append(revelationEvent);
    } else {
      // revealMoment === 'after_each': create one revelation event per decision
      for (const decisionEvent of decisionEvents) {
        const decisionValue = decisionEvent.metadata?.decisionValue ?? decisionEvent.content;

        const revelationEvent: Omit<ShowEvent, 'sequenceNumber'> = {
          id: generateId(),
          showId,
          timestamp: Date.now(),
          phaseId,
          type: EventType.revelation,
          channel: ChannelType.PUBLIC,
          visibility: ChannelType.PUBLIC,
          senderId: decisionEvent.senderId,
          receiverIds: allCharacterIds,
          audienceIds: allCharacterIds,
          content: `${decisionEvent.senderId} decided: ${decisionValue}`,
          metadata: {
            revealMoment: 'after_each',
            characterId: decisionEvent.senderId,
            decision: decisionValue,
          },
          seed,
        };

        await this.eventJournal.append(revelationEvent);
      }
    }
  }
}
