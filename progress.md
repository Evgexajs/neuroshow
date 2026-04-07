# Progress Log - Neuroshow

Журнал прогресса разработки. Каждый агент должен добавлять запись после завершения задачи.

## Формат записи

```
## [YYYY-MM-DD] TASK-XXX: Краткое описание
**Статус:** done
**Время:** ~X часов
**Изменения:**
- файл1.ts - описание
- файл2.ts - описание

**Тесты:** Все test_steps пройдены
**Заметки:** Комментарии, если есть
```

---

## История

<!-- Записи добавляются сверху вниз, самые новые внизу -->

## [2026-04-06] TASK-001: Инициализация проекта
**Статус:** done
**Время:** ~15 минут
**Изменения:**
- src/core/.gitkeep - создана директория для ядра
- src/adapters/.gitkeep - создана директория для адаптеров
- src/storage/.gitkeep - создана директория для хранилища
- src/api/.gitkeep - создана директория для API
- src/types/.gitkeep - создана директория для типов
- src/formats/.gitkeep - создана директория для форматов шоу
- web/debug-ui/.gitkeep - создана директория для отладочного UI
- data/.gitkeep - создана директория для данных

**Тесты:** npm install, npm run build, npm run typecheck — все пройдены
**Заметки:** package.json и tsconfig.json уже были созданы ранее. Структура директорий добавлена согласно PRD.md раздел 6.

## [2026-04-06] TASK-005: TypeScript типы: enums
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/types/enums.ts — создан файл со всеми enum из PRD Appendix A:
  - EventType: speech, host_trigger, phase_start, phase_end, channel_change, decision, revelation, private_injection, system
  - ChannelType: PUBLIC, PRIVATE, ZONE
  - CharacterIntent: speak, request_private, reveal_wildcard, end_turn, request_to_speak, request_interrupt
  - PhaseType: discussion, voting, private_talks, decision, revelation
  - ShowStatus: running, paused, completed, aborted
  - BudgetMode: normal, budget_saving, graceful_finish
  - SpeakFrequency: low, medium, high

**Тесты:** npm run build, npm run typecheck — все пройдены. EventType.speech === 'speech' проверено.
**Заметки:** Использованы string enum для соответствия требованию EventType.speech === 'speech'. Это фундаментальная задача — от неё зависят TASK-006, TASK-007, TASK-010, TASK-012.

## [2026-04-06] TASK-006: TypeScript типы: базовые структуры
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/types/primitives.ts — создан файл со всеми примитивными типами из PRD Appendix A:
  - ResponseConstraints: maxTokens, format ('free'|'structured'|'choice'), language
  - AllianceRecord: partnerId, agreement, isActive
  - WildcardRecord: content, isRevealed
  - DecisionConfig: timing, visibility, revealMoment, format, options
  - PrivateChannelRules: initiator, maxPrivatesPerPhase, maxPrivatesPerCharacterPerPhase, requestQueueMode, requestFormat
  - DayConfig: dayIndex, label, phaseIds

**Тесты:** npm run build, npm run typecheck — все пройдены.
**Заметки:** Это базовые типы, используемые другими интерфейсами. От них зависят TASK-007, TASK-008, TASK-009, TASK-010, TASK-011.

## [2026-04-06] TASK-007: TypeScript типы: ShowEvent и EventSummary
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/types/events.ts — создан файл с типами событий:
  - ShowEvent: полная запись события в журнале (id, showId, timestamp, sequenceNumber, phaseId, type, channel, visibility, senderId, receiverIds, audienceIds, content, metadata, seed)
  - EventSummary: упрощённая версия для Context Builder sliding window (senderId, channel, content, timestamp)

**Тесты:** npm run build, npm run typecheck — все пройдены. Mock-объекты ShowEvent и EventSummary созданы успешно, enums работают корректно.
**Заметки:** Типы используют EventType и ChannelType из enums.ts. ShowEvent — основа для Event Journal. EventSummary используется в ContextLayers.slidingWindow. От этой задачи зависят TASK-008, TASK-011, TASK-013.

## [2026-04-06] TASK-002: Настройка .env конфигурации и dotenv
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- .env.example — добавлены поля: TOKEN_BUDGET_PER_SHOW, PORT, DB_PATH
- src/config.ts — создан типизированный объект конфигурации с интерфейсом Config
- .env — обновлён с полными переменными окружения

**Тесты:** npm run typecheck — пройден. Конфигурация загружается корректно из .env (проверено через tsx).
**Заметки:** .env уже был в .gitignore. Конфигурация использует dotenv для загрузки переменных окружения. От этой задачи зависят TASK-004, TASK-044, TASK-058.

## [2026-04-06] TASK-003: Настройка vitest для unit и integration тестов
**Статус:** done
**Время:** ~5 минут
**Изменения:**
- vitest.config.ts — уже существовал с корректной конфигурацией
- tests/unit/example.test.ts — создан пример теста с тремя тест-кейсами
- tests/integration/.gitkeep — создана директория для интеграционных тестов

**Тесты:** npm run typecheck, npm test — все пройдены. vitest показывает 3 passed tests.
**Заметки:** vitest уже был в devDependencies, скрипты test и test:watch уже настроены в package.json. От этой задачи могут зависеть другие задачи, требующие тестирования.

## [2026-04-06] TASK-004: Утилиты: logger и генератор ID
**Статус:** done
**Время:** ~5 минут
**Изменения:**
- src/utils/logger.ts — создан логгер с методами: info, warn, error, debug. Выводит timestamp и уровень. В production режиме debug-логи не выводятся.
- src/utils/id.ts — создан генератор ID с функцией generateId() возвращающей UUID v4 (crypto.randomUUID).

**Тесты:** npm run typecheck, npm test — все пройдены. Логи выводятся с форматированием, ID уникальны.
**Заметки:** Использован crypto.randomUUID() для генерации UUID v4. Logger использует config.nodeEnv для определения режима production.

## [2026-04-06] TASK-008: TypeScript типы: PrivateContext и ContextLayers
**Статус:** done
**Время:** ~5 минут
**Изменения:**
- src/types/context.ts — создан файл с типами контекста:
  - PrivateContext: secrets (string[]), alliances (AllianceRecord[]), goals (string[]), wildcards (WildcardRecord[])
  - ContextLayers: factsList (string[]), slidingWindow (EventSummary[])

**Тесты:** npm run typecheck, npm test — все пройдены.
**Заметки:** Типы используют AllianceRecord и WildcardRecord из primitives.ts, EventSummary из events.ts. PrivateContext используется в CharacterDefinition (TASK-009). ContextLayers используется в Context Builder.

## [2026-04-06] TASK-009: TypeScript типы CharacterDefinition
**Статус:** done
**Время:** ~5 минут
**Изменения:**
- src/types/character.ts — создан файл с типом CharacterDefinition:
  - id, name, publicCard, personalityPrompt, motivationPrompt, boundaryRules
  - startingPrivateContext (PrivateContext), speakFrequency (SpeakFrequency), responseConstraints (ResponseConstraints)

**Тесты:** npm run typecheck, npm test — все пройдены.
**Заметки:** CharacterDefinition использует PrivateContext из context.ts, ResponseConstraints из primitives.ts, SpeakFrequency из enums.ts. От этой задачи зависит TASK-011.

## [2026-04-06] TASK-010: TypeScript типы: Phase и ShowFormatTemplate
**Статус:** done
**Время:** ~5 минут
**Изменения:**
- src/types/template.ts — создан файл с типами:
  - ScoringRule: id, description, condition, points (placeholder для Non-MVP)
  - Phase: id, name, type (PhaseType), durationMode, durationValue, turnOrder, allowedChannels, triggerTemplate, completionCondition, dayIndex?, slotLabel?
  - ShowFormatTemplate: id, name, description, minParticipants, maxParticipants, phases, days?, decisionConfig, channelTypes, privateChannelRules, contextWindowSize, allowCharacterInitiative?, scoringRules?, winCondition?

**Тесты:** npm run typecheck, npm test — все пройдены.
**Заметки:** Типы используют PhaseType и ChannelType из enums.ts, DecisionConfig, PrivateChannelRules и DayConfig из primitives.ts. От этой задачи зависит TASK-011.

## [2026-04-06] TASK-011: TypeScript типы: PromptPackage, CharacterResponse, ModelAdapter, IStore
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/types/adapter.ts — создан файл с типами:
  - PromptPackage: systemPrompt, contextLayers, trigger, responseConstraints
  - CharacterResponse: text, intent?, target?, decisionValue?
  - ModelAdapter interface: providerId, modelId, call(prompt), estimateTokens(prompt)
- src/types/interfaces/store.interface.ts — создан файл с интерфейсом IStore:
  - CRUD операции для shows, show_characters, show_events, llm_calls, token_budgets
  - Вспомогательные типы: ShowRecord, ShowCharacterRecord, LlmCallRecord, TokenBudgetRecord
- src/types/index.ts — создан файл реэкспорта всех публичных типов

**Тесты:** npm run typecheck, npm test — все пройдены.
**Заметки:** PromptPackage использует ContextLayers и ResponseConstraints. CharacterResponse использует CharacterIntent из enums.ts. IStore определяет контракт для хранилища (SQLite в MVP). От этой задачи зависят TASK-012, TASK-013, TASK-014.

## [2026-04-06] TASK-012: TypeScript типы: Show (runtime state) и TokenBudgetState
**Статус:** done
**Время:** ~5 минут
**Изменения:**
- src/types/runtime.ts — создан файл с типами:
  - Show: id, formatId, seed, status (ShowStatus), currentPhaseId, startedAt, completedAt, configSnapshot
  - TokenBudgetState: showId, totalLimit, usedPrompt, usedCompletion, mode (BudgetMode), lastUpdated
  - ShowCharacter: showId, characterId, modelAdapterId, privateContext (PrivateContext)
- src/types/index.ts — добавлен реэкспорт Show, TokenBudgetState, ShowCharacter

**Тесты:** npm run typecheck, npm test — все пройдены.
**Заметки:** Типы используют ShowStatus и BudgetMode из enums.ts, PrivateContext из context.ts. Show — runtime-состояние шоу. TokenBudgetState отслеживает бюджет токенов. ShowCharacter связывает персонажа с шоу и его приватным контекстом. От этой задачи зависит TASK-013.

## [2026-04-06] TASK-013: SQLite: создание схемы БД и connection manager
**Статус:** done
**Время:** ~15 минут
**Изменения:**
- src/storage/sqlite-store.ts — создан SqliteStore класс, реализующий IStore интерфейс:
  - Конструктор принимает dbPath, создаёт соединение с better-sqlite3
  - initialize() создаёт все 5 таблиц: shows, show_characters, show_events, llm_calls, token_budgets
  - Созданы индексы для show_events (idx_show_events_show_id, idx_show_events_sequence)
  - Реализованы все CRUD-методы согласно IStore интерфейсу
- tests/unit/sqlite-store.test.ts — добавлен тест проверяющий создание таблиц и индексов

**Тесты:** npm run typecheck, npm test — все пройдены (5 tests passed).
**Заметки:** Использован WAL-режим для SQLite. Схема соответствует PRD.md раздел 5. От этой задачи зависят TASK-014, TASK-015, TASK-016, TASK-017, TASK-018.

## [2026-04-06] TASK-014: SQLite CRUD операции для таблицы shows
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/storage/sqlite-store.ts — уже содержал реализацию всех CRUD-методов:
  - createShow(show): void — создание записи шоу
  - getShow(id): ShowRecord | null — получение по ID
  - updateShow(id, updates): void — обновление полей (status, currentPhaseId, completedAt и др.)
  - listShows(status?): ShowRecord[] — список шоу с опциональной фильтрацией по статусу
- tests/unit/sqlite-store.test.ts — добавлены 5 тестов для CRUD операций shows:
  - create and get a show
  - update show status and verify changes
  - list all shows (with status filter)
  - return null for non-existent show
  - serialize configSnapshot as JSON

**Тесты:** npm run typecheck, npm test — все пройдены (10 tests passed).
**Заметки:** CRUD-методы были реализованы в рамках TASK-013. В этой задаче добавлены тесты, подтверждающие корректность работы. configSnapshot сохраняется как JSON-строка. От этой задачи зависят TASK-015, TASK-016, TASK-017.

## [2026-04-06] TASK-016: SQLite CRUD операции для таблицы show_events (append-only)
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/storage/sqlite-store.ts — реализация уже присутствовала с TASK-013:
  - appendEvent(event): number — добавление события с автоинкрементом sequenceNumber
  - getEvents(showId, fromSequence?): ShowEvent[] — получение событий с опциональным курсором
  - getEventsForCharacter(showId, characterId, fromSequence?): ShowEvent[] — фильтрация по audienceIds
  - deleteEventsAfter(showId, afterSequence): void — удаление событий для rollback
  - getLatestSequence(showId): number — получение последнего sequenceNumber
- tests/unit/sqlite-store.test.ts — добавлены 6 тестов для CRUD операций show_events:
  - append events and auto-increment sequenceNumber
  - get events in order by sequenceNumber
  - delete events after sequence number (rollback)
  - filter events by audience (getEventsForCharacter)
  - get latest sequence number
  - get events from a specific sequence number

**Тесты:** npm run typecheck, npm test — все пройдены (21 tests passed).
**Заметки:** Реализация была выполнена в TASK-013. Тесты подтверждают append-only логику с rollback возможностью. От этой задачи зависят TASK-018 (EventJournal), TASK-019, TASK-020.

## [2026-04-06] TASK-015: SQLite CRUD операции для таблицы show_characters
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/storage/sqlite-store.ts — переименованы методы для соответствия IStore интерфейсу:
  - addShowCharacter → createCharacter(char: ShowCharacterRecord): void
  - getShowCharacters → getCharacters(showId: string): ShowCharacterRecord[]
  - getShowCharacter → getCharacter(showId, characterId): ShowCharacterRecord | null
  - privateContext сериализуется в JSON (JSON.stringify при записи, JSON.parse при чтении)
- tests/unit/sqlite-store.test.ts — обновлены тесты для использования правильных имён методов

**Тесты:** npm run typecheck, npm test — все пройдены (21 tests passed).
**Заметки:** Реализация CRUD уже присутствовала с TASK-013, но методы имели неверные имена. Теперь SqliteStore полностью соответствует IStore интерфейсу для show_characters. От этой задачи зависит TASK-017.

## [2026-04-06] TASK-017: SQLite CRUD операции для llm_calls и token_budgets
**Статус:** done
**Время:** ~15 минут
**Изменения:**
- src/types/interfaces/store.interface.ts — переименованы методы согласно acceptance criteria:
  - logLlmCall → logLLMCall(call: LlmCallRecord): void
  - getLlmCalls → getLLMCalls(showId: string): LlmCallRecord[]
  - добавлен getLLMCallByEventId(eventId: string): LlmCallRecord | null
  - initTokenBudget → createBudget(budget: TokenBudgetRecord): void
  - getTokenBudget → getBudget(showId: string): TokenBudgetRecord | null
  - updateTokenBudget → updateBudget(showId, usedPrompt, usedCompletion): void
- src/storage/sqlite-store.ts — реализация обновлена под новые сигнатуры методов
- tests/unit/sqlite-store.test.ts — добавлены 8 тестов для llm_calls и token_budgets

**Тесты:** npm run typecheck, npm test — все пройдены (29 tests passed).
**Заметки:** Методы были переименованы для соответствия acceptance criteria. Добавлен новый метод getLLMCallByEventId для получения LLM-вызова по eventId. От этой задачи зависит TASK-018.

## [2026-04-06] TASK-018: Event Journal: класс EventJournal с методами append и query
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/core/event-journal.ts — создан класс EventJournal:
  - Конструктор принимает IStore
  - append(event: Omit<ShowEvent, 'sequenceNumber'>): ShowEvent — добавляет событие с автоинкрементом sequenceNumber
  - getEvents(showId, options?: {cursor?, limit?, characterId?}): ShowEvent[] — получение событий с опциональной фильтрацией
  - getLatestSequence(showId): number — получение последнего sequenceNumber
- tests/unit/event-journal.test.ts — добавлены 9 тестов для EventJournal

**Тесты:** npm run typecheck, npm test — все пройдены (38 tests passed).
**Заметки:** EventJournal является обёрткой над IStore для удобной работы с событиями. Автоматически назначает sequenceNumber при добавлении событий. От этой задачи зависят TASK-019, TASK-020, TASK-025, TASK-029, TASK-031.

## [2026-04-06] TASK-019: Event Journal: фильтрация по audienceIds для Context Builder
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/core/event-journal.ts — добавлен метод:
  - getVisibleEvents(showId: string, characterId: string, limit?: number): ShowEvent[] — фильтрует события по audienceIds, возвращает в хронологическом порядке, поддерживает limit для sliding window
- tests/unit/event-journal.test.ts — добавлены 5 тестов для getVisibleEvents:
  - filter events by characterId in audienceIds (privacy test)
  - return events in chronological order
  - support limit for sliding window
  - return all events if limit is undefined
  - return empty array if character has no visible events

**Тесты:** npm run typecheck, npm test — все пройдены (43 tests passed).
**Заметки:** getVisibleEvents использует store.getEventsForCharacter для фильтрации по audienceIds. При указании limit возвращает последние N событий (наиболее свежие) для sliding window в Context Builder. От этой задачи зависит TASK-025.

## [2026-04-06] TASK-020: Event Journal: rollback для DEBUG-режима
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/core/event-journal.ts — добавлены методы:
  - rollbackToSequence(showId: string, sequenceNumber: number): number — удаляет события после указанного sequenceNumber, возвращает количество удалённых
  - rollbackToPhase(showId: string, phaseId: string): number — удаляет все события начиная с указанной фазы, возвращает количество удалённых
- tests/unit/event-journal.test.ts — добавлены 7 тестов для rollback:
  - delete events after specified sequence number
  - return 0 if sequence is >= latest
  - keep journal consistent after rollback
  - delete events from specified phase onwards
  - return 0 if phase not found
  - delete all events if rollback to first phase
  - keep journal consistent after phase rollback

**Тесты:** npm run typecheck, npm test — все пройдены (50 tests passed).
**Заметки:** Методы используют store.deleteEventsAfter для удаления событий. rollbackToPhase находит первое событие в указанной фазе и удаляет все события начиная с него. Журнал остаётся консистентным — после rollback можно продолжать append с правильными sequenceNumber.

## [2026-04-06] TASK-021: MockAdapter реализация интерфейса ModelAdapter
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/adapters/mock-adapter.ts — создан MockAdapter класс:
  - Implements ModelAdapter interface
  - providerId: 'mock', modelId: 'mock-v1'
  - call() возвращает детерминированный CharacterResponse на основе hash от trigger и seed
  - estimateTokens() возвращает примерную оценку (слова * 1.3)
  - Конструктор принимает опциональный seed для воспроизводимости
- tests/unit/mock-adapter.test.ts — добавлены 11 тестов для MockAdapter:
  - providerId и modelId корректны
  - call() возвращает валидный CharacterResponse
  - одинаковый seed + trigger дают одинаковый ответ
  - разные seeds дают разные ответы
  - estimateTokens() возвращает words * 1.3

**Тесты:** npm run typecheck, npm test — все пройдены (61 tests passed).
**Заметки:** MockAdapter использует простую hash-функцию для детерминированного выбора ответа из предзаготовленных шаблонов. Полезен для unit-тестов без реальных API-вызовов.

## [2026-04-06] TASK-022: OpenAI Adapter: базовая интеграция с API
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/adapters/openai-adapter.ts — создан OpenAIAdapter класс:
  - Implements ModelAdapter interface
  - providerId: 'openai', modelId: configurable (default 'gpt-4o-mini')
  - Использует official OpenAI SDK (openai ^4.77.0)
  - call() отправляет запрос в chat.completions.create с response_format: json_object
  - Парсит JSON из ответа LLM в CharacterResponse
  - Логирует raw request/response в llm_calls через store.logLLMCall()
  - buildMessages() строит сообщения из PromptPackage (system + context + trigger)
  - parseResponse() извлекает text, intent, target, decisionValue

**Тесты:** npm run typecheck, npm test — все пройдены (61 tests passed).
**Заметки:** Adapter принимает store, showId, characterId через config для логирования. Retry logic будет добавлена в TASK-023. Точный подсчёт токенов через tiktoken в TASK-024.

## [2026-04-06] TASK-023: OpenAI Adapter retry logic и fallback
**Статус:** done
**Время:** ~15 минут
**Изменения:**
- src/adapters/openai-adapter.ts — добавлена retry logic с exponential backoff:
  - Retry при ошибках 429, 500, 502, 503
  - Максимум 2 retry
  - Retry при невалидном JSON-ответе
  - Fallback: { text: '[молчит]', intent: 'end_turn' } при исчерпании retry
  - Fallback логируется с metadata.fallback: true
- tests/unit/openai-adapter-retry.test.ts — добавлены 11 тестов для retry logic

**Тесты:** npm run typecheck, npm test — все пройдены (72 tests passed).
**Заметки:** Использован exponential backoff с base delay 1000ms. Retryable ошибки определяются через OpenAI.APIError.status.

## [2026-04-06] TASK-024: OpenAI Adapter: подсчёт токенов через tiktoken
**Статус:** done
**Время:** ~15 минут
**Изменения:**
- package.json — добавлена зависимость tiktoken
- src/types/adapter.ts — добавлен интерфейс TokenEstimate { prompt: number, estimatedCompletion: number }
- src/types/adapter.ts — обновлён интерфейс ModelAdapter.estimateTokens() для возврата TokenEstimate
- src/types/index.ts — добавлен экспорт TokenEstimate
- src/adapters/openai-adapter.ts — переписан estimateTokens():
  - Использует tiktoken для точного подсчёта
  - Подсчитывает токены system prompt + context + trigger
  - Учитывает overhead сообщений чата (~4 токена на сообщение)
  - Возвращает { prompt, estimatedCompletion }
  - Работает с gpt-4o и gpt-4o-mini (fallback на gpt-4 encoding)
- src/adapters/mock-adapter.ts — обновлён estimateTokens() для соответствия новому интерфейсу
- tests/unit/mock-adapter.test.ts — обновлены 3 теста + добавлен 1 тест для новой сигнатуры
- tests/unit/openai-adapter-tiktoken.test.ts — создан файл с 9 тестами для tiktoken

**Тесты:** npm run typecheck, npm test — все пройдены (82 tests passed).
**Заметки:** tiktoken использует encoding gpt-4 как fallback для моделей gpt-4o/gpt-4o-mini. Оценка estimatedCompletion берётся из responseConstraints.maxTokens или default 256.

## [2026-04-06] TASK-025: Context Builder: метод buildFactsList()
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/core/context-builder.ts — создан класс ContextBuilder:
  - Конструктор принимает EventJournal и IStore
  - buildFactsList(characterId, showId): Promise<string[]> — извлекает факты из PrivateContext
  - Включает: secrets с префиксом [Secret], goals с [Goal], активные alliances с [Alliance], нераскрытые wildcards с [Wildcard]
  - Добавляет раскрытые козыри из журнала: свои [My Revealed Wildcard], чужие [Revealed by senderId]
- tests/unit/context-builder.test.ts — добавлены 8 тестов для buildFactsList()

**Тесты:** npm run typecheck, npm test — все пройдены (90 tests passed).
**Заметки:** ContextBuilder использует EventJournal.getVisibleEvents() для фильтрации revelation events по audienceIds. От этой задачи зависят TASK-027, TASK-028.

## [2026-04-06] TASK-026: Context Builder: метод buildSlidingWindow()
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/core/context-builder.ts — добавлен метод buildSlidingWindow():
  - buildSlidingWindow(characterId, showId, limit): Promise<EventSummary[]>
  - Использует getVisibleEvents() из EventJournal для фильтрации по audienceIds
  - Конвертирует ShowEvent в EventSummary (senderId, channel, content, timestamp)
  - Возвращает последние N видимых событий для sliding window
- tests/unit/context-builder.test.ts — добавлены 6 тестов для buildSlidingWindow()

**Тесты:** npm run typecheck, npm test — все пройдены (96 tests passed).
**Заметки:** Метод использует EventJournal.getVisibleEvents() который уже фильтрует события по audienceIds и поддерживает limit. От этой задачи зависит TASK-027.

## [2026-04-06] TASK-027: Context Builder: метод buildPromptPackage()
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/core/context-builder.ts — добавлен метод buildPromptPackage():
  - buildPromptPackage(character, show, trigger): Promise<PromptPackage>
  - systemPrompt включает: personalityPrompt, motivationPrompt, boundaryRules, format instruction
  - contextLayers содержит factsList и slidingWindow
  - responseConstraints берутся из CharacterDefinition
  - Использует contextWindowSize из show.configSnapshot (default 50)
- src/core/context-builder.ts — добавлен private метод buildSystemPrompt()
- tests/unit/context-builder.test.ts — добавлены 10 тестов для buildPromptPackage()

**Тесты:** npm run typecheck, npm test — все пройдены (106 tests passed).
**Заметки:** Метод собирает полный PromptPackage для вызова ModelAdapter.call(). От этой задачи зависят TASK-028, TASK-035, TASK-037.

## [2026-04-07] TASK-028: Context Builder: trimToTokenBudget()
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/core/context-builder.ts — добавлен метод trimToTokenBudget():
  - trimToTokenBudget(package, maxTokens, adapter): PromptPackage
  - Использует adapter.estimateTokens() для оценки токенов
  - Сокращает slidingWindow (удаляет старейшие события) если превышен лимит
  - factsList НИКОГДА не обрезается — всегда сохраняется полностью
  - Возвращает пакет, укладывающийся в бюджет
- tests/unit/context-builder.test.ts — добавлены 7 тестов для trimToTokenBudget()

**Тесты:** npm run typecheck, npm test — все пройдены (113 tests passed).
**Заметки:** Метод позволяет контролировать размер контекста для LLM-вызовов. Приоритет отдаётся сохранению factsList (секреты, цели, альянсы), slidingWindow сокращается при необходимости.

## [2026-04-07] TASK-029: Host Module: initializeShow()
**Статус:** done
**Время:** ~15 минут
**Изменения:**
- src/core/host-module.ts — создан класс HostModule:
  - Конструктор принимает IStore и EventJournal
  - initializeShow(template, characters, seed?): Promise<Show>
  - Создаёт запись в shows с config_snapshot (templateId, templateName, contextWindowSize, decisionConfig, privateChannelRules)
  - Создаёт записи в show_characters для каждого персонажа с privateContext
  - Создаёт token_budget для шоу с mode=normal
  - Генерирует seed если не передан (Math.random)
  - Устанавливает currentPhaseId на первую фазу из template
- tests/unit/host-module.test.ts — добавлены 9 тестов для HostModule

**Тесты:** npm run typecheck, npm test — все пройдены (122 tests passed).
**Заметки:** HostModule — основа для управления жизненным циклом шоу. От этой задачи зависят TASK-030, TASK-031, TASK-032, TASK-033.

## [2026-04-07] TASK-030: Host Module: manageTurnQueue()
**Статус:** done
**Время:** ~15 минут
**Изменения:**
- src/types/interfaces/store.interface.ts — добавлено поле speakFrequency в ShowCharacterRecord
- src/storage/sqlite-store.ts — добавлена колонка speak_frequency в таблицу show_characters, обновлены методы createCharacter и mapCharacterRow
- src/core/host-module.ts — добавлен метод manageTurnQueue():
  - manageTurnQueue(showId, phase): Promise<string[]> — возвращает порядок characterId
  - Поддерживает turnOrder: sequential, frequency_weighted, host_controlled
  - frequency_weighted приоритизирует high > medium > low с детерминированным shuffle по seed
  - Приватный метод orderByFrequency() для группировки и сортировки по частоте
- tests/unit/host-module.test.ts — добавлены 6 тестов для manageTurnQueue():
  - sequential turnOrder возвращает в исходном порядке
  - host_controlled возвращает в исходном порядке
  - frequency_weighted сортирует по частоте (high > medium > low)
  - детерминированный порядок при одинаковом seed
  - пустой массив для шоу без персонажей
  - корректная группировка множественных персонажей по частоте

**Тесты:** npm run typecheck, npm test — все пройдены (128 tests passed).
**Заметки:** Для frequency_weighted используется seeded Fisher-Yates shuffle. speakFrequency теперь сохраняется в show_characters для доступа без CharacterDefinition.

## [2026-04-07] TASK-031: Host Module: emitTrigger()
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/core/host-module.ts — добавлен метод emitTrigger():
  - emitTrigger(showId, phaseId, triggerTemplate, targetCharacterIds?): Promise<void>
  - Создаёт событие host_trigger в журнале через eventJournal.append()
  - audienceIds = targetCharacterIds или все персонажи шоу
  - Поддерживает шаблонизацию: {{names}}, {{count}}, {{target}}
  - Сохраняет originalTemplate в metadata
- src/core/host-module.ts — добавлен приватный метод processTemplate()
- tests/unit/host-module.test.ts — добавлены 8 тестов для emitTrigger()

**Тесты:** npm run typecheck, npm test — все пройдены (136 tests passed).
**Заметки:** Метод используется Host Module для отправки триггеров персонажам. Шаблонизация позволяет динамически подставлять имена и количество участников. От этой задачи зависит TASK-033.

## [2026-04-07] TASK-032: Host Module: managePrivateChannels()
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/core/host-module.ts — добавлены методы для управления приватными каналами:
  - openPrivateChannel(showId, participantIds): Promise<void> — создаёт channel_change событие с channel=PRIVATE
  - closePrivateChannel(showId): Promise<void> — создаёт channel_change событие с channel=PUBLIC
  - validatePrivateRequest(showId, requesterId, targetId, rules): Promise<boolean> — проверяет лимиты
- Валидация проверяет:
  - maxPrivatesPerPhase — общий лимит приваток в фазе
  - maxPrivatesPerCharacterPerPhase — лимит приваток на персонажа (и для requester, и для target)
- События channel_change содержат metadata.action ('open'/'close') и metadata.participants
- tests/unit/host-module.test.ts — добавлены 12 тестов для managePrivateChannels()

**Тесты:** npm run typecheck, npm test — все пройдены (148 tests passed).
**Заметки:** Лимиты отслеживаются через подсчёт channel_change событий в текущей фазе. От этой задачи зависит TASK-038.

## [2026-04-07] TASK-033: Host Module: runDecisionPhase()
**Статус:** done
**Время:** ~15 минут
**Изменения:**
- src/core/host-module.ts — добавлен метод runDecisionPhase():
  - runDecisionPhase(showId, decisionConfig, callCharacter): Promise<void>
  - Рассылает decision trigger каждому персонажу
  - При timing: 'simultaneous' — не показывает чужие решения (previousDecisions = [])
  - При timing: 'sequential' — показывает предыдущие решения в trigger
  - Собирает decisionValue из CharacterResponse (fallback на text если нет decisionValue)
  - Создаёт события 'decision' в журнале с корректной visibility
- src/core/host-module.ts — добавлен экспорт типа DecisionCallback
- src/core/host-module.ts — добавлены приватные методы:
  - buildDecisionTrigger(decisionConfig) — строит базовый trigger
  - buildSequentialTrigger(baseTrigger, previousDecisions) — добавляет предыдущие решения
- tests/unit/host-module.test.ts — добавлены 9 тестов для runDecisionPhase():
  - Запуск для 5 персонажей (5 triggers + 5 decisions)
  - Проверка что каждый персонаж получает trigger
  - Создание decision events в журнале с decisionValue
  - visibility = PRIVATE для secret_until_reveal
  - visibility = PUBLIC для public_immediately
  - simultaneous timing не показывает предыдущие решения
  - sequential timing показывает предыдущие решения
  - Корректное сохранение metadata (format, options, timing)
  - Использование text как decisionValue при отсутствии decisionValue

**Тесты:** npm run typecheck, npm test — все пройдены (157 tests passed).
**Заметки:** Метод использует DecisionCallback для получения ответов от персонажей. Orchestrator (TASK-035) будет предоставлять callback с вызовом ModelAdapter. От этой задачи зависит TASK-034.

## [2026-04-07] TASK-034: Host Module: runRevelation()
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/core/host-module.ts — добавлен метод runRevelation():
  - runRevelation(showId, decisionConfig): Promise<void>
  - Получает decision events из текущей фазы
  - При revealMoment: 'after_all' — создаёт одно revelation событие со всеми решениями
  - При revealMoment: 'after_each' — создаёт одно revelation событие на каждое решение
  - Все события PUBLIC с audienceIds = все персонажи
  - metadata содержит revealMoment и данные решений
- tests/unit/host-module.test.ts — добавлены 6 тестов для runRevelation():
  - Создание revelation events после decision phase для 5 персонажей
  - Одно событие со всеми решениями для after_all
  - Отдельное событие на каждое решение для after_each
  - Все события PUBLIC с полным audienceIds
  - Ничего не делает если нет decision events
  - Выбрасывает ошибку если show не найден

**Тесты:** npm run typecheck, npm test — все пройдены (163 tests passed).
**Заметки:** Метод вызывается после runDecisionPhase() для раскрытия решений всем участникам. Зависящих задач нет.

