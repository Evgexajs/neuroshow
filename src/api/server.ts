/**
 * API Server - Fastify setup and composition root
 * Based on TASK-044 - API Server setup
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import OpenAI from 'openai';
import { config } from '../config.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import { EventJournal } from '../core/event-journal.js';
import { HostModule } from '../core/host-module.js';
import { ContextBuilder } from '../core/context-builder.js';
import { MockAdapter } from '../adapters/mock-adapter.js';
import { Orchestrator } from '../core/orchestrator.js';
import type { ModelAdapter } from '../types/adapter.js';
import { logger } from '../utils/logger.js';
import type { CharacterDefinition } from '../types/character.js';
import { SpeakFrequency } from '../types/enums.js';
import type { Relationship, RelationshipType, SecretMissionType } from '../types/primitives.js';
import { generateId } from '../utils/id.js';
import {
  validateCreateShowRequest,
  validateControlShowRequest,
} from '../validation/schemas.js';

/**
 * Options for character generation
 */
interface GenerateCharactersOptions {
  count: number;
  theme?: string;
  generateRelationships?: boolean;
  generateSecretMissions?: boolean;
}

/**
 * Result of character generation
 */
interface GenerateCharactersResult {
  characters: CharacterDefinition[];
  relationships: Relationship[];
}

/**
 * Generate characters using OpenAI API
 */
async function generateCharactersWithOpenAI(options: GenerateCharactersOptions): Promise<GenerateCharactersResult> {
  const { count, theme, generateRelationships = false, generateSecretMissions = false } = options;
  const client = new OpenAI({ apiKey: config.openaiApiKey });

  const themeContext = theme
    ? `Сеттинг/тема персонажей: "${theme}". Все персонажи должны соответствовать этой теме.`
    : 'Персонажи могут быть из любого сеттинга - современность, фэнтези, научная фантастика, историческая эпоха и т.д.';

  const relationshipsPrompt = generateRelationships
    ? `

Также создай 2-3 связи между персонажами (relationships). Некоторые связи публичные (все знают), некоторые приватные (знают только участники).
Добавь в JSON массив "relationships":
{
  "relationships": [
    {
      "type": "romantic_history" | "friendship" | "rivalry" | "family" | "colleagues" | "secret",
      "participants": [0, 1],
      "visibility": "public" | "private",
      "description": "Описание связи (1-2 предложения)"
    }
  ]
}
Где participants - индексы персонажей в массиве characters (0, 1, 2...).
Типы связей:
- romantic_history: бывшие партнёры, романтическая история
- friendship: старые друзья, хорошие знакомые
- rivalry: конкуренты, соперники
- family: родственники
- colleagues: коллеги, работали вместе
- secret: тайная связь (шпион, информатор, должник)`
    : '';

  const secretMissionsPrompt = generateSecretMissions
    ? `

Также создай секретные задания для 30-50% персонажей. Это скрытые цели, которые персонаж будет преследовать во время шоу.
Добавь в JSON массив "secretMissions":
{
  "secretMissions": [
    {
      "type": "rivalry" | "hidden_alliance" | "betrayal" | "information" | "manipulation",
      "characterIndex": 0,
      "description": "Описание задания (1-2 предложения)",
      "targetIndices": [1]
    }
  ]
}
Где characterIndex - индекс персонажа-исполнителя, targetIndices - индексы персонажей-целей (опционально).
Типы заданий:
- rivalry: "Не дай {имя} победить любой ценой"
- hidden_alliance: "У тебя тайный союз с {имя}, помоги ему победить"
- betrayal: "В решающий момент предай своего союзника"
- information: "Узнай секрет {имя} и используй против него"
- manipulation: "Заставь {имя} поссориться с {имя2}"`
    : '';

  const prompt = `Сгенерируй ${count} уникальных персонажей для интерактивного шоу-дискуссии.

${themeContext}

Каждый персонаж должен быть уникальным и интересным. У них должны быть разные:
- Характеры и темпераменты
- Мотивации и цели
- Секреты и скрытые стороны
- Стили общения (кто-то говорит много, кто-то мало)

ВАЖНО — КОНФЛИКТНЫЕ МОТИВАЦИИ:
Персонажи должны иметь ПРОТИВОРЕЧАЩИЕ друг другу цели. Это создаёт драму и интригу.
Обязательные требования:
- Минимум 2 персонажа должны иметь ПРОТИВОПОЛОЖНЫЕ цели (один хочет X, другой хочет предотвратить X)
- Кто-то должен быть готов предать других ради победы
- Кто-то скрывает истинные намерения под маской дружелюбия
- У кого-то есть личная вендетта против другого участника

Примеры конфликтных мотиваций для motivationPrompt:
- "Победить любой ценой, даже если придётся подставить других"
- "Не дать [имя] победить — это дело принципа"
- "Казаться союзником всех, но работать только на себя"
- "Разоблачить истинную сущность [имя]"
- "Создать хаос и наблюдать как другие уничтожают друг друга"
- "Отомстить [имя] за прошлые обиды"

Верни JSON объект с массивом персонажей в формате:
{
  "characters": [
    {
      "name": "Имя персонажа",
      "publicCard": "Публичное описание персонажа (2-3 предложения, что видят другие)",
      "personalityPrompt": "Инструкция для ИИ как отыгрывать этого персонажа (стиль речи, манеры, особенности)",
      "motivationPrompt": "Скрытые мотивации и цели персонажа",
      "secrets": ["секрет 1", "секрет 2"],
      "goals": ["цель 1", "цель 2"],
      "speakFrequency": "low" | "medium" | "high",
      "boundaryRules": ["что персонаж никогда не сделает"]
    }
  ]
}
${relationshipsPrompt}
${secretMissionsPrompt}

ВАЖНО: Персонажи должны быть разнообразными - не делай их похожими друг на друга!
Используй разные speakFrequency: хотя бы один "low", хотя бы один "high", остальные "medium".`;

  const response = await client.chat.completions.create({
    model: config.openaiDefaultModel,
    messages: [
      {
        role: 'system',
        content: 'Ты генератор персонажей для интерактивных шоу. Отвечай только валидным JSON без дополнительного текста.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 1.0, // More creative generation
  });

  const content = response.choices[0]?.message?.content ?? '{"characters":[]}';
  logger.info('OpenAI response content:', content);

  const parsed = JSON.parse(content);

  // Handle both array and object with any key containing an array
  let rawCharacters: unknown[];
  if (Array.isArray(parsed)) {
    rawCharacters = parsed;
  } else {
    // Find the first array property in the object (could be "characters", "result", "data", "персонажи", etc.)
    const arrayValue = Object.values(parsed).find((val) => Array.isArray(val));
    rawCharacters = (arrayValue as unknown[]) ?? [];
  }

  logger.info(`Parsed ${rawCharacters.length} characters from OpenAI response`);

  // Define the expected shape of raw character from OpenAI
  interface RawCharacter {
    name: string;
    publicCard: string;
    personalityPrompt: string;
    motivationPrompt: string;
    secrets?: string[];
    goals?: string[];
    speakFrequency?: string;
    boundaryRules?: string[];
  }

  // Convert to CharacterDefinition format and generate IDs
  const characters: CharacterDefinition[] = (rawCharacters as RawCharacter[]).map((char) => ({
    id: generateId(),
    name: char.name,
    publicCard: char.publicCard,
    personalityPrompt: char.personalityPrompt,
    motivationPrompt: char.motivationPrompt,
    boundaryRules: char.boundaryRules ?? [],
    startingPrivateContext: {
      secrets: char.secrets ?? [],
      alliances: [],
      goals: char.goals ?? [],
      wildcards: [],
    },
    speakFrequency: (char.speakFrequency as SpeakFrequency) ?? SpeakFrequency.medium,
    responseConstraints: {
      maxTokens: 256,
      format: 'free' as const,
      language: 'ru',
    },
  }));

  // Parse relationships if requested
  let relationships: Relationship[] = [];
  if (generateRelationships && parsed.relationships && Array.isArray(parsed.relationships)) {
    interface RawRelationship {
      type: string;
      participants: number[];
      visibility: string;
      description: string;
    }

    relationships = (parsed.relationships as RawRelationship[])
      .filter((rel) => {
        // Validate relationship has valid participant indices
        if (!rel.participants || rel.participants.length !== 2) return false;
        const [idx1, idx2] = rel.participants;
        return (
          idx1 !== undefined &&
          idx2 !== undefined &&
          idx1 >= 0 &&
          idx1 < characters.length &&
          idx2 >= 0 &&
          idx2 < characters.length
        );
      })
      .map((rel) => {
        const idx1 = rel.participants[0] as number;
        const idx2 = rel.participants[1] as number;
        // Filter guarantees these indices are valid
        const char1 = characters[idx1]!;
        const char2 = characters[idx2]!;
        const participantIds: [string, string] = [char1.id, char2.id];

        // For private relationships, only participants know
        // For public relationships, everyone knows
        const knownBy =
          rel.visibility === 'private'
            ? participantIds
            : characters.map((c) => c.id);

        return {
          id: generateId(),
          type: rel.type as RelationshipType,
          participantIds,
          visibility: rel.visibility as 'public' | 'private',
          description: rel.description,
          knownBy,
        };
      });

    logger.info(`Parsed ${relationships.length} relationships from OpenAI response`);
  }

  // Parse and assign secret missions if requested
  if (generateSecretMissions && parsed.secretMissions && Array.isArray(parsed.secretMissions)) {
    interface RawSecretMission {
      type: string;
      characterIndex: number;
      description: string;
      targetIndices?: number[];
    }

    for (const mission of parsed.secretMissions as RawSecretMission[]) {
      // Validate character index
      if (
        mission.characterIndex === undefined ||
        mission.characterIndex < 0 ||
        mission.characterIndex >= characters.length
      ) {
        continue;
      }

      const character = characters[mission.characterIndex]!;

      // Convert target indices to target IDs
      const targetIds: string[] = [];
      if (mission.targetIndices && Array.isArray(mission.targetIndices)) {
        for (const idx of mission.targetIndices) {
          if (idx >= 0 && idx < characters.length && idx !== mission.characterIndex) {
            targetIds.push(characters[idx]!.id);
          }
        }
      }

      // Assign the secret mission to the character
      character.startingPrivateContext.secretMission = {
        type: mission.type as SecretMissionType,
        description: mission.description,
        targetIds: targetIds.length > 0 ? targetIds : undefined,
      };
    }

    const assignedCount = characters.filter((c) => c.startingPrivateContext.secretMission).length;
    logger.info(`Assigned ${assignedCount} secret missions to characters`);
  }

  return { characters, relationships };
}

/**
 * Generate mock characters as fallback when OpenAI is unavailable
 */
function generateMockCharacters(count: number, theme?: string): GenerateCharactersResult {
  const themePrefix = theme ? `[${theme}] ` : '';

  const mockTemplates = [
    {
      name: 'Алексей Громов',
      publicCard: 'Опытный бизнесмен, владелец сети ресторанов. Уверен в себе и привык добиваться своего.',
      personalityPrompt: 'Говори уверенно и деловито. Используй бизнес-лексику. Ценишь время и конкретику.',
      motivationPrompt:
        'Победить любой ценой. Не дать Дмитрию Волкову получить влияние — он твой прямой конкурент. Готов подставить других ради своей выгоды.',
      speakFrequency: SpeakFrequency.high,
      secrets: ['В прошлом году чуть не обанкротился из-за Дмитрия'],
      goals: ['Уничтожить конкурента', 'Заключить выгодную сделку'],
    },
    {
      name: 'Марина Светлова',
      publicCard: 'Психолог с 15-летним стажем. Внимательно слушает и задаёт неудобные вопросы.',
      personalityPrompt: 'Говори мягко но проницательно. Задавай вопросы. Анализируй мотивы других.',
      motivationPrompt:
        'Казаться союзником всех, но работать только на себя. Собирать компромат на каждого, чтобы использовать в нужный момент.',
      speakFrequency: SpeakFrequency.medium,
      secrets: ['Пишет разоблачительную книгу об участниках'],
      goals: ['Втереться в доверие ко всем', 'Собрать грязные секреты'],
    },
    {
      name: 'Дмитрий Волков',
      publicCard: 'Молчаливый программист. Больше наблюдает, чем говорит.',
      personalityPrompt: 'Говори кратко и по делу. Предпочитай логику эмоциям. Часто молчишь.',
      motivationPrompt:
        'Не дать Алексею Громову победить — он украл твою идею и разрушил твой стартап. Отомстить, но тихо и расчётливо.',
      speakFrequency: SpeakFrequency.low,
      secrets: ['Громов украл его технологию'],
      goals: ['Разоблачить Громова', 'Восстановить справедливость'],
    },
    {
      name: 'Елена Краснова',
      publicCard: 'Яркая журналистка, ведущая популярного блога. Любит провокации.',
      personalityPrompt: 'Говори эмоционально и провокационно. Ищи скандалы. Задавай острые вопросы.',
      motivationPrompt:
        'Создать хаос и наблюдать как участники уничтожают друг друга. Стравливать людей ради сенсации.',
      speakFrequency: SpeakFrequency.high,
      secrets: ['Работает на конкурента Громова'],
      goals: ['Спровоцировать скандал', 'Получить эксклюзивный материал'],
    },
    {
      name: 'Андрей Миронов',
      publicCard: 'Философ и преподаватель университета. Любит рассуждать о высоком.',
      personalityPrompt: 'Говори размеренно и философски. Цитируй классиков. Ищи глубинный смысл.',
      motivationPrompt:
        'Скрываешь истинные намерения под маской мудреца. На самом деле манипулируешь людьми ради собственных целей.',
      speakFrequency: SpeakFrequency.medium,
      secrets: ['Уволен за манипуляции со студентами'],
      goals: ['Контролировать группу', 'Восстановить влияние'],
    },
    {
      name: 'Ольга Петрова',
      publicCard: 'Домохозяйка с тремя детьми. Простая и открытая.',
      personalityPrompt: 'Говори просто и по-домашнему. Делись бытовыми примерами. Будь эмпатичной.',
      motivationPrompt:
        'Под маской простоты скрывается острый ум. Притворяешься наивной, чтобы другие недооценивали тебя.',
      speakFrequency: SpeakFrequency.medium,
      secrets: ['В прошлом была безжалостным адвокатом'],
      goals: ['Победить, пока все смотрят на "серьёзных" игроков'],
    },
    {
      name: 'Виктор Сидоров',
      publicCard: 'Отставной военный, полковник в отставке. Дисциплинирован и прямолинеен.',
      personalityPrompt: 'Говори чётко и по-военному. Цени порядок и иерархию. Не терпи хаоса.',
      motivationPrompt:
        'Презираешь "мягкотелых штатских". Хочешь доказать превосходство военной дисциплины над хаосом гражданских.',
      speakFrequency: SpeakFrequency.medium,
      secrets: ['Провалил важную операцию по своей вине'],
      goals: ['Установить контроль', 'Подавить инакомыслие'],
    },
    {
      name: 'Анна Белова',
      publicCard: 'Молодая художница, мечтательница. Видит мир иначе.',
      personalityPrompt: 'Говори образно и поэтично. Используй метафоры. Будь немного не от мира сего.',
      motivationPrompt:
        'Ненавидишь фальшь и лицемерие. Твоя цель — разоблачить истинную сущность каждого участника.',
      speakFrequency: SpeakFrequency.low,
      secrets: ['Её картины разоблачают тёмные секреты людей'],
      goals: ['Сорвать маски со всех', 'Показать правду'],
    },
    {
      name: 'Игорь Козлов',
      publicCard: 'Стендап-комик, любит шутить даже в серьёзных ситуациях.',
      personalityPrompt: 'Шути постоянно. Разряжай обстановку. Используй иронию и сарказм.',
      motivationPrompt:
        'Используешь юмор как оружие. За шутками скрываются ядовитые атаки на тех, кого считаешь врагами.',
      speakFrequency: SpeakFrequency.high,
      secrets: ['Мстит успешным людям за своё детство'],
      goals: ['Унизить "випов"', 'Скрыть свою боль за смехом'],
    },
    {
      name: 'Татьяна Орлова',
      publicCard: 'Бывший следователь, теперь частный детектив. Замечает всё.',
      personalityPrompt: 'Будь наблюдательной и подозрительной. Задавай уточняющие вопросы. Ищи противоречия.',
      motivationPrompt:
        'Расследуешь Алексея Громова по заказу. Готова шантажировать любого ради выполнения задания.',
      speakFrequency: SpeakFrequency.medium,
      secrets: ['Имеет компромат на половину участников'],
      goals: ['Уничтожить Громова', 'Использовать компромат'],
    },
  ];

  const selected = mockTemplates.slice(0, count);

  const characters = selected.map((template) => ({
    id: generateId(),
    name: themePrefix + template.name,
    publicCard: template.publicCard,
    personalityPrompt: template.personalityPrompt,
    motivationPrompt: template.motivationPrompt,
    boundaryRules: [],
    startingPrivateContext: {
      secrets: template.secrets,
      alliances: [],
      goals: template.goals,
      wildcards: [],
    },
    speakFrequency: template.speakFrequency,
    responseConstraints: {
      maxTokens: 256,
      format: 'free' as const,
      language: 'ru',
    },
  }));

  return { characters, relationships: [] };
}

/**
 * Generate backstory using OpenAI API
 * @param theme - Short theme to expand into backstory
 * @param formatName - Show format name
 * @param formatDescription - Show format description
 * @param participantCount - Number of participants
 * @returns Generated backstory string
 */
async function generateBackstoryWithOpenAI(
  theme: string,
  formatName: string,
  formatDescription: string,
  participantCount: number
): Promise<string> {
  const client = new OpenAI({ apiKey: config.openaiApiKey });

  const prompt = `Ты — сценарист реалити-шоу. На основе темы создай предысторию для игры.

Тема: ${theme}

Формат шоу: ${formatName}
Описание формата: ${formatDescription}
Количество участников: ${participantCount}

Напиши предысторию (3-5 предложений):
- Где происходит действие
- Что на кону (приз, выживание, честь)
- Почему участники соревнуются
- Как определится победитель

Учитывай механику формата в предыстории. Ответ от второго лица ('Вы находитесь...', 'Вам предстоит...').`;

  const response = await client.chat.completions.create({
    model: config.openaiDefaultModel,
    messages: [
      {
        role: 'system',
        content: 'Ты сценарист реалити-шоу. Пиши кратко и драматично. Отвечай только текстом предыстории без дополнительных комментариев.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.8,
    max_tokens: 500,
  });

  const backstory = response.choices[0]?.message?.content?.trim() ?? '';
  logger.info(`Generated backstory: ${backstory.substring(0, 100)}...`);
  return backstory;
}

/**
 * Application dependencies container
 * Created by composition root for dependency injection
 */
export interface AppDependencies {
  store: SqliteStore;
  journal: EventJournal;
  hostModule: HostModule;
  contextBuilder: ContextBuilder;
  adapter: ModelAdapter;
  orchestrator: Orchestrator;
}

/**
 * Create all application dependencies (composition root)
 * Initializes storage schema and wires up all modules
 */
async function createDependencies(): Promise<AppDependencies> {
  // Create storage
  const store = new SqliteStore(config.dbPath);
  await store.initSchema();

  // Create event journal
  const journal = new EventJournal(store);

  // Create host module
  const hostModule = new HostModule(store, journal);

  // Create context builder
  const contextBuilder = new ContextBuilder(journal, store);

  // Create model adapter (MockAdapter for default/testing)
  // Note: OpenAI adapter requires per-show context (showId, characterId),
  // so it's created on-demand when running shows, not in composition root
  const adapter: ModelAdapter = new MockAdapter();

  // Create orchestrator with all dependencies
  const orchestrator = new Orchestrator(
    store,
    adapter,
    journal,
    hostModule,
    contextBuilder
  );

  return {
    store,
    journal,
    hostModule,
    contextBuilder,
    adapter,
    orchestrator,
  };
}

/**
 * Create and configure Fastify server
 */
export async function createServer(): Promise<{
  app: FastifyInstance;
  deps: AppDependencies;
}> {
  // Create Fastify instance
  const app = Fastify({
    logger: false, // Using custom logger
  });

  // Serve static files from web/debug-ui
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '../../web/debug-ui'),
    prefix: '/',
  });

  // Create all dependencies via composition root
  const deps = await createDependencies();

  // Health check endpoint
  app.get('/health', async () => {
    return { status: 'ok' };
  });

  // GET /templates - List available show format templates
  app.get('/templates', async (_request: FastifyRequest, reply: FastifyReply) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const formatsDir = path.join(__dirname, '../../src/formats');

    try {
      const files = await fs.readdir(formatsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      const templates = await Promise.all(
        jsonFiles.map(async (file) => {
          const content = await fs.readFile(path.join(formatsDir, file), 'utf-8');
          return JSON.parse(content);
        })
      );

      return reply.send(templates);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.status(404).send({ error: 'Templates directory not found' });
      }
      logger.error('Failed to read templates:', err);
      return reply.status(500).send({ error: 'Failed to read templates' });
    }
  });

  // GET /characters - List available character definitions
  app.get('/characters', async (_request: FastifyRequest, reply: FastifyReply) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const charactersDir = path.join(__dirname, '../../src/formats/characters');

    try {
      const files = await fs.readdir(charactersDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      const characters = await Promise.all(
        jsonFiles.map(async (file) => {
          const content = await fs.readFile(path.join(charactersDir, file), 'utf-8');
          return JSON.parse(content);
        })
      );

      return reply.send(characters);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.status(404).send({ error: 'Characters directory not found' });
      }
      logger.error('Failed to read characters:', err);
      return reply.status(500).send({ error: 'Failed to read characters' });
    }
  });

  // POST /generate/characters - Generate random characters via OpenAI
  app.post('/generate/characters', async (request: FastifyRequest, reply: FastifyReply) => {
    const { count = 5, theme, generateRelationships = false, generateSecretMissions = false } = request.body as {
      count?: number;
      theme?: string;
      generateRelationships?: boolean;
      generateSecretMissions?: boolean;
    };

    logger.info(
      `POST /generate/characters - count: ${count}, theme: ${theme ?? 'none'}, generateRelationships: ${generateRelationships}, generateSecretMissions: ${generateSecretMissions}`
    );

    // Validate count
    if (count < 1 || count > 10) {
      logger.warn(`Invalid count: ${count}`);
      return reply.status(400).send({ error: 'Count must be between 1 and 10' });
    }

    // Check if OpenAI API key is available
    const hasOpenAIKey = Boolean(config.openaiApiKey);

    if (!hasOpenAIKey) {
      logger.info('No OpenAI API key, using mock characters');
      // Fallback: generate mock characters
      const result = generateMockCharacters(count, theme);
      logger.info(`Generated ${result.characters.length} mock characters`);
      return reply.send(result);
    }

    try {
      const result = await generateCharactersWithOpenAI({ count, theme, generateRelationships, generateSecretMissions });
      logger.info(`Successfully generated ${result.characters.length} characters via OpenAI`);

      if (result.characters.length === 0) {
        logger.warn('OpenAI returned empty array, falling back to mock');
        const mockResult = generateMockCharacters(count, theme);
        return reply.send(mockResult);
      }

      return reply.send(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`OpenAI character generation failed: ${errorMessage}`, err);
      // Fallback to mock on error
      const result = generateMockCharacters(count, theme);
      logger.info(`Fallback: generated ${result.characters.length} mock characters`);
      return reply.send(result);
    }
  });

  // GET /shows - List all shows
  app.get('/shows', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const shows = await deps.store.listShows();

      // Sort by startedAt descending (newest first)
      shows.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

      // Map to response format
      const response = shows.map((show) => {
        // Parse config snapshot to get template name
        let templateName = 'Unknown';
        try {
          const config = JSON.parse(show.configSnapshot);
          templateName = config.templateName ?? config.templateId ?? 'Unknown';
        } catch {
          // Ignore parse errors
        }

        return {
          showId: show.id,
          status: show.status,
          createdAt: show.startedAt ? new Date(show.startedAt).toISOString() : null,
          templateName,
        };
      });

      return reply.send({ shows: response });
    } catch (err) {
      logger.error('Failed to list shows:', err);
      return reply.status(500).send({ error: 'Failed to list shows' });
    }
  });

  // GET /shows/:id/events - SSE endpoint for real-time events
  app.get('/shows/:id/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { snapshot } = request.query as { snapshot?: string };

    // Check if show exists
    const show = await deps.store.getShow(id);
    if (!show) {
      return reply.status(404).send({ error: 'Show not found' });
    }

    // Tell Fastify we're taking over the response
    reply.hijack();

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Get Last-Event-ID for reconnection support
    // Last-Event-ID contains the sequence number of the last received event
    // We want events AFTER that, so we use lastEventId + 1 as cursor (which is inclusive)
    const lastEventIdHeader = request.headers['last-event-id'];
    const lastEventId = lastEventIdHeader
      ? parseInt(lastEventIdHeader as string, 10)
      : 0;

    // Send all existing events from the cursor position
    // cursor is inclusive (events >= cursor), so we add 1 to get events after lastEventId
    const existingEvents = await deps.journal.getEvents(id, {
      cursor: lastEventId > 0 ? lastEventId + 1 : undefined,
    });

    for (const event of existingEvents) {
      const sseData = `id: ${event.sequenceNumber}\ndata: ${JSON.stringify(event)}\n\n`;
      reply.raw.write(sseData);
    }

    // If snapshot mode, close connection after sending existing events
    // This is useful for testing and one-time fetches
    if (snapshot === 'true') {
      reply.raw.end();
      return;
    }

    // Subscribe to new events
    const eventHandler = (event: import('../types/events.js').ShowEvent) => {
      if (event.showId === id) {
        const sseData = `id: ${event.sequenceNumber}\ndata: ${JSON.stringify(event)}\n\n`;
        reply.raw.write(sseData);
      }
    };

    deps.journal.on('event', eventHandler);

    // Handle client disconnect
    request.raw.on('close', () => {
      deps.journal.off('event', eventHandler);
    });
  });

  // POST /shows/:id/control - Control show execution
  app.post('/shows/:id/control', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    // Validate request body with Zod
    const validation = validateControlShowRequest(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        error: validation.error,
      });
    }

    const { action, phaseId } = validation.data;

    // Check if show exists
    const show = await deps.store.getShow(id);
    if (!show) {
      return reply.status(404).send({ error: 'Show not found' });
    }

    try {
      switch (action) {
        case 'start':
          // Run show in background (don't await)
          deps.orchestrator.runShow(id).catch((err) => {
            logger.error(`Show ${id} execution error:`, err);
          });
          return reply.send({
            status: 'started',
            message: 'Show started in background',
          });

        case 'pause':
          deps.orchestrator.pause();
          return reply.send({
            status: 'paused',
            message: 'Show paused',
          });

        case 'resume':
          deps.orchestrator.resume();
          return reply.send({
            status: 'resumed',
            message: 'Show resumed',
          });

        case 'step':
          await deps.orchestrator.step();
          return reply.send({
            status: 'stepped',
            message: 'One step executed',
          });

        case 'rollback':
          // phaseId is guaranteed by Zod validation for rollback action
          await deps.orchestrator.rollbackToPhase(id, phaseId!);
          return reply.send({
            status: 'rolled_back',
            message: `Rolled back to phase ${phaseId}`,
          });
      }
    } catch (err) {
      logger.error(`Control action ${action} failed for show ${id}:`, err);
      return reply.status(500).send({
        error: `Control action failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }
  });

  // GET /shows/:id/status - Get show status and budget
  app.get('/shows/:id/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    // Check if show exists
    const show = await deps.store.getShow(id);
    if (!show) {
      return reply.status(404).send({ error: 'Show not found' });
    }

    // Get token budget
    const budget = await deps.store.getBudget(id);

    // Get events count
    const eventsCount = await deps.store.getLatestSequence(id);

    // Calculate token budget info
    let tokenBudget: {
      total: number;
      used: number;
      mode: string;
      percentUsed: number;
    } | null = null;

    if (budget) {
      const used = budget.usedPrompt + budget.usedCompletion;
      tokenBudget = {
        total: budget.totalLimit,
        used,
        mode: budget.mode,
        percentUsed: budget.totalLimit > 0 ? (used / budget.totalLimit) * 100 : 0,
      };
    }

    return reply.send({
      status: show.status,
      currentPhaseId: show.currentPhaseId,
      eventsCount,
      tokenBudget,
    });
  });

  // GET /shows/:id/export - Export show journal to JSON
  app.get('/shows/:id/export', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const exportJson = await deps.journal.exportJournal(id);
      reply.header('Content-Type', 'application/json');
      reply.header('Content-Disposition', `attachment; filename="show-${id}-export.json"`);
      return reply.send(exportJson);
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        return reply.status(404).send({ error: 'Show not found' });
      }
      logger.error(`Failed to export show ${id}:`, err);
      return reply.status(500).send({ error: 'Export failed' });
    }
  });

  // GET /shows/:id/config - Get show config (template + phases info)
  app.get('/shows/:id/config', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    // Check if show exists
    const show = await deps.store.getShow(id);
    if (!show) {
      return reply.status(404).send({ error: 'Show not found' });
    }

    try {
      const config = JSON.parse(show.configSnapshot);
      const phases = (config.phases ?? []) as Array<{
        id: string;
        name: string;
        type: string;
        durationMode: string;
        durationValue: number | string;
        allowedChannels: string[];
      }>;

      return reply.send({
        templateId: config.templateId ?? show.formatId,
        templateName: config.templateName ?? 'Unknown Template',
        templateDescription: config.templateDescription ?? '',
        backstory: config.backstory ?? null,
        phases: phases.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          durationMode: p.durationMode,
          durationValue: p.durationValue,
          allowedChannels: p.allowedChannels,
        })),
        currentPhaseId: show.currentPhaseId,
      });
    } catch {
      return reply.status(500).send({ error: 'Failed to parse show config' });
    }
  });

  // GET /shows/:id/characters - Get characters for a show
  app.get('/shows/:id/characters', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    // Check if show exists
    const show = await deps.store.getShow(id);
    if (!show) {
      return reply.status(404).send({ error: 'Show not found' });
    }

    // Get characters from store
    const characterRecords = await deps.store.getCharacters(id);

    // Parse configSnapshot to get character definitions (name, publicCard)
    let characterDefinitions: Array<{
      id: string;
      name: string;
      publicCard: string;
    }> = [];

    try {
      const config = JSON.parse(show.configSnapshot);
      if (config.characterDefinitions) {
        characterDefinitions = config.characterDefinitions;
      }
    } catch {
      // If parsing fails, we'll use characterRecords only
    }

    // Build character response with merged data
    const characters = characterRecords.map((record) => {
      const definition = characterDefinitions.find((d) => d.id === record.characterId);
      return {
        id: record.characterId,
        name: definition?.name ?? record.characterId,
        modelAdapterId: record.modelAdapterId,
        publicCard: definition?.publicCard ?? '',
      };
    });

    return reply.send({ characters });
  });

  // POST /shows - Create a new show
  app.post('/shows', async (request: FastifyRequest, reply: FastifyReply) => {
    // Validate request body with Zod
    const validation = validateCreateShowRequest(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        error: validation.error,
      });
    }

    const { formatId, characters, seed, tokenBudget, theme, relationships } = validation.data;

    // Validate character count against template limits
    if (characters.length < formatId.minParticipants) {
      return reply.status(400).send({
        error: `Minimum ${formatId.minParticipants} participants required, got ${characters.length}`,
      });
    }

    if (characters.length > formatId.maxParticipants) {
      return reply.status(400).send({
        error: `Maximum ${formatId.maxParticipants} participants allowed, got ${characters.length}`,
      });
    }

    try {
      // Generate or use backstory based on theme length
      let backstory: string | undefined;
      if (theme) {
        if (theme.length <= 150) {
          // Short theme - generate backstory via LLM
          logger.info(`Generating backstory from theme: "${theme}"`);
          try {
            backstory = await generateBackstoryWithOpenAI(
              theme,
              formatId.name,
              formatId.description,
              characters.length
            );
          } catch (err) {
            logger.warn('Failed to generate backstory, using theme as fallback:', err);
            backstory = theme;
          }
        } else {
          // Long theme - use as backstory directly
          logger.info('Using theme as backstory (length > 150)');
          backstory = theme;
        }
      }

      // Call HostModule.initializeShow()
      // Cast types - Zod validation ensures they match the interfaces
      const show = await deps.hostModule.initializeShow(
        formatId as import('../types/template.js').ShowFormatTemplate,
        characters as Array<import('../types/character.js').CharacterDefinition & { modelAdapterId?: string }>,
        seed,
        tokenBudget,
        backstory,
        relationships as import('../types/primitives.js').Relationship[] | undefined
      );

      // Return response
      return reply.status(201).send({
        showId: show.id,
        status: 'created',
      });
    } catch (err) {
      logger.error('Failed to create show:', err);
      return reply.status(500).send({
        error: 'Failed to create show',
      });
    }
  });

  return { app, deps };
}

/**
 * Start the API server
 * Sets up graceful shutdown handlers
 */
export async function startServer(): Promise<void> {
  const { app, deps } = await createServer();

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    // Stop the orchestrator first to prevent new LLM calls
    deps.orchestrator.stop();

    try {
      await app.close();
      // WAL checkpoint before closing to ensure all data is persisted
      await deps.store.walCheckpoint();
      logger.info('[WAL checkpoint] Shutdown checkpoint completed');
      await deps.store.close();
      logger.info('Server shut down successfully');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown:', err);
      process.exit(1);
    }
  };

  // Handler for SIGTSTP (Ctrl+Z) - pause execution but don't exit
  const handleSuspend = () => {
    logger.info('Received SIGTSTP (Ctrl+Z), pausing orchestrator...');
    deps.orchestrator.stop();
    // Re-enable default behavior (suspend process)
    process.kill(process.pid, 'SIGTSTP');
  };

  // Register shutdown handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));
  // Use 'once' for SIGTSTP to avoid re-triggering, and allow process suspension
  process.once('SIGTSTP', handleSuspend);

  // Start listening
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    logger.info(`Server listening on port ${config.port}`);
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Start server if this is the main module
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  startServer();
}
