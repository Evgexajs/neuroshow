/**
 * HostModule - Manages show lifecycle and orchestration
 * Based on PRD.md - Host Module responsibilities
 */

import type { IStore, ShowRecord, ShowCharacterRecord, TokenBudgetRecord } from '../types/interfaces/store.interface.js';
import type { EventJournal } from './event-journal.js';
import type { ShowFormatTemplate, Phase } from '../types/template.js';
import type { CharacterDefinition } from '../types/character.js';
import type { Show } from '../types/runtime.js';
import type { ShowEvent } from '../types/events.js';
import { ShowStatus, BudgetMode, EventType, ChannelType } from '../types/enums.js';
import type { PrivateChannelRules, DecisionConfig, Relationship } from '../types/primitives.js';
import type { CharacterResponse } from '../types/adapter.js';
import { generateId } from '../utils/id.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

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
   * @param tokenBudget - Optional token budget (defaults to config.tokenBudgetPerShow)
   * @param backstory - Optional show backstory (generated or provided)
   * @param relationships - Optional relationships between characters
   * @returns Initialized Show object
   */
  async initializeShow(
    template: ShowFormatTemplate,
    characters: Array<CharacterDefinition & { modelAdapterId?: string }>,
    seed?: number,
    tokenBudget?: number,
    backstory?: string,
    relationships?: Relationship[]
  ): Promise<Show> {
    const showId = generateId();
    const showSeed = seed ?? Math.floor(Math.random() * 2147483647);
    const startedAt = new Date();

    // Build config snapshot
    const configSnapshot: Record<string, unknown> = {
      templateId: template.id,
      templateName: template.name,
      templateDescription: template.description,
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
      // Store backstory if provided
      backstory,
      // Store relationships between characters
      relationships: relationships ?? [],
    };

    // Create show record with 'created' status (will change to 'running' when started)
    const showRecord: ShowRecord = {
      id: showId,
      formatId: template.id,
      seed: showSeed.toString(),
      status: ShowStatus.created,
      currentPhaseId: template.phases.length > 0 ? template.phases[0]!.id : null,
      startedAt: null,
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
      totalLimit: tokenBudget ?? config.tokenBudgetPerShow,
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
      status: ShowStatus.created,
      currentPhaseId: template.phases.length > 0 ? template.phases[0]!.id : null,
      startedAt: null,
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
    logger.info(`[Private Channel] Opened private channel between: ${participantIds.join(', ')}`);
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
    logger.info(`[Private Channel] Closed private channel, returned to PUBLIC`);
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

    // Get character definitions from configSnapshot to access names
    const configSnapshot = JSON.parse(showRecord.configSnapshot) as Record<string, unknown>;
    const characterDefinitions = configSnapshot.characterDefinitions as
      | Array<{ id: string; name: string; responseConstraints?: { language?: string } }>
      | undefined;

    // Build name map: characterId -> name
    const nameMap = new Map<string, string>();
    let isRussian = false;
    if (characterDefinitions) {
      for (const def of characterDefinitions) {
        nameMap.set(def.id, def.name);
        // Check language from first character's responseConstraints
        if (def.responseConstraints?.language === 'ru') {
          isRussian = true;
        }
      }
    }

    // Track collected decisions for sequential mode
    const collectedDecisions: Array<{ characterId: string; decision: string }> = [];

    // Determine visibility for decision events
    const visibility =
      decisionConfig.visibility === 'secret_until_reveal'
        ? ChannelType.PRIVATE
        : ChannelType.PUBLIC;

    // Process each character
    for (const character of characters) {
      // Get current character's name and build candidate list (other participants)
      const currentCharacterName = nameMap.get(character.characterId) ?? character.characterId;
      const candidateNames = characters
        .filter((c) => c.characterId !== character.characterId)
        .map((c) => nameMap.get(c.characterId) ?? c.characterId);

      // Build decision trigger with candidate names
      const triggerBase = this.buildDecisionTrigger(
        decisionConfig,
        currentCharacterName,
        candidateNames,
        isRussian
      );

      // Build trigger with previous decisions if sequential
      let trigger = triggerBase;
      if (decisionConfig.timing === 'sequential' && collectedDecisions.length > 0) {
        trigger = this.buildSequentialTrigger(triggerBase, collectedDecisions, nameMap);
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

      // Extract and validate decision value
      const rawDecisionValue = response.decisionValue ?? response.text;
      const decisionValue = this.validateDecisionValue(
        rawDecisionValue,
        response.text,
        character.characterId,
        currentCharacterName,
        candidateNames,
        nameMap,
        decisionConfig
      );

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
   *
   * @param decisionConfig - Decision configuration
   * @param currentCharacterName - Name of the character being asked
   * @param candidateNames - Names of other participants (candidates to vote for)
   * @param isRussian - Whether to use Russian language
   */
  private buildDecisionTrigger(
    decisionConfig: DecisionConfig,
    currentCharacterName: string,
    candidateNames: string[],
    isRussian: boolean
  ): string {
    const parts: string[] = [];

    if (isRussian) {
      // Russian version
      parts.push('Время ФИНАЛЬНОГО голосования.');
      parts.push('');
      parts.push(`Ты — ${currentCharacterName}. Это НЕ обсуждение, а голосование.`);
      parts.push('');
      parts.push(`Кандидаты (за кого можно голосовать): ${candidateNames.join(', ')}`);
      parts.push('');
      parts.push('ПРАВИЛА ГОЛОСОВАНИЯ:');
      parts.push('- Ты ДОЛЖЕН выбрать ОДНОГО из кандидатов выше');
      parts.push('- Ты НЕ МОЖЕШЬ голосовать за себя');
      parts.push('- В поле "decisionValue" укажи ИМЯ выбранного участника');
      parts.push('');
      if (candidateNames.length > 0) {
        parts.push(`Пример: "decisionValue": "${candidateNames[0]}" (голос за ${candidateNames[0]})`);
        parts.push('');
      }
      if (decisionConfig.timing === 'simultaneous') {
        parts.push('Твой голос останется тайным до объявления результатов.');
      }
    } else {
      // English version
      parts.push('Time for the FINAL vote.');
      parts.push('');
      parts.push(`You are ${currentCharacterName}. This is NOT a discussion, it is a vote.`);
      parts.push('');
      parts.push(`Candidates (who you can vote for): ${candidateNames.join(', ')}`);
      parts.push('');
      parts.push('VOTING RULES:');
      parts.push('- You MUST choose ONE of the candidates above');
      parts.push('- You CANNOT vote for yourself');
      parts.push('- In the "decisionValue" field, enter the NAME of your chosen participant');
      parts.push('');
      if (candidateNames.length > 0) {
        parts.push(`Example: "decisionValue": "${candidateNames[0]}" (vote for ${candidateNames[0]})`);
        parts.push('');
      }
      if (decisionConfig.timing === 'simultaneous') {
        parts.push('Your vote will remain secret until results are announced.');
      }
    }

    return parts.join('\n');
  }

  /**
   * Build trigger with previous decisions for sequential mode
   */
  private buildSequentialTrigger(
    baseTrigger: string,
    previousDecisions: Array<{ characterId: string; decision: string }>,
    nameMap: Map<string, string>
  ): string {
    const decisionsText = previousDecisions
      .map((d) => {
        const name = nameMap.get(d.characterId) ?? d.characterId;
        return `- ${name}: ${d.decision}`;
      })
      .join('\n');

    return `Previous decisions:\n${decisionsText}\n\n${baseTrigger}`;
  }

  /**
   * Validate and normalize decision value
   *
   * - If decisionConfig.options is provided, checks that value matches an option (for structured choices)
   * - Otherwise checks that decisionValue is a valid candidate (name or ID of another participant)
   * - Prevents voting for self
   * - Attempts to extract valid name from response text if decisionValue is invalid
   * - Returns 'invalid' if no valid candidate can be identified
   *
   * @param rawValue - Raw decision value from LLM response
   * @param responseText - Full response text (used for extraction fallback)
   * @param voterId - Character ID of the voter
   * @param voterName - Name of the voter
   * @param candidateNames - List of valid candidate names
   * @param nameMap - Map of characterId -> name
   * @param decisionConfig - Decision configuration with format and options
   * @returns Validated decision value or 'invalid'
   */
  private validateDecisionValue(
    rawValue: string,
    responseText: string,
    voterId: string,
    voterName: string,
    candidateNames: string[],
    nameMap: Map<string, string>,
    decisionConfig: DecisionConfig
  ): string {
    // Normalize raw value
    const normalizedValue = rawValue?.trim() ?? '';

    // Check if value is empty
    if (!normalizedValue || normalizedValue.length === 0) {
      logger.warn(
        `[Decision] ${voterName} (${voterId}) provided empty decision value. ` +
          `Attempting extraction from text.`
      );
      return this.extractCandidateFromText(responseText, candidateNames, voterName);
    }

    // If decisionConfig.options is provided, check if value matches an option (structured choice)
    if (decisionConfig.options && decisionConfig.options.length > 0) {
      const matchedOption = decisionConfig.options.find(
        (opt) => opt.toLowerCase() === normalizedValue.toLowerCase()
      );
      if (matchedOption) {
        return matchedOption; // Return properly cased option
      }
      // For structured choices, if no option matches, still allow free text
      // (unless it's strictly a choice format - but PRD allows flexibility)
      if (decisionConfig.format === 'free_text') {
        return normalizedValue;
      }
    }

    // For free_text format without options, accept any value (but still check for self-voting)
    if (decisionConfig.format === 'free_text' && !decisionConfig.options) {
      // Check if voting for self
      if (
        normalizedValue === voterName ||
        normalizedValue.toLowerCase() === voterName.toLowerCase() ||
        normalizedValue === voterId
      ) {
        logger.warn(
          `[Decision] ${voterName} (${voterId}) attempted to vote for themselves. ` +
            `Value: "${normalizedValue}". Attempting extraction from text.`
        );
        return this.extractCandidateFromText(responseText, candidateNames, voterName);
      }
      return normalizedValue;
    }

    // Build set of valid candidate identifiers (names and IDs)
    const validCandidates = new Set<string>();

    for (const name of candidateNames) {
      validCandidates.add(name);
      validCandidates.add(name.toLowerCase());
    }

    // Add character IDs (except voter's)
    for (const [charId] of nameMap.entries()) {
      if (charId !== voterId) {
        validCandidates.add(charId);
      }
    }

    // Check if voting for self (by name or ID)
    if (
      normalizedValue === voterName ||
      normalizedValue.toLowerCase() === voterName.toLowerCase() ||
      normalizedValue === voterId
    ) {
      logger.warn(
        `[Decision] ${voterName} (${voterId}) attempted to vote for themselves. ` +
          `Value: "${normalizedValue}". Attempting extraction from text.`
      );
      return this.extractCandidateFromText(responseText, candidateNames, voterName);
    }

    // Check if value matches a valid candidate (case-insensitive for names)
    if (validCandidates.has(normalizedValue) || validCandidates.has(normalizedValue.toLowerCase())) {
      // Return the properly cased name if matched by lowercase
      const matchedName = candidateNames.find(
        (name) => name.toLowerCase() === normalizedValue.toLowerCase()
      );
      return matchedName ?? normalizedValue;
    }

    // Value doesn't match any valid candidate - try extraction
    logger.warn(
      `[Decision] ${voterName} (${voterId}) provided invalid decision value: "${normalizedValue}". ` +
        `Valid candidates: [${candidateNames.join(', ')}]. Attempting extraction from text.`
    );
    return this.extractCandidateFromText(responseText, candidateNames, voterName);
  }

  /**
   * Attempt to extract a valid candidate name from response text
   *
   * @param text - Full response text
   * @param candidateNames - List of valid candidate names
   * @param voterName - Name of the voter (to exclude from matches)
   * @returns Extracted candidate name or 'invalid'
   */
  private extractCandidateFromText(
    text: string,
    candidateNames: string[],
    voterName: string
  ): string {
    const textLower = text.toLowerCase();

    // Look for candidate names in the text (case-insensitive)
    for (const candidate of candidateNames) {
      if (candidate.toLowerCase() === voterName.toLowerCase()) {
        continue; // Skip voter's own name
      }
      if (textLower.includes(candidate.toLowerCase())) {
        logger.info(
          `[Decision] Extracted candidate "${candidate}" from response text.`
        );
        return candidate;
      }
    }

    // No valid candidate found
    logger.warn(
      `[Decision] Could not extract valid candidate from text. Marking as 'invalid'.`
    );
    return 'invalid';
  }

  /**
   * Run the revelation phase, revealing decisions to all participants
   *
   * For revealMoment: 'after_all' - creates one revelation event with all decisions
   * For revealMoment: 'after_each' - creates one revelation event per decision
   *
   * All revelation events are PUBLIC with audienceIds = all characters
   *
   * Results include:
   * - Vote counts per candidate (using names, not IDs)
   * - Winner determination (most votes)
   * - Tie handling (show all leaders or use first-voter tiebreaker)
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

    // Get character definitions from configSnapshot to build name map
    const configSnapshot = JSON.parse(showRecord.configSnapshot) as Record<string, unknown>;
    const characterDefinitions = configSnapshot.characterDefinitions as
      | Array<{ id: string; name: string; responseConstraints?: { language?: string } }>
      | undefined;

    // Build name map: characterId -> name
    const nameMap = new Map<string, string>();
    let isRussian = false;
    if (characterDefinitions) {
      for (const def of characterDefinitions) {
        nameMap.set(def.id, def.name);
        if (def.responseConstraints?.language === 'ru') {
          isRussian = true;
        }
      }
    }

    // Helper to get name from ID
    const getName = (id: string): string => nameMap.get(id) ?? id;

    // Get all events to find decision events from current phase
    const allEvents = await this.eventJournal.getEvents(showId);
    const decisionEvents = allEvents.filter(
      (e) => e.type === EventType.decision && e.phaseId === phaseId
    );

    if (decisionEvents.length === 0) {
      return;
    }

    // Count votes for each candidate
    const voteCounts = new Map<string, number>();
    const voteOrder: string[] = []; // Track order of votes for tiebreaker

    for (const event of decisionEvents) {
      const decision = (event.metadata?.decisionValue ?? event.content) as string;
      if (decision && decision !== 'invalid') {
        const currentCount = voteCounts.get(decision) ?? 0;
        voteCounts.set(decision, currentCount + 1);
        if (!voteOrder.includes(decision)) {
          voteOrder.push(decision);
        }
      }
    }

    // Determine winner(s)
    let maxVotes = 0;
    for (const count of voteCounts.values()) {
      if (count > maxVotes) {
        maxVotes = count;
      }
    }

    const leaders: string[] = [];
    for (const [candidate, count] of voteCounts.entries()) {
      if (count === maxVotes) {
        leaders.push(candidate);
      }
    }

    // Determine final winner and tiebreaker info
    let winner: string | null = null;
    let tiebreakerUsed = false;
    let tiebreakerRule = '';

    if (leaders.length === 1) {
      winner = leaders[0]!;
    } else if (leaders.length > 1) {
      // Use first-voter tiebreaker: the candidate who received their first vote earliest wins
      tiebreakerUsed = true;
      for (const candidate of voteOrder) {
        if (leaders.includes(candidate)) {
          winner = candidate;
          break;
        }
      }
      tiebreakerRule = isRussian ? 'первый получивший голос' : 'first to receive a vote';
    }

    if (decisionConfig.revealMoment === 'after_all') {
      // Build human-readable results with names and vote counts
      const voteCountsArray = Array.from(voteCounts.entries())
        .sort((a, b) => b[1] - a[1]) // Sort by vote count descending
        .map(([candidate, count]) => {
          const voteWord = this.getVoteWord(count, isRussian);
          return `${candidate} - ${count} ${voteWord}`;
        });

      // Build voter list with names
      const votersList = decisionEvents
        .map((e) => {
          const voterName = getName(e.senderId);
          const decision = (e.metadata?.decisionValue ?? e.content) as string;
          return `${voterName}: ${decision}`;
        })
        .join('\n');

      // Build final content
      let content: string;
      if (isRussian) {
        content = `Результаты голосования:\n${votersList}\n\nИтог: ${voteCountsArray.join(', ')}.`;
        if (winner) {
          if (tiebreakerUsed) {
            content += ` Победитель: ${winner} (по правилу: ${tiebreakerRule})`;
          } else {
            content += ` Победитель: ${winner}`;
          }
        } else if (leaders.length > 1) {
          content += ` Ничья между: ${leaders.join(', ')}`;
        }
      } else {
        content = `Voting results:\n${votersList}\n\nSummary: ${voteCountsArray.join(', ')}.`;
        if (winner) {
          if (tiebreakerUsed) {
            content += ` Winner: ${winner} (by rule: ${tiebreakerRule})`;
          } else {
            content += ` Winner: ${winner}`;
          }
        } else if (leaders.length > 1) {
          content += ` Tie between: ${leaders.join(', ')}`;
        }
      }

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
        content,
        metadata: {
          revealMoment: 'after_all',
          decisions: decisionEvents.map((e) => ({
            characterId: e.senderId,
            characterName: getName(e.senderId),
            decision: e.metadata?.decisionValue ?? e.content,
          })),
          voteCounts: Object.fromEntries(voteCounts),
          winner,
          leaders,
          tiebreakerUsed,
          tiebreakerRule: tiebreakerUsed ? tiebreakerRule : undefined,
        },
        seed,
      };

      await this.eventJournal.append(revelationEvent);
    } else {
      // revealMoment === 'after_each': create one revelation event per decision
      for (const decisionEvent of decisionEvents) {
        const voterName = getName(decisionEvent.senderId);
        const decisionValue = (decisionEvent.metadata?.decisionValue ?? decisionEvent.content) as string;

        const content = isRussian
          ? `${voterName} проголосовал за: ${decisionValue}`
          : `${voterName} voted for: ${decisionValue}`;

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
          content,
          metadata: {
            revealMoment: 'after_each',
            characterId: decisionEvent.senderId,
            characterName: voterName,
            decision: decisionValue,
          },
          seed,
        };

        await this.eventJournal.append(revelationEvent);
      }

      // After all individual revelations, emit final summary with winner
      const voteCountsArray = Array.from(voteCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([candidate, count]) => {
          const voteWord = this.getVoteWord(count, isRussian);
          return `${candidate} - ${count} ${voteWord}`;
        });

      let summaryContent: string;
      if (isRussian) {
        summaryContent = `Итог: ${voteCountsArray.join(', ')}.`;
        if (winner) {
          if (tiebreakerUsed) {
            summaryContent += ` Победитель: ${winner} (по правилу: ${tiebreakerRule})`;
          } else {
            summaryContent += ` Победитель: ${winner}`;
          }
        } else if (leaders.length > 1) {
          summaryContent += ` Ничья между: ${leaders.join(', ')}`;
        }
      } else {
        summaryContent = `Summary: ${voteCountsArray.join(', ')}.`;
        if (winner) {
          if (tiebreakerUsed) {
            summaryContent += ` Winner: ${winner} (by rule: ${tiebreakerRule})`;
          } else {
            summaryContent += ` Winner: ${winner}`;
          }
        } else if (leaders.length > 1) {
          summaryContent += ` Tie between: ${leaders.join(', ')}`;
        }
      }

      const summaryEvent: Omit<ShowEvent, 'sequenceNumber'> = {
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
        content: summaryContent,
        metadata: {
          revealMoment: 'after_each_summary',
          voteCounts: Object.fromEntries(voteCounts),
          winner,
          leaders,
          tiebreakerUsed,
          tiebreakerRule: tiebreakerUsed ? tiebreakerRule : undefined,
        },
        seed,
      };

      await this.eventJournal.append(summaryEvent);
    }
  }

  /**
   * Get the correct word form for "vote(s)" based on count and language
   * Handles Russian plural forms (1 голос, 2-4 голоса, 5+ голосов)
   */
  private getVoteWord(count: number, isRussian: boolean): string {
    if (!isRussian) {
      return count === 1 ? 'vote' : 'votes';
    }

    // Russian plural rules
    const lastTwo = count % 100;
    const lastOne = count % 10;

    if (lastTwo >= 11 && lastTwo <= 19) {
      return 'голосов';
    }
    if (lastOne === 1) {
      return 'голос';
    }
    if (lastOne >= 2 && lastOne <= 4) {
      return 'голоса';
    }
    return 'голосов';
  }
}
