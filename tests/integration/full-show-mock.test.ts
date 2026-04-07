/**
 * E2E Test: Full show with MockAdapter
 *
 * TASK-055: Runs a complete "Коалиция" show with 5 characters using MockAdapter
 *
 * Verifies:
 * - All phases are completed
 * - Final decisions are collected
 * - Revelation is performed
 * - Test completes in < 10 seconds
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Orchestrator } from '../../src/core/orchestrator.js';
import { HostModule } from '../../src/core/host-module.js';
import { EventJournal } from '../../src/core/event-journal.js';
import { ContextBuilder } from '../../src/core/context-builder.js';
import { SqliteStore } from '../../src/storage/sqlite-store.js';
import { MockAdapter } from '../../src/adapters/mock-adapter.js';
import { ShowFormatTemplate } from '../../src/types/template.js';
import { CharacterDefinition } from '../../src/types/character.js';
import { EventType, ShowStatus } from '../../src/types/enums.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Full Show E2E with MockAdapter', () => {
  let store: SqliteStore;
  let eventJournal: EventJournal;
  let hostModule: HostModule;
  let contextBuilder: ContextBuilder;
  let orchestrator: Orchestrator;
  let mockAdapter: MockAdapter;
  const testDbPath = './data/test-full-show-mock.db';

  // Load coalition template
  const loadCoalitionTemplate = (): ShowFormatTemplate => {
    const templatePath = path.resolve('./src/formats/coalition.json');
    const templateContent = fs.readFileSync(templatePath, 'utf-8');
    return JSON.parse(templateContent) as ShowFormatTemplate;
  };

  // Load all 5 characters
  const loadCharacters = (): Array<CharacterDefinition & { modelAdapterId?: string }> => {
    const charactersDir = path.resolve('./src/formats/characters');
    const characterFiles = ['viktor.json', 'alina.json', 'elena.json', 'maxim.json', 'dmitriy.json'];

    return characterFiles.map((file) => {
      const filePath = path.join(charactersDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const character = JSON.parse(content) as CharacterDefinition;
      return {
        ...character,
        modelAdapterId: 'mock',
      };
    });
  };

  beforeEach(async () => {
    // Clean up test db if exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Initialize all components
    store = new SqliteStore(testDbPath);
    await store.initSchema();
    eventJournal = new EventJournal(store);
    hostModule = new HostModule(store, eventJournal);
    contextBuilder = new ContextBuilder(eventJournal, store);
    mockAdapter = new MockAdapter(12345); // Fixed seed for reproducibility
    orchestrator = new Orchestrator(store, mockAdapter, eventJournal, hostModule, contextBuilder);
  });

  afterEach(async () => {
    await store.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it('should complete a full Coalition show with 5 characters in under 10 seconds', async () => {
    const startTime = Date.now();

    // Load template and characters
    const template = loadCoalitionTemplate();
    const characters = loadCharacters();

    // Verify we have exactly 5 characters
    expect(characters.length).toBe(5);
    expect(template.minParticipants).toBe(5);
    expect(template.maxParticipants).toBe(5);

    // Verify template has 3 phases
    expect(template.phases.length).toBe(3);
    expect(template.phases[0]!.name).toBe('Знакомство');
    expect(template.phases[1]!.name).toBe('Переговоры');
    expect(template.phases[2]!.name).toBe('Финальное решение');

    // Initialize the show
    const show = await hostModule.initializeShow(template, characters, 12345);
    expect(show.id).toBeDefined();
    expect(show.status).toBe(ShowStatus.running);

    // Run the complete show
    await orchestrator.runShow(show.id);

    // Verify show completed
    const completedShow = await store.getShow(show.id);
    expect(completedShow).not.toBeNull();
    expect(completedShow!.status).toBe(ShowStatus.completed);
    expect(completedShow!.completedAt).not.toBeNull();

    // Get all events
    const events = await eventJournal.getEvents(show.id);

    // Verify phase_start/phase_end events for discussion phases (2 out of 3 phases)
    // Note: Decision phase (phase 3) uses runDecisionPhase() which doesn't emit phase_start/phase_end
    const phaseStartEvents = events.filter((e) => e.type === EventType.phase_start);
    const phaseEndEvents = events.filter((e) => e.type === EventType.phase_end);

    // Only 2 discussion phases get phase_start/phase_end events
    expect(phaseStartEvents.length).toBe(2);
    expect(phaseEndEvents.length).toBe(2);

    // Verify phase events are in correct order (start before end for each discussion phase)
    const discussionPhases = template.phases.filter((p) => p.type !== 'decision');
    for (const phase of discussionPhases) {
      const phaseStart = phaseStartEvents.find((e) => e.phaseId === phase.id);
      const phaseEnd = phaseEndEvents.find((e) => e.phaseId === phase.id);

      expect(phaseStart).toBeDefined();
      expect(phaseEnd).toBeDefined();
      expect(phaseStart!.sequenceNumber).toBeLessThan(phaseEnd!.sequenceNumber);
    }

    // Verify decisions were collected (one per character in decision phase)
    const decisionEvents = events.filter((e) => e.type === EventType.decision);
    expect(decisionEvents.length).toBe(5); // One decision per character

    // Verify all 5 characters made decisions
    const decisionSenderIds = new Set(decisionEvents.map((e) => e.senderId));
    expect(decisionSenderIds.size).toBe(5);

    for (const character of characters) {
      expect(decisionSenderIds.has(character.id)).toBe(true);
    }

    // Verify revelation was performed
    const revelationEvents = events.filter((e) => e.type === EventType.revelation);
    expect(revelationEvents.length).toBeGreaterThan(0);

    // Verify revelation contains all decisions (since revealMoment is 'after_all')
    const mainRevelation = revelationEvents.find((e) =>
      e.metadata?.revealMoment === 'after_all'
    );
    expect(mainRevelation).toBeDefined();
    expect(mainRevelation!.content).toContain('Decision results');

    // Verify all characters are in the revelation
    const revealedDecisions = mainRevelation!.metadata?.decisions as Array<{
      characterId: string;
      decision: string;
    }>;
    expect(revealedDecisions).toBeDefined();
    expect(revealedDecisions.length).toBe(5);

    // Verify test completes in under 10 seconds
    const endTime = Date.now();
    const elapsedMs = endTime - startTime;
    expect(elapsedMs).toBeLessThan(10000);
  }, 15000); // Allow 15s total timeout for vitest

  it('should generate speech events during discussion phases', async () => {
    const template = loadCoalitionTemplate();
    const characters = loadCharacters();

    const show = await hostModule.initializeShow(template, characters, 12345);
    await orchestrator.runShow(show.id);

    const events = await eventJournal.getEvents(show.id);
    const speechEvents = events.filter((e) => e.type === EventType.speech);

    // Should have speech events from character turns
    expect(speechEvents.length).toBeGreaterThan(0);

    // Verify speech events have content
    for (const speechEvent of speechEvents) {
      expect(speechEvent.content).toBeDefined();
      expect(speechEvent.content.length).toBeGreaterThan(0);
      expect(speechEvent.senderId).toBeDefined();
    }
  });

  it('should correctly track token budget throughout the show', async () => {
    const template = loadCoalitionTemplate();
    const characters = loadCharacters();

    const show = await hostModule.initializeShow(template, characters, 12345);

    // Check initial budget
    const initialBudget = await store.getBudget(show.id);
    expect(initialBudget).not.toBeNull();
    expect(initialBudget!.usedPrompt).toBe(0);
    expect(initialBudget!.usedCompletion).toBe(0);

    await orchestrator.runShow(show.id);

    // Check final budget
    const finalBudget = await store.getBudget(show.id);
    expect(finalBudget).not.toBeNull();
    expect(finalBudget!.usedPrompt).toBeGreaterThan(0);
    expect(finalBudget!.usedCompletion).toBeGreaterThan(0);
  });

  it('should use correct character IDs from character definitions', async () => {
    const template = loadCoalitionTemplate();
    const characters = loadCharacters();

    const show = await hostModule.initializeShow(template, characters, 12345);

    // Verify all characters were created
    const storedCharacters = await store.getCharacters(show.id);
    expect(storedCharacters.length).toBe(5);

    const characterIds = new Set(storedCharacters.map((c) => c.characterId));
    expect(characterIds.has('viktor')).toBe(true);
    expect(characterIds.has('alina')).toBe(true);
    expect(characterIds.has('elena')).toBe(true);
    expect(characterIds.has('maxim')).toBe(true);
    expect(characterIds.has('dmitriy')).toBe(true);

    await orchestrator.runShow(show.id);

    // Verify all characters participated in events
    const events = await eventJournal.getEvents(show.id);
    const senderIds = new Set(events.map((e) => e.senderId).filter((id) => id !== ''));

    // All 5 characters should have sent events
    expect(senderIds.has('viktor')).toBe(true);
    expect(senderIds.has('alina')).toBe(true);
    expect(senderIds.has('elena')).toBe(true);
    expect(senderIds.has('maxim')).toBe(true);
    expect(senderIds.has('dmitriy')).toBe(true);
  });

  it('should preserve character private context (alliances, wildcards)', async () => {
    const template = loadCoalitionTemplate();
    const characters = loadCharacters();

    const show = await hostModule.initializeShow(template, characters, 12345);

    // Check Alina has alliance with Elena
    const alina = await store.getCharacter(show.id, 'alina');
    expect(alina).not.toBeNull();
    expect(alina!.privateContext.alliances.length).toBe(1);
    expect(alina!.privateContext.alliances[0]!.partnerId).toBe('elena');
    expect(alina!.privateContext.alliances[0]!.isActive).toBe(true);

    // Check Elena has alliance with Alina
    const elena = await store.getCharacter(show.id, 'elena');
    expect(elena).not.toBeNull();
    expect(elena!.privateContext.alliances.length).toBe(1);
    expect(elena!.privateContext.alliances[0]!.partnerId).toBe('alina');
    expect(elena!.privateContext.alliances[0]!.isActive).toBe(true);

    // Check Maxim has a wildcard
    const maxim = await store.getCharacter(show.id, 'maxim');
    expect(maxim).not.toBeNull();
    expect(maxim!.privateContext.wildcards.length).toBe(1);
    expect(maxim!.privateContext.wildcards[0]!.isRevealed).toBe(false);
    expect(maxim!.privateContext.wildcards[0]!.content).toContain('Виктор');
  });
});
