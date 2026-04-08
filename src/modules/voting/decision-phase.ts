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
import { DecisionCallback } from './types.js';

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
