/**
 * Decision Phase Logic - extracted from HostModule
 * Handles voting, validation, and revelation
 */

import { IStore } from '../../types/interfaces/store.interface.js';
import { EventJournal } from '../../core/event-journal.js';
import { ShowEvent } from '../../types/events.js';
import { EventType, ChannelType } from '../../types/enums.js';
import { DecisionConfig } from '../../types/primitives.js';
import { generateId } from '../../utils/id.js';
import { logger } from '../../utils/logger.js';
import { DecisionCallback, RevelationResult } from './types.js';

/**
 * DecisionPhaseHandler - manages decision/voting phase logic
 */
export class DecisionPhaseHandler {
  constructor(
    private readonly store: IStore,
    private readonly eventJournal: EventJournal
  ) {}

  /**
   * Run the decision phase for all characters
   * Collects votes from each character and stores decision events
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
   * Run revelation phase - reveal voting results
   * Returns tiebreakerNeeded with finalists if revote mode and tie detected
   */
  async runRevelation(showId: string, decisionConfig: DecisionConfig): Promise<RevelationResult> {
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
      return {};
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
      return {};
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
      // Tie detected - emit tiebreaker_start event
      tiebreakerUsed = true;
      const mode = decisionConfig.tiebreakerMode ?? 'random';

      const tiebreakerContent = isRussian
        ? `Ничья! Финалисты: ${leaders.join(', ')}. Требуется переголосование.`
        : `Tie detected! Finalists: ${leaders.join(', ')}. Tiebreaker required.`;

      const tiebreakerStartEvent: Omit<ShowEvent, 'sequenceNumber'> = {
        id: generateId(),
        showId,
        timestamp: Date.now(),
        phaseId,
        type: EventType.tiebreaker_start,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: '', // System event
        receiverIds: allCharacterIds,
        audienceIds: allCharacterIds,
        content: tiebreakerContent,
        metadata: {
          finalists: leaders,
          voteCounts: Object.fromEntries(voteCounts),
          tiebreakerMode: mode,
        },
        seed,
      };

      await this.eventJournal.append(tiebreakerStartEvent);

      // For revote or duel mode, return finalists and let orchestrator call appropriate handler
      if (mode === 'revote' || mode === 'duel') {
        return { tiebreakerNeeded: leaders };
      }

      // For other modes, resolve tie immediately
      if (mode === 'random') {
        // Random selection among finalists
        const randomIndex = Math.floor(Math.random() * leaders.length);
        winner = leaders[randomIndex]!;
        tiebreakerRule = isRussian ? 'случайный выбор' : 'random selection';
      } else {
        // Default: first-voter tiebreaker
        for (const candidate of voteOrder) {
          if (leaders.includes(candidate)) {
            winner = candidate;
            break;
          }
        }
        tiebreakerRule = isRussian ? 'первый получивший голос' : 'first to receive a vote';
      }
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

      // Dramatic winner announcement
      if (winner) {
        const dramaticContent = isRussian
          ? `Голоса подсчитаны... Напряжение нарастает... Победитель сегодняшнего шоу — ${winner}!`
          : `The votes are in... The tension builds... The winner of today's show is — ${winner}!`;

        const announcementEvent: Omit<ShowEvent, 'sequenceNumber'> = {
          id: generateId(),
          showId,
          timestamp: Date.now(),
          phaseId,
          type: EventType.winner_announcement,
          channel: ChannelType.PUBLIC,
          visibility: ChannelType.PUBLIC,
          senderId: '', // System event
          receiverIds: allCharacterIds,
          audienceIds: allCharacterIds,
          content: dramaticContent,
          metadata: {
            winner,
            tiebreakerUsed,
          },
          seed,
        };

        await this.eventJournal.append(announcementEvent);
      }
    }

    return winner ? { winner } : {};
  }

  /**
   * Run tiebreaker revote between finalists
   * Only non-finalists vote, only for finalists
   * If still tied, random selection is used
   */
  async runTiebreaker(
    showId: string,
    finalists: string[],
    _decisionConfig: DecisionConfig,
    callCharacter: DecisionCallback
  ): Promise<void> {
    // Get show info
    const showRecord = await this.store.getShow(showId);
    if (!showRecord) {
      throw new Error(`Show ${showId} not found`);
    }
    const phaseId = showRecord.currentPhaseId ?? '';
    const seed = showRecord.seed;

    // Get all characters
    const characters = await this.store.getCharacters(showId);
    if (characters.length === 0) {
      return;
    }

    // Get character definitions from configSnapshot
    const configSnapshot = JSON.parse(showRecord.configSnapshot) as Record<string, unknown>;
    const characterDefinitions = configSnapshot.characterDefinitions as
      | Array<{ id: string; name: string; responseConstraints?: { language?: string } }>
      | undefined;

    // Build name map and reverse map
    const nameMap = new Map<string, string>(); // id -> name
    const idMap = new Map<string, string>(); // name -> id
    let isRussian = false;
    if (characterDefinitions) {
      for (const def of characterDefinitions) {
        nameMap.set(def.id, def.name);
        idMap.set(def.name, def.id);
        if (def.responseConstraints?.language === 'ru') {
          isRussian = true;
        }
      }
    }

    const allCharacterIds = characters.map((c) => c.characterId);

    // Convert finalist names to IDs if needed
    const finalistIds = new Set<string>();
    for (const f of finalists) {
      // Check if it's already an ID
      if (nameMap.has(f)) {
        finalistIds.add(f);
      } else if (idMap.has(f)) {
        finalistIds.add(idMap.get(f)!);
      } else {
        // Treat as name and try to find
        finalistIds.add(f);
      }
    }

    // Get voters (non-finalists only)
    const voters = characters.filter((c) => {
      const name = nameMap.get(c.characterId) ?? c.characterId;
      return !finalistIds.has(c.characterId) && !finalists.includes(name);
    });

    if (voters.length === 0) {
      // No voters available - use random selection
      const randomIndex = Math.floor(Math.random() * finalists.length);
      const winner = finalists[randomIndex]!;
      await this.emitTiebreakerResult(
        showId,
        phaseId,
        seed,
        winner,
        finalists,
        new Map(),
        isRussian,
        allCharacterIds,
        'no_voters_random'
      );

      // Emit dramatic winner announcement
      const dramaticContent = isRussian
        ? `Голоса подсчитаны... Напряжение нарастает... Победитель сегодняшнего шоу — ${winner}!`
        : `The votes are in... The tension builds... The winner of today's show is — ${winner}!`;

      const announcementEvent: Omit<ShowEvent, 'sequenceNumber'> = {
        id: generateId(),
        showId,
        timestamp: Date.now(),
        phaseId,
        type: EventType.winner_announcement,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: '',
        receiverIds: allCharacterIds,
        audienceIds: allCharacterIds,
        content: dramaticContent,
        metadata: {
          winner,
          tiebreakerUsed: true,
        },
        seed,
      };
      await this.eventJournal.append(announcementEvent);

      // Run winner speech
      await this.runWinnerSpeech(showId, winner, callCharacter);
      return;
    }

    // Collect revotes
    const revoteDecisions: Array<{ characterId: string; decision: string }> = [];

    for (const voter of voters) {
      const voterName = nameMap.get(voter.characterId) ?? voter.characterId;

      // Build tiebreaker trigger
      const trigger = this.buildTiebreakerTrigger(finalists, voterName, isRussian);

      // Emit host_trigger for this revote
      const triggerEvent: Omit<ShowEvent, 'sequenceNumber'> = {
        id: generateId(),
        showId,
        timestamp: Date.now(),
        phaseId,
        type: EventType.host_trigger,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: '',
        receiverIds: [voter.characterId],
        audienceIds: [voter.characterId],
        content: trigger,
        metadata: {
          tiebreakerRevote: true,
          finalists,
        },
        seed,
      };
      await this.eventJournal.append(triggerEvent);

      // Call character for revote
      const response = await callCharacter(voter.characterId, trigger, []);

      // Validate decision - must be one of the finalists
      const rawValue = response.decisionValue ?? response.text;
      const decisionValue = this.validateTiebreakerVote(
        rawValue,
        response.text,
        finalists,
        voterName
      );

      revoteDecisions.push({
        characterId: voter.characterId,
        decision: decisionValue,
      });

      // Create decision event for revote
      const decisionEvent: Omit<ShowEvent, 'sequenceNumber'> = {
        id: generateId(),
        showId,
        timestamp: Date.now(),
        phaseId,
        type: EventType.decision,
        channel: ChannelType.PRIVATE,
        visibility: ChannelType.PRIVATE,
        senderId: voter.characterId,
        receiverIds: [voter.characterId],
        audienceIds: [voter.characterId],
        content: response.text,
        metadata: {
          decisionValue,
          tiebreakerRevote: true,
          finalists,
        },
        seed,
      };
      await this.eventJournal.append(decisionEvent);
    }

    // Count revote results
    const voteCounts = new Map<string, number>();
    for (const d of revoteDecisions) {
      if (d.decision && d.decision !== 'invalid') {
        const count = voteCounts.get(d.decision) ?? 0;
        voteCounts.set(d.decision, count + 1);
      }
    }

    // Find winner
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

    let winner: string;
    let rule: string;

    if (leaders.length === 1) {
      winner = leaders[0]!;
      rule = 'revote';
    } else if (leaders.length > 1) {
      // Still a tie - random selection
      const randomIndex = Math.floor(Math.random() * leaders.length);
      winner = leaders[randomIndex]!;
      rule = isRussian ? 'случайный выбор после ничьей' : 'random after tie';
    } else {
      // No valid votes - random from original finalists
      const randomIndex = Math.floor(Math.random() * finalists.length);
      winner = finalists[randomIndex]!;
      rule = isRussian ? 'случайный выбор (нет голосов)' : 'random (no votes)';
    }

    // Emit tiebreaker_result
    await this.emitTiebreakerResult(
      showId,
      phaseId,
      seed,
      winner,
      finalists,
      voteCounts,
      isRussian,
      allCharacterIds,
      rule
    );

    // Emit dramatic winner announcement
    const dramaticContent = isRussian
      ? `Голоса подсчитаны... Напряжение нарастает... Победитель сегодняшнего шоу — ${winner}!`
      : `The votes are in... The tension builds... The winner of today's show is — ${winner}!`;

    const announcementEvent: Omit<ShowEvent, 'sequenceNumber'> = {
      id: generateId(),
      showId,
      timestamp: Date.now(),
      phaseId,
      type: EventType.winner_announcement,
      channel: ChannelType.PUBLIC,
      visibility: ChannelType.PUBLIC,
      senderId: '',
      receiverIds: allCharacterIds,
      audienceIds: allCharacterIds,
      content: dramaticContent,
      metadata: {
        winner,
        tiebreakerUsed: true,
      },
      seed,
    };
    await this.eventJournal.append(announcementEvent);

    // Run winner speech
    await this.runWinnerSpeech(showId, winner, callCharacter);

    // Run loser reactions
    await this.runLoserReactions(showId, winner, callCharacter);
  }

  /**
   * Build trigger for tiebreaker revote
   */
  private buildTiebreakerTrigger(
    finalists: string[],
    voterName: string,
    isRussian: boolean
  ): string {
    const parts: string[] = [];

    if (isRussian) {
      parts.push('ПЕРЕГОЛОСОВАНИЕ! Была ничья между финалистами.');
      parts.push('');
      parts.push(`Ты — ${voterName}. Голосуй за ОДНОГО из финалистов.`);
      parts.push('');
      parts.push(`Финалисты: ${finalists.join(', ')}`);
      parts.push('');
      parts.push('ПРАВИЛА:');
      parts.push('- Выбери ОДНОГО из финалистов выше');
      parts.push('- В поле "decisionValue" укажи ИМЯ выбранного финалиста');
      if (finalists.length > 0) {
        parts.push(`Пример: "decisionValue": "${finalists[0]}"`);
      }
    } else {
      parts.push('REVOTE! There was a tie between finalists.');
      parts.push('');
      parts.push(`You are ${voterName}. Vote for ONE of the finalists.`);
      parts.push('');
      parts.push(`Finalists: ${finalists.join(', ')}`);
      parts.push('');
      parts.push('RULES:');
      parts.push('- Choose ONE of the finalists above');
      parts.push('- In the "decisionValue" field, enter the NAME of your chosen finalist');
      if (finalists.length > 0) {
        parts.push(`Example: "decisionValue": "${finalists[0]}"`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Validate tiebreaker vote - must be one of the finalists
   */
  private validateTiebreakerVote(
    rawValue: string,
    responseText: string,
    finalists: string[],
    voterName: string
  ): string {
    const normalizedValue = rawValue?.trim() ?? '';

    // Check if matches a finalist (case-insensitive)
    const matchedFinalist = finalists.find(
      (f) => f.toLowerCase() === normalizedValue.toLowerCase()
    );
    if (matchedFinalist) {
      return matchedFinalist;
    }

    // Try to extract from response text
    const textLower = responseText.toLowerCase();
    for (const finalist of finalists) {
      if (textLower.includes(finalist.toLowerCase())) {
        logger.info(
          `[Tiebreaker] Extracted finalist "${finalist}" from ${voterName}'s response text.`
        );
        return finalist;
      }
    }

    logger.warn(
      `[Tiebreaker] ${voterName} provided invalid vote: "${normalizedValue}". ` +
        `Valid finalists: [${finalists.join(', ')}]. Marking as 'invalid'.`
    );
    return 'invalid';
  }

  /**
   * Emit tiebreaker_result event with the final winner
   */
  private async emitTiebreakerResult(
    showId: string,
    phaseId: string,
    seed: string,
    winner: string,
    finalists: string[],
    voteCounts: Map<string, number>,
    isRussian: boolean,
    audienceIds: string[],
    rule: string
  ): Promise<void> {
    const voteCountsArray = Array.from(voteCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([candidate, count]) => {
        const voteWord = this.getVoteWord(count, isRussian);
        return `${candidate} - ${count} ${voteWord}`;
      });

    let content: string;
    if (isRussian) {
      if (voteCountsArray.length > 0) {
        content = `Результаты переголосования: ${voteCountsArray.join(', ')}. Победитель: ${winner}!`;
      } else {
        content = `Победитель по правилу "${rule}": ${winner}!`;
      }
    } else {
      if (voteCountsArray.length > 0) {
        content = `Revote results: ${voteCountsArray.join(', ')}. Winner: ${winner}!`;
      } else {
        content = `Winner by rule "${rule}": ${winner}!`;
      }
    }

    const resultEvent: Omit<ShowEvent, 'sequenceNumber'> = {
      id: generateId(),
      showId,
      timestamp: Date.now(),
      phaseId,
      type: EventType.tiebreaker_result,
      channel: ChannelType.PUBLIC,
      visibility: ChannelType.PUBLIC,
      senderId: '',
      receiverIds: audienceIds,
      audienceIds,
      content,
      metadata: {
        winner,
        finalists,
        voteCounts: Object.fromEntries(voteCounts),
        rule,
      },
      seed,
    };

    await this.eventJournal.append(resultEvent);
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

  /**
   * Run duel tiebreaker - finalists give final speeches, then revote
   * Each finalist gets 1 turn to convince others why they deserve to win
   * After speeches, runs revote
   */
  async runDuelTiebreaker(
    showId: string,
    finalists: string[],
    decisionConfig: DecisionConfig,
    callCharacter: DecisionCallback
  ): Promise<void> {
    // Get show info
    const showRecord = await this.store.getShow(showId);
    if (!showRecord) {
      throw new Error(`Show ${showId} not found`);
    }
    const phaseId = showRecord.currentPhaseId ?? '';
    const seed = showRecord.seed;

    // Get all characters
    const characters = await this.store.getCharacters(showId);
    if (characters.length === 0) {
      return;
    }

    // Get character definitions from configSnapshot
    const configSnapshot = JSON.parse(showRecord.configSnapshot) as Record<string, unknown>;
    const characterDefinitions = configSnapshot.characterDefinitions as
      | Array<{ id: string; name: string; responseConstraints?: { language?: string } }>
      | undefined;

    // Build name map and reverse map
    const nameMap = new Map<string, string>(); // id -> name
    const idMap = new Map<string, string>(); // name -> id
    let isRussian = false;
    if (characterDefinitions) {
      for (const def of characterDefinitions) {
        nameMap.set(def.id, def.name);
        idMap.set(def.name, def.id);
        if (def.responseConstraints?.language === 'ru') {
          isRussian = true;
        }
      }
    }

    const allCharacterIds = characters.map((c) => c.characterId);

    // Convert finalist names to IDs if needed
    const finalistIds = new Set<string>();
    for (const f of finalists) {
      if (nameMap.has(f)) {
        finalistIds.add(f);
      } else if (idMap.has(f)) {
        finalistIds.add(idMap.get(f)!);
      } else {
        finalistIds.add(f);
      }
    }

    // Get finalist characters for the duel speeches
    const finalistCharacters = characters.filter((c) => {
      const name = nameMap.get(c.characterId) ?? c.characterId;
      return finalistIds.has(c.characterId) || finalists.includes(name);
    });

    // Emit duel start event
    const duelStartContent = isRussian
      ? `ФИНАЛЬНАЯ ДУЭЛЬ! Финалисты ${finalists.join(' и ')} получают возможность убедить остальных голосовать за них.`
      : `FINAL DUEL! Finalists ${finalists.join(' and ')} get a chance to convince others to vote for them.`;

    const duelStartEvent: Omit<ShowEvent, 'sequenceNumber'> = {
      id: generateId(),
      showId,
      timestamp: Date.now(),
      phaseId,
      type: EventType.tiebreaker_start,
      channel: ChannelType.PUBLIC,
      visibility: ChannelType.PUBLIC,
      senderId: '',
      receiverIds: allCharacterIds,
      audienceIds: allCharacterIds,
      content: duelStartContent,
      metadata: {
        finalists,
        tiebreakerMode: 'duel',
        isDuel: true,
      },
      seed,
    };
    await this.eventJournal.append(duelStartEvent);

    // Each finalist gets 1 turn to give their final speech
    for (const finalist of finalistCharacters) {
      const finalistName = nameMap.get(finalist.characterId) ?? finalist.characterId;

      // Build duel speech trigger
      const trigger = this.buildDuelSpeechTrigger(finalistName, finalists, isRussian);

      // Emit host_trigger for this finalist
      const triggerEvent: Omit<ShowEvent, 'sequenceNumber'> = {
        id: generateId(),
        showId,
        timestamp: Date.now(),
        phaseId,
        type: EventType.host_trigger,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: '',
        receiverIds: [finalist.characterId],
        audienceIds: [finalist.characterId],
        content: trigger,
        metadata: {
          duelSpeech: true,
          finalists,
        },
        seed,
      };
      await this.eventJournal.append(triggerEvent);

      // Call character for their duel speech
      const response = await callCharacter(finalist.characterId, trigger, []);

      // Create duel_speech event (public so everyone hears it)
      const duelSpeechEvent: Omit<ShowEvent, 'sequenceNumber'> = {
        id: generateId(),
        showId,
        timestamp: Date.now(),
        phaseId,
        type: EventType.duel_speech,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: finalist.characterId,
        receiverIds: allCharacterIds,
        audienceIds: allCharacterIds,
        content: response.text,
        metadata: {
          duelSpeech: true,
          finalistName,
          finalists,
        },
        seed,
      };
      await this.eventJournal.append(duelSpeechEvent);
    }

    // After duel speeches, run revote
    await this.runTiebreaker(showId, finalists, decisionConfig, callCharacter);
  }

  /**
   * Build trigger for duel speech
   */
  private buildDuelSpeechTrigger(
    finalistName: string,
    finalists: string[],
    isRussian: boolean
  ): string {
    const parts: string[] = [];
    const otherFinalists = finalists.filter((f) => f !== finalistName);

    if (isRussian) {
      parts.push('ФИНАЛЬНАЯ ДУЭЛЬ!');
      parts.push('');
      parts.push(`Ты — ${finalistName}. Это твой последний шанс.`);
      parts.push(`Ты в финале против: ${otherFinalists.join(', ')}`);
      parts.push('');
      parts.push('Убеди остальных почему ты достоин победы.');
      parts.push('');
      parts.push('ВАЖНО:');
      parts.push('- Это РЕЧЬ, а не голосование');
      parts.push('- У тебя только один ход — используй его убедительно');
      parts.push('- После всех речей будет переголосование');
    } else {
      parts.push('FINAL DUEL!');
      parts.push('');
      parts.push(`You are ${finalistName}. This is your last chance.`);
      parts.push(`You are in the final against: ${otherFinalists.join(', ')}`);
      parts.push('');
      parts.push('Convince the others why you deserve to win.');
      parts.push('');
      parts.push('IMPORTANT:');
      parts.push('- This is a SPEECH, not a vote');
      parts.push('- You have only one turn — use it persuasively');
      parts.push('- After all speeches, there will be a revote');
    }

    return parts.join('\n');
  }

  /**
   * Run winner speech - winner gives victory speech after announcement
   * Creates winner_speech event with gratitude and plans
   */
  async runWinnerSpeech(
    showId: string,
    winnerName: string,
    callCharacter: DecisionCallback
  ): Promise<void> {
    // Get show info
    const showRecord = await this.store.getShow(showId);
    if (!showRecord) {
      throw new Error(`Show ${showId} not found`);
    }
    const phaseId = showRecord.currentPhaseId ?? '';
    const seed = showRecord.seed;

    // Get all characters
    const characters = await this.store.getCharacters(showId);
    if (characters.length === 0) {
      return;
    }

    // Get character definitions from configSnapshot
    const configSnapshot = JSON.parse(showRecord.configSnapshot) as Record<string, unknown>;
    const characterDefinitions = configSnapshot.characterDefinitions as
      | Array<{ id: string; name: string; responseConstraints?: { language?: string } }>
      | undefined;

    // Build name map and reverse map
    const nameMap = new Map<string, string>(); // id -> name
    const idMap = new Map<string, string>(); // name -> id
    let isRussian = false;
    if (characterDefinitions) {
      for (const def of characterDefinitions) {
        nameMap.set(def.id, def.name);
        idMap.set(def.name, def.id);
        if (def.responseConstraints?.language === 'ru') {
          isRussian = true;
        }
      }
    }

    const allCharacterIds = characters.map((c) => c.characterId);

    // Find winner character ID
    let winnerId: string | undefined;
    if (idMap.has(winnerName)) {
      winnerId = idMap.get(winnerName);
    } else if (nameMap.has(winnerName)) {
      winnerId = winnerName;
    }

    if (!winnerId) {
      logger.warn(`Winner ${winnerName} not found in characters`);
      return;
    }

    // Build winner speech trigger
    const trigger = isRussian
      ? `Ты победил! Скажи свою победную речь — поблагодари, поделись планами на будущее.`
      : `You won! Give your victory speech — express gratitude, share your plans for the future.`;

    // Emit host_trigger for the winner
    const triggerEvent: Omit<ShowEvent, 'sequenceNumber'> = {
      id: generateId(),
      showId,
      timestamp: Date.now(),
      phaseId,
      type: EventType.host_trigger,
      channel: ChannelType.PUBLIC,
      visibility: ChannelType.PUBLIC,
      senderId: '',
      receiverIds: [winnerId],
      audienceIds: [winnerId],
      content: trigger,
      metadata: {
        winnerSpeech: true,
        winner: winnerName,
      },
      seed,
    };
    await this.eventJournal.append(triggerEvent);

    // Call winner for their victory speech
    const response = await callCharacter(winnerId, trigger, []);

    // Create winner_speech event
    const winnerSpeechEvent: Omit<ShowEvent, 'sequenceNumber'> = {
      id: generateId(),
      showId,
      timestamp: Date.now(),
      phaseId,
      type: EventType.winner_speech,
      channel: ChannelType.PUBLIC,
      visibility: ChannelType.PUBLIC,
      senderId: winnerId,
      receiverIds: allCharacterIds,
      audienceIds: allCharacterIds,
      content: response.text,
      metadata: {
        winnerSpeech: true,
        winner: winnerName,
      },
      seed,
    };
    await this.eventJournal.append(winnerSpeechEvent);
  }

  /**
   * Run loser reactions - each loser reacts to the result
   * Creates loser_reaction events for each non-winner
   */
  async runLoserReactions(
    showId: string,
    winnerName: string,
    callCharacter: DecisionCallback
  ): Promise<void> {
    // Get show info
    const showRecord = await this.store.getShow(showId);
    if (!showRecord) {
      throw new Error(`Show ${showId} not found`);
    }
    const phaseId = showRecord.currentPhaseId ?? '';
    const seed = showRecord.seed;

    // Get all characters
    const characters = await this.store.getCharacters(showId);
    if (characters.length === 0) {
      return;
    }

    // Get character definitions from configSnapshot
    const configSnapshot = JSON.parse(showRecord.configSnapshot) as Record<string, unknown>;
    const characterDefinitions = configSnapshot.characterDefinitions as
      | Array<{ id: string; name: string; responseConstraints?: { language?: string } }>
      | undefined;

    // Build name map and reverse map
    const nameMap = new Map<string, string>(); // id -> name
    const idMap = new Map<string, string>(); // name -> id
    let isRussian = false;
    if (characterDefinitions) {
      for (const def of characterDefinitions) {
        nameMap.set(def.id, def.name);
        idMap.set(def.name, def.id);
        if (def.responseConstraints?.language === 'ru') {
          isRussian = true;
        }
      }
    }

    const allCharacterIds = characters.map((c) => c.characterId);

    // Find winner character ID
    let winnerId: string | undefined;
    if (idMap.has(winnerName)) {
      winnerId = idMap.get(winnerName);
    } else if (nameMap.has(winnerName)) {
      winnerId = winnerName;
    }

    // Get losers (everyone except winner)
    const loserIds = allCharacterIds.filter((id) => id !== winnerId);

    if (loserIds.length === 0) {
      return;
    }

    // Build loser reaction trigger
    const trigger = isRussian
      ? `Ты не победил. Выскажи свою реакцию — поздравь победителя или выскажи разочарование. Ответь КРАТКО (1-2 предложения).`
      : `You didn't win. React to the result — congratulate the winner or share your disappointment. Keep it SHORT (1-2 sentences).`;

    // Process each loser
    for (const loserId of loserIds) {
      const loserName = nameMap.get(loserId) ?? loserId;

      // Emit host_trigger for the loser
      const triggerEvent: Omit<ShowEvent, 'sequenceNumber'> = {
        id: generateId(),
        showId,
        timestamp: Date.now(),
        phaseId,
        type: EventType.host_trigger,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: '',
        receiverIds: [loserId],
        audienceIds: [loserId],
        content: trigger,
        metadata: {
          loserReaction: true,
          loser: loserName,
          winner: winnerName,
        },
        seed,
      };
      await this.eventJournal.append(triggerEvent);

      // Call loser for their reaction
      const response = await callCharacter(loserId, trigger, []);

      // Create loser_reaction event
      const loserReactionEvent: Omit<ShowEvent, 'sequenceNumber'> = {
        id: generateId(),
        showId,
        timestamp: Date.now(),
        phaseId,
        type: EventType.loser_reaction,
        channel: ChannelType.PUBLIC,
        visibility: ChannelType.PUBLIC,
        senderId: loserId,
        receiverIds: allCharacterIds,
        audienceIds: allCharacterIds,
        content: response.text,
        metadata: {
          loserReaction: true,
          loser: loserName,
          winner: winnerName,
        },
        seed,
      };
      await this.eventJournal.append(loserReactionEvent);
    }
  }
}
