/**
 * HostModule - Manages show lifecycle and orchestration
 * Based on PRD.md - Host Module responsibilities
 */

import { IStore, ShowRecord, ShowCharacterRecord, TokenBudgetRecord } from '../types/interfaces/store.interface.js';
import { EventJournal } from './event-journal.js';
import { ShowFormatTemplate } from '../types/template.js';
import { CharacterDefinition } from '../types/character.js';
import { Show } from '../types/runtime.js';
import { ShowStatus, BudgetMode } from '../types/enums.js';
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
}
