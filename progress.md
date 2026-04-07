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

## [2026-04-07] TASK-035: Orchestrator: базовый класс и dependency injection
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/core/orchestrator.ts — создан новый файл:
  - OrchestratorMode тип: 'AUTO' | 'DEBUG'
  - OrchestratorState интерфейс: showId, currentPhaseIndex, turnIndex, mode
  - Orchestrator class принимает 5 зависимостей: IStore, ModelAdapter, EventJournal, HostModule, ContextBuilder
  - Хранит состояние: showId (null), currentPhaseIndex (0), turnIndex (0), mode ('AUTO')
  - Метод getState(): OrchestratorState возвращает текущее состояние

**Тесты:** npm run typecheck, npm test — все пройдены (163 tests passed).
**Заметки:** Базовый класс для оркестрации шоу. От этой задачи зависят TASK-036, TASK-037, TASK-038, TASK-039, TASK-040.

## [2026-04-07] TASK-036: Orchestrator: runPhase()
**Статус:** done
**Время:** ~15 минут
**Изменения:**
- src/core/orchestrator.ts — добавлен метод runPhase():
  - runPhase(showId, phase): Promise<void>
  - Создаёт событие phase_start с metadata (phaseType, durationMode, durationValue, turnOrder)
  - Получает turnQueue через hostModule.manageTurnQueue()
  - Выполняет ходы по turnOrder: для durationMode 'turns' делает durationValue ходов на персонажа
  - Проверяет completionCondition (turns_complete)
  - Создаёт событие phase_end с metadata (totalTurns, completionCondition)
  - Обновляет внутреннее состояние: showId, turnIndex
  - Добавлен приватный метод isPhaseComplete() для проверки условия завершения
- tests/unit/orchestrator.test.ts — создан новый файл с 6 тестами:
  - getState возвращает начальное состояние
  - runPhase создаёт phase_start событие
  - runPhase создаёт phase_end событие
  - Выполняет все ходы согласно durationValue (3 персонажа x 3 хода = 9)
  - phase_start имеет меньший sequenceNumber чем phase_end
  - audienceIds содержит всех персонажей

**Тесты:** npm run typecheck, npm test — все пройдены (169 tests passed).
**Заметки:** Метод управляет жизненным циклом фазы. Фактическая обработка хода персонажа будет в processCharacterTurn() (TASK-037).


## [2026-04-07] TASK-037: Orchestrator.processCharacterTurn()
**Статус:** done
**Время:** ~20 минут
**Изменения:**
- src/core/host-module.ts — добавлено сохранение characterDefinitions в configSnapshot:
  - При initializeShow() теперь сохраняются все CharacterDefinition (id, name, publicCard, personalityPrompt, motivationPrompt, boundaryRules, speakFrequency, responseConstraints)
- src/core/orchestrator.ts — добавлен метод processCharacterTurn():
  - processCharacterTurn(showId, characterId, trigger): Promise<CharacterResponse>
  - Собирает PromptPackage через ContextBuilder.buildPromptPackage()
  - Вызывает adapter.call() для получения ответа от LLM
  - Записывает событие 'speech' в журнал с content из response.text
  - Обновляет token budget через store.updateBudget()
  - Возвращает CharacterResponse для дальнейшей обработки
- tests/unit/orchestrator.test.ts — добавлены 7 тестов для processCharacterTurn:
  - Возвращает CharacterResponse от adapter.call()
  - Записывает speech событие с правильным content
  - Обновляет token budget после хода
  - Выбрасывает ошибку если show не найден
  - Выбрасывает ошибку если character не найден
  - Устанавливает правильные audienceIds на speech событие
  - Вызывает adapter с PromptPackage от ContextBuilder

**Тесты:** npm run typecheck, npm test — все пройдены (176 tests passed).
**Заметки:** Метод реализует полный цикл обработки хода персонажа: сборка контекста -> вызов LLM -> запись в журнал -> обновление бюджета.


## [2026-04-07] TASK-038: Orchestrator.handleIntent()
**Статус:** done
**Время:** ~15 минут
**Изменения:**
- src/core/orchestrator.ts — добавлен метод handleIntent():
  - handleIntent(showId, response: CharacterResponse, senderId): Promise<void>
  - Обрабатывает intent из CharacterResponse:
    - 'speak' — ничего дополнительного (речь уже записана в processCharacterTurn)
    - 'request_private' — вызывает HostModule.validatePrivateRequest() и открывает приватный канал если запрос валиден
    - 'reveal_wildcard' — создаёт событие 'revelation' с козырем (isWildcard: true, PUBLIC)
    - 'end_turn' — логирует пропуск хода через logger.info()
  - Добавлены приватные методы: handleRequestPrivate(), handleRevealWildcard(), handleEndTurn()
- tests/unit/orchestrator.test.ts — добавлены 8 тестов для handleIntent:
  - Ничего не делает для 'speak' intent
  - Ничего не делает когда intent не указан
  - Вызывает validatePrivateRequest для 'request_private'
  - Открывает приватный канал если запрос валиден
  - Не открывает канал если target не указан
  - Создаёт revelation событие для 'reveal_wildcard'
  - Устанавливает всех персонажей как audience для wildcard revelation
  - Логирует для 'end_turn' без создания событий

**Тесты:** npm run typecheck, npm test — все пройдены (184 tests passed).
**Заметки:** Метод обрабатывает различные интенты персонажей, позволяя им взаимодействовать с системой (запрос приватки, раскрытие козыря, пропуск хода).


## [2026-04-07] TASK-039: Orchestrator.budgetControl()
**Статус:** done
**Время:** ~15 минут
**Изменения:**
- src/core/orchestrator.ts — добавлены методы контроля бюджета:
  - checkBudget(showId): Promise<BudgetMode> — проверяет текущий бюджет и возвращает режим
    - При использовании >=80% переключает в budget_saving
    - При использовании >=100% переключает в graceful_finish
    - Создаёт события 'system' при смене режима (metadata.budgetModeChange: true)
    - Сохраняет новый режим в store через setBudgetMode()
  - getAdjustedConstraints(showId, baseConstraints): Promise<ResponseConstraints> — возвращает скорректированные ограничения
    - В budget_saving mode уменьшает maxTokens на 50%
  - shouldLimitPrivates(showId): Promise<boolean> — проверяет нужно ли ограничивать приватки
    - Возвращает true в budget_saving и graceful_finish режимах
  - createBudgetModeChangeEvent() — приватный метод для создания system-события при смене режима
- tests/unit/orchestrator.test.ts — добавлены 13 тестов для budgetControl:
  - Возвращает 'normal' при использовании менее 80%
  - Возвращает 'budget_saving' при 80% использовании
  - Возвращает 'graceful_finish' при 100% использовании
  - Создаёт 'system' событие при смене режима
  - Не создаёт событие если режим не меняется
  - Возвращает 'normal' если бюджет не найден
  - Сохраняет смену режима в store
  - Корректно переходит из budget_saving в graceful_finish
  - Тесты для getAdjustedConstraints и shouldLimitPrivates

**Тесты:** npm run typecheck, npm test — все пройдены (197 tests passed).
**Заметки:** Метод проверяет использование токенового бюджета и автоматически переключает режимы экономии. В budget_saving режиме maxTokens сокращается на 50%, а приватные каналы ограничиваются.

## [2026-04-07] TASK-040: Orchestrator.gracefulFinish()
**Статус:** done
**Время:** ~15 минут
**Изменения:**
- src/core/orchestrator.ts — добавлен метод gracefulFinish(showId):
  - gracefulFinish(showId): Promise<void> — корректно завершает шоу
    - Закрывает открытые приватные каналы через hostModule.closePrivateChannel()
    - Пропускает оставшиеся фазы и запускает Decision Phase через hostModule.runDecisionPhase()
    - Собирает решения и выполняет Revelation через hostModule.runRevelation()
    - Создаёт событие 'system' с metadata.graceful_finish: true
    - Обновляет статус шоу на 'completed' через store.updateShow()
  - Добавлен импорт DecisionConfig из primitives

**Тесты:** npm run typecheck, npm test — все пройдены (197 tests passed).
**Заметки:** Метод позволяет корректно завершить шоу досрочно, выполнив все необходимые финальные действия (решения, revelation, закрытие каналов).

## [2026-04-07] TASK-041: Orchestrator.runShow()
**Статус:** done
**Время:** ~20 минут
**Изменения:**
- src/core/orchestrator.ts — добавлен метод runShow(showId):
  - runShow(showId): Promise<void> — полный цикл выполнения шоу
    - Обновляет статус шоу на 'running' при старте
    - Проходит все фазы из шаблона последовательно
    - Для обычных фаз вызывает runPhase()
    - Для фаз типа 'decision' вызывает hostModule.runDecisionPhase()
    - Проверяет бюджет перед каждой фазой через checkBudget()
    - При исчерпании бюджета (graceful_finish mode) вызывает gracefulFinish()
    - В конце вызывает hostModule.runRevelation()
    - Обновляет статус шоу на 'completed' по завершении
  - Добавлен импорт PhaseType из enums
- src/core/host-module.ts — добавлено сохранение phases в configSnapshot для runShow
- tests/unit/orchestrator.test.ts — добавлены 7 тестов для runShow:
  - Запускает все фазы последовательно и завершает шоу
  - Обновляет статус на 'running' в начале
  - Проверяет бюджет перед каждой фазой
  - Вызывает gracefulFinish при исчерпании бюджета
  - Выбрасывает ошибку если шоу не найдено
  - Вызывает runDecisionPhase для фаз типа 'decision'
  - Вызывает runRevelation в конце

**Тесты:** npm run typecheck, npm test — все пройдены (204 tests passed).
**Заметки:** Метод runShow является главной точкой входа для запуска полного цикла шоу, координирует все фазы и обеспечивает корректное завершение.

---

## 2026-04-07: TASK-042 — Orchestrator: DEBUG режим (pause/resume/step)

**Статус:** Выполнено

**Изменения:**
- src/core/orchestrator.ts — добавлен DEBUG режим для пошагового выполнения:
  - setMode(mode: 'AUTO' | 'DEBUG'): void — устанавливает режим выполнения
  - pause(): void — приостанавливает выполнение (сохраняет paused = true)
  - resume(): void — возобновляет выполнение (сбрасывает paused, вызывает stepResolver)
  - step(): Promise<void> — выполняет один ход в DEBUG режиме
  - В DEBUG режиме runShow() ожидает вызова step() перед каждым ходом
  - Добавлен приватный метод runPhaseWithDebug() для обработки фаз в DEBUG режиме
  - Добавлены приватные поля: paused, stepResolver, stepPromise для управления состоянием
  - Добавлен приватный метод waitForStep() для ожидания шага в DEBUG режиме

**Тесты:** npm run typecheck, npm test — все пройдены (204 tests passed).
**Заметки:** DEBUG режим позволяет пошагово выполнять шоу, что полезно для отладки и тестирования. В AUTO режиме runShow() работает как раньше без пауз.

---

## 2026-04-07: TASK-043 — Orchestrator: rollback в DEBUG режиме

**Статус:** Выполнено

**Изменения:**
- src/core/orchestrator.ts — добавлен метод rollbackToPhase():
  - rollbackToPhase(showId, phaseId): Promise<void> — откатывает состояние к началу фазы
  - Использует EventJournal.rollbackToPhase() для удаления событий
  - Сбрасывает currentPhaseIndex и turnIndex к началу указанной фазы
  - Создаёт событие 'system' с metadata.rollback: true
  - Документировано: в Rerun режиме rollback создаёт новую ветку событий
- tests/unit/orchestrator.test.ts — добавлены 5 тестов для rollbackToPhase():
  - Использует EventJournal.rollbackToPhase для удаления событий
  - Сбрасывает состояние оркестратора к началу фазы
  - Создаёт system event с metadata.rollback: true
  - Выбрасывает ошибку если шоу не найдено
  - Выбрасывает ошибку если фаза не найдена

**Тесты:** npm run typecheck, npm test — все пройдены (209 tests passed).
**Заметки:** Rollback позволяет вернуться к началу фазы в DEBUG режиме, удаляя все события от этой фазы и далее. Полезно для отладки и тестирования альтернативных сценариев.

---

## 2026-04-07: TASK-044 — API Server: Fastify setup и базовые routes

**Статус:** Выполнено

**Изменения:**
- src/api/server.ts — создан Fastify API сервер:
  - createDependencies(): инициализация всех зависимостей (composition root)
    - SqliteStore с инициализацией схемы
    - EventJournal
    - HostModule
    - ContextBuilder
    - MockAdapter (по умолчанию, OpenAI создаётся per-show)
    - Orchestrator со всеми зависимостями
  - createServer(): создание Fastify instance и настройка routes
  - GET /health — возвращает { status: 'ok' }
  - startServer(): запуск сервера на PORT из конфига
  - Graceful shutdown по SIGTERM/SIGINT:
    - Закрытие Fastify
    - Закрытие SqliteStore
    - Логирование процесса
  - Экспорт AppDependencies interface для типизации зависимостей

**Тесты:** npm run typecheck, npm test — все пройдены (209 tests passed).
**Заметки:** Composition root создаёт все зависимости при старте сервера. MockAdapter используется по умолчанию, т.к. OpenAI adapter требует per-show контекст (showId, characterId). От этой задачи зависят TASK-045, TASK-046, TASK-047, TASK-048, TASK-049.

---

## 2026-04-07: TASK-045 — API: POST /shows - создание шоу

**Статус:** Выполнено

**Изменения:**
- src/api/server.ts — добавлен POST /shows endpoint:
  - Принимает: { formatId: ShowFormatTemplate, characters: CharacterDefinition[], seed?: number }
  - Вызывает HostModule.initializeShow()
  - Возвращает: { showId, status: 'created' } с кодом 201
  - Валидация входных данных:
    - Проверка наличия и типа formatId
    - Проверка обязательных полей formatId (id, name, phases)
    - Проверка наличия и типа characters (должен быть непустой массив)
    - Проверка min/maxParticipants из шаблона
    - Проверка обязательных полей у каждого персонажа (id, name)
    - Проверка типа seed (если указан)
  - Обработка ошибок с возвратом 400/500

- tests/unit/server.test.ts — создан файл с тестами API:
  - GET /health — проверка работоспособности
  - POST /shows — 14 тестов:
    - Создание шоу с валидными данными
    - Создание шоу без seed
    - Проверка сохранения в БД
    - Валидация отсутствующих полей (body, formatId, characters)
    - Валидация пустого массива characters
    - Валидация min/maxParticipants
    - Валидация обязательных полей персонажей
    - Валидация типа seed

**Тесты:** npm run typecheck, npm test — все пройдены (223 tests passed).
**Заметки:** formatId принимает полный ShowFormatTemplate объект, т.к. хранилище шаблонов ещё не реализовано. В будущем можно добавить lookup по ID.

---

## TASK-046: API: GET /shows/:id/events - SSE endpoint

**Дата:** 2026-04-07

**Статус:** Выполнено

**Изменения:**
- src/core/event-journal.ts — расширен для поддержки real-time уведомлений:
  - EventJournal теперь extends EventEmitter
  - При append() эмитит событие 'event' с полным ShowEvent

- src/api/server.ts — добавлен GET /shows/:id/events endpoint:
  - Content-Type: text/event-stream (SSE)
  - Отправляет все существующие события при подключении
  - Подписывается на journal.on('event') для real-time обновлений
  - Поддержка Last-Event-ID для reconnection (events AFTER lastId)
  - Каждое событие отправляется в формате: `id: {seqNum}\ndata: {JSON}\n\n`
  - Параметр ?snapshot=true для закрытия соединения после отправки существующих событий (полезно для тестирования)
  - Cleanup listener при disconnect клиента

- tests/unit/server.test.ts — добавлены тесты SSE endpoint:
  - Возврат 404 для несуществующего шоу
  - Проверка Content-Type: text/event-stream и Cache-Control: no-cache
  - Отправка существующих событий при подключении
  - Поддержка Last-Event-ID для reconnection
  - Проверка формата SSE (id: и data: строки)

**Тесты:** npm run typecheck, npm test — все пройдены (228 tests passed).
**Заметки:** Используется reply.hijack() для управления raw response в Fastify. Snapshot mode добавлен для тестирования с inject().

## TASK-047: API: POST /shows/:id/control - управление шоу

**Дата:** 2026-04-07

**Статус:** Выполнено

**Изменения:**
- src/api/server.ts — добавлен POST /shows/:id/control endpoint:
  - Принимает { action: 'start' | 'pause' | 'resume' | 'step' | 'rollback', phaseId?: string }
  - action: 'start' — запускает runShow() в фоне (не ожидая завершения)
  - action: 'pause' — вызывает orchestrator.pause()
  - action: 'resume' — вызывает orchestrator.resume()
  - action: 'step' — вызывает orchestrator.step()
  - action: 'rollback' + phaseId — вызывает rollbackToPhase()
  - Валидация action, проверка существования шоу, обработка ошибок

- tests/unit/server.test.ts — добавлены тесты для POST /shows/:id/control:
  - Возврат 404 для несуществующего шоу
  - Возврат 400 для отсутствующего body
  - Возврат 400 для невалидного action
  - Успешный start (проверка статуса running/completed)
  - Успешный pause, resume, step
  - Возврат 400 для rollback без phaseId
  - Успешный rollback с phaseId

**Тесты:** npm run typecheck, npm test — все пройдены (237 tests passed).
**Заметки:** runShow() запускается без await для non-blocking execution. MockAdapter выполняет шоу очень быстро, поэтому тест проверяет ['running', 'completed'] статусы.

## TASK-048: API: GET /shows/:id/status - статус и бюджет

**Дата:** 2026-04-07

**Статус:** Выполнено

**Изменения:**
- src/api/server.ts — добавлен GET /shows/:id/status endpoint:
  - Возвращает текущее состояние шоу
  - Поля ответа: status, currentPhaseId, eventsCount, tokenBudget
  - tokenBudget: { total, used, mode, percentUsed }
  - Возврат 404 если шоу не найдено

**Тесты:** npm run typecheck, npm test — все пройдены (237 tests passed).
**Заметки:** eventsCount получается через store.getLatestSequence(), percentUsed вычисляется как (used / total) * 100.

## TASK-049: Debug UI: HTML layout

**Дата:** 2026-04-07

**Статус:** Выполнено

**Изменения:**
- web/debug-ui/index.html — создан HTML layout с тремя секциями:
  - Event Feed (слева) — лента событий с контейнером для динамического добавления
  - Character Cards (справа) — карточки персонажей с placeholder
  - Control Panel (внизу) — кнопки Start/Pause/Resume/Step, статусы, token counter

- web/debug-ui/styles.css — создан CSS со стилями:
  - Цветовая схема для каналов: PUBLIC=white, PRIVATE=yellow (#fff9c4), ZONE=blue (#bbdefb)
  - Темная тема с акцентным цветом #00d9ff
  - Responsive layout с breakpoints для 1024px, 768px, 480px
  - Стили для событий, карточек персонажей, контрольной панели

**Тесты:** npm run typecheck, npm test — все пройдены (237 tests passed).
**Заметки:** Layout готов для подключения SSE и JavaScript логики в следующих задачах (TASK-050, TASK-051, TASK-052).

## TASK-050: Debug UI: SSE client и Event Feed

**Дата:** 2026-04-07

**Статус:** Выполнено

**Изменения:**
- web/debug-ui/app.js — создан JavaScript клиент для SSE:
  - Подключение к /shows/:id/events через EventSource
  - Отображение событий в ленте: время, фаза, канал, sender, content
  - Цветовая маркировка по каналу (PUBLIC=white, PRIVATE=yellow, ZONE=blue)
  - Auto-scroll к новым событиям через scrollToBottom()
  - Reconnection при обрыве (до 5 попыток с интервалом 2с)
  - XSS защита через escapeHtml()

- web/debug-ui/styles.css — добавлены стили:
  - .event-meta для отображения метаданных события
  - .system-message для системных сообщений в ленте

**Тесты:** npm run typecheck, npm test — все пройдены (237 tests passed).
**Заметки:** EventSource подключается по URL /shows/{showId}/events, поддерживает Last-Event-ID для reconnection.

## TASK-053: Show Format: создание шаблона 'Коалиция' (MVP формат)

**Дата:** 2026-04-07

**Статус:** Выполнено

**Изменения:**
- src/formats/coalition.json — создан шаблон формата по спецификации из PRD раздел 12:
  - id: "coalition", name: "Коалиция"
  - minParticipants: 5, maxParticipants: 5
  - 3 фазы:
    - Фаза 1: Знакомство (PUBLIC, sequential, 15 ходов)
    - Фаза 2: Переговоры (PUBLIC+PRIVATE, frequency_weighted, 15 ходов)
    - Фаза 3: Финальное решение (DECISION, sequential)
  - privateChannelRules: maxPrivatesPerPhase=4, maxPrivatesPerCharacterPerPhase=2
  - decisionConfig: timing=simultaneous, visibility=secret_until_reveal, revealMoment=after_all, format=choice

- tests/unit/coalition-template.test.ts — создан тест для валидации шаблона против ShowFormatTemplate:
  - Проверка базовой структуры (id, name, participants)
  - Проверк�� всех 3 фаз и их полей
  - Проверка privateChannelRules и decisionConfig
  - Проверка channelTypes и contextWindowSize

**Тесты:** npm run typecheck, npm test — все пройдены (257 tests passed).
**Заметки:** Шаблон соответствует ShowFormatTemplate из types/template.ts. Wildcard trigger будет реализован в контексте персонажей (TASK-054).

## TASK-054: Characters: создание 5 персонажей для 'Коалиция'

**Дата:** 2026-04-07

**Статус:** Выполнено

**Изменения:**
- src/formats/characters/ — создана директория для персонажей
- src/formats/characters/viktor.json — Виктор, опытный переговорщик (speakFrequency: high)
- src/formats/characters/alina.json — Алина, финансовый аналитик (speakFrequency: medium, alliance с Еленой)
- src/formats/characters/maxim.json — Максим, социальный предприниматель (speakFrequency: medium, wildcard о Викторе)
- src/formats/characters/elena.json — Елена, HR-директор (speakFrequency: medium, alliance с Алиной)
- src/formats/characters/dmitriy.json — Дмитрий, шахматист-гроссмейстер (speakFrequency: low)

Распределение speakFrequency: 1 high (Виктор), 3 medium (Алина, Максим, Елена), 1 low (Дмитрий)
Alliance: Алина и Елена имеют взаимный альянс (бывшие коллеги)
Wildcard: Максим имеет компромат на Виктора (финансовый скандал)

**Тесты:** npm run typecheck, npm test — все пройдены (257 tests passed).
**Заметки:** Персонажи соответствуют CharacterDefinition из types/character.ts. Каждый имеет уникальную personality и motivation.

## TASK-055: E2E тест: полный выпуск с MockAdapter

**Дата:** 2026-04-07

**Статус:** Выполнено

**Изменения:**
- tests/integration/full-show-mock.test.ts — создан E2E тест для полного выпуска Коалиция:
  - Загружает coalition.json шаблон и все 5 персонажей
  - Использует MockAdapter с фиксированным seed для детерминизма
  - Запускает полный выпуск через orchestrator.runShow()
  - Проверяет: show status = completed, все фазы пройдены
  - Проверяет: decisions собраны от всех 5 персонажей
  - Проверяет: revelation выполнен с revealMoment=after_all
  - Тест проходит за < 10 секунд (фактически ~50ms)
  
Дополнительные тесты:
  - Проверка генерации speech events в discussion фазах
  - Проверка корректного отслеживания token budget
  - Проверка использования character IDs из определений
  - Проверка сохранения private context (alliances, wildcards)

**Тесты:** npm run typecheck, npm test — все пройдены (262 tests passed).
**Заметки:** Тест подтверждает корректную интеграцию всех компонентов: Orchestrator, HostModule, EventJournal, ContextBuilder, MockAdapter.

## TASK-056: E2E тест: полный выпуск с OpenAI Adapter

**Дата:** 2026-04-07

**Статус:** Выполнено

**Изменения:**
- tests/integration/full-show-openai.test.ts — создан E2E тест для полного выпуска с реальным OpenAI API:
  - Тесты пропускаются по умолчанию если нет OPENAI_API_KEY (it.skipIf)
  - Загружает coalition.json шаблон и все 5 персонажей
  - Использует OpenAIAdapter с реальным API
  - Проверяет: show status = completed
  - Проверяет: персонажи отвечают осмысленно (content.length > 10)
  - Проверяет: приватность соблюдается (private events имеют ограниченные audienceIds)
  - Проверяет: LLM calls логируются в БД с raw_request/raw_response
  - Проверяет: token budget отслеживается корректно
  - Проверяет: JSON structure ответов валидна
  - Таймауты 120 секунд для учета API latency

- package.json — добавлен скрипт "test:e2e-openai" для запуска теста

Дополнительный unit-тест:
  - Проверка базового вызова OpenAI API и получения CharacterResponse

**Тесты:** npm run typecheck, npm test — все пройдены (268 tests passed).
**Заметки:** При наличии OPENAI_API_KEY тесты выполняются с реальным API (~45 секунд). Документация по запуску включена в комментарии теста.

## TASK-057: Валидация и санитизация входных данны��

**Дата:** 2026-04-07

**Статус:** Выполнено

**Изменения:**
- src/validation/schemas.ts — создан модуль с Zod-схемами для валидации:
  - Zod-схемы для всех API endpoints (createShowRequestSchema, controlShowRequestSchema)
  - Zod-схема для ShowFormatTemplate (showFormatTemplateSchema)
  - Zod-схема для CharacterDefinition (characterDefinitionSchema)
  - Вспомогательные схемы: Phase, DecisionConfig, PrivateChannelRules, ResponseConstraints, PrivateContext и др.
  - sanitizeString() функция для санитизации строк:
    - Удаление null bytes
    - Удаление control characters (кроме \n и \t)
    - Trim whitespace
    - Опциональное ограничение длины
  - formatValidationError() для понятных сообщений об ошибках
  - validateShowFormatTemplate() и validateCharacterDefinition() для валидации при загрузке

- src/api/server.ts — API endpoints теперь используют Zod вал��дацию:
  - POST /shows — использует validateCreateShowRequest()
  - POST /shows/:id/control — использует validateControlShowRequest()
  - Оши��ки валидации возвращают 400 с понятным описанием

- tests/unit/validation.test.ts — 42 теста для валидации:
  - Тесты sanitizeString()
  - Тесты validateShowFormatTemplate() с реальным coalition.json
  - Тесты validateCharacterDefinition() с реальным персонажем
  - Тесты validateControlShowRequest() для всех actions
  - Тесты validateCreateShowRequest()
  - Тесты защиты от injection (null bytes, control characters)

- tests/unit/server.test.ts — обновлены тесты для новых enum значений
- package.json — добавлена зависимость "zod"

**Тесты:** npm run typecheck, npm test — все пройдены (310 tests passed).
**Заметки:** Zod обеспечивает строгую типизацию и автоматическую санитизацию строк. SQL injection предотвращается параметризованными запросами в SQLite.

## [2026-04-07] TASK-058: Безопасность API ключей и конфиденциальных данных
**Статус:** done
**Время:** ~10 минут
**Изменения:**
Верификация безопасности (все критерии уже выполнены в предыдущих задачах):

1. ✅ `.env` в `.gitignore` — подтверждено (TASK-000, TASK-002)
2. ✅ API ключи только через переменные окружения — `config.ts` использует `process.env.OPENAI_API_KEY`
3. ✅ Логи LLM-вызовов не выводятся в консоль — `OpenAIAdapter` использует `store.logLLMCall()` для записи в БД
4. ✅ raw_request/raw_response не содержат API key — rawRequest содержит только `{model, messages, response_format}`
5. ✅ Нет hardcoded секретов в коде — `grep -r 'sk-' src/` не находит совпадений

**Тесты:** npm run typecheck, npm test — все пройдены (310 tests passed).
**Заметки:** Все меры безопасности были реализованы в предыдущих задачах (TASK-000, TASK-002, TASK-022). Данная задача является верификацией.

## [2026-04-07] TASK-066: Переписать web/debug-ui/app.js на TypeScript
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- web/debug-ui/app.js — удалён (заменён TypeScript версией)
- web/debug-ui/app.ts — создан с полной типизацией:
  - Интерфейс ShowEvent для событий
  - Типизация DOM элементов (HTMLInputElement, HTMLButtonElement, HTMLDivElement)
  - Типизация EventSource и обработчиков событий
  - Типизация MessageEvent<string>
- web/debug-ui/tsconfig.json — создан для браузерной среды:
  - target: ES2020, lib: DOM, DOM.Iterable
  - strict mode, sourceMap
- package.json — обновлены скрипты:
  - build теперь компилирует и src, и web/debug-ui
  - typecheck проверяет оба tsconfig
  - добавлен build:ui для отдельной компиляции UI

**Тесты:** npm run typecheck, npm run build, npm test — все пройдены (310 tests passed).
**Заметки:** index.html не требует изменений — TypeScript компилируется в app.js на то же место.

## [2026-04-07] TASK-051: Debug UI: Character Cards
**Статус:** done
**Время:** ~15 минут
**Изменения:**
- src/api/server.ts — добавлен GET /shows/:id/characters endpoint:
  - Возвращает список персонажей с id, name, modelAdapterId, publicCard
  - Данные берутся из store.getCharacters() и configSnapshot
- web/debug-ui/app.ts — добавлен функционал карточек персонажей:
  - Интерфейсы Character и CharacterStatus
  - fetchCharacters() — загрузка персонажей при подключении к шоу
  - renderCharacterCards() — отрисовка карточек
  - updateCharacterStatus() — обновление статуса по SSE событиям
  - Статусы: waiting, speaking, in-private
  - Подсветка активного персонажа (класс .active)
  - Статус обновляется при событиях speech, channel_change, phase_start/end

**Acceptance Criteria:**
1. ✅ Отображение карточек для каждого персонажа
2. ✅ На карточке: имя, модель, publicCard, статус (ожидает/говорит/в приватке)
3. ✅ Статус обновляется по событиям из SSE
4. ✅ Подсветка активного персонажа

**Тесты:** npm run typecheck, npm run build, npm test — все пройдены (310 tests passed).

## [2026-04-07] TASK-052: Debug UI: Control Panel
**Статус:** done
**Время:** ~20 минут
**Изменения:**
- web/debug-ui/index.html — добавлена кнопка ROLLBACK в control panel
- web/debug-ui/styles.css — добавлен стиль для #rollback-btn (красный цвет ошибки)
- web/debug-ui/app.ts — реализован полный функционал Control Panel:
  - Типы: ShowStatus, StatusResponse, ControlAction
  - DOM элементы для всех кнопок и индикаторов
  - handleControl() — отправка POST /shows/:id/control с action
  - handleRollback() — prompt для phaseId и вызов rollback
  - fetchStatus() — получение статуса через GET /shows/:id/status
  - updateControlPanelUI() — обновление UI по статусу (фаза, ход, токены)
  - updateButtonStates() — управление disabled состояниями кнопок
  - startStatusPolling()/stopStatusPolling() — polling статуса каждые 2 секунды
  - Интеграция в connect()/disconnect() — автоматический старт/стоп polling
  - Token counter с цветовой индикацией (accent -> warning -> error)
  - Подсчет ходов по speech событиям из SSE

**Acceptance Criteria:**
1. ✅ Кнопки: START, PAUSE, RESUME, STEP, ROLLBACK
2. ✅ Кнопки вызывают POST /shows/:id/control
3. ✅ Индикатор текущей фазы и номера хода
4. ✅ Token counter: used / total (прогресс-бар)
5. ✅ Кнопки disabled в неактуальных состояниях

**Тесты:** npm run typecheck, npm run build, npm test — все пройдены (310 tests passed).

## [2026-04-07] TASK-059: Replay механизм: воспроизведение выпуска из llm_calls
**Статус:** done
**Время:** ~25 минут
**Изменения:**
- src/types/interfaces/store.interface.ts — добавлено поле replayAvailable: boolean в ShowRecord
- src/storage/sqlite-store.ts — добавлена поддержка replayAvailable:
  - Добавлена колонка replay_available INTEGER DEFAULT 0 в таблицу shows
  - Миграция для существующих БД через ALTER TABLE
  - Обновлены createShow, updateShow, mapShowRow методы
- src/adapters/replay-adapter.ts — создан новый адаптер для воспроизведения:
  - ReplayAdapter implements ModelAdapter
  - providerId: 'replay', modelId: 'replay-v1'
  - initialize() — загружает llm_calls из store
  - call() — возвращает сохранённый raw_response последовательно
  - estimateTokens() — возвращает сохранённые значения токенов
  - Вспомогательные методы: getTotalCalls(), getCurrentIndex(), reset()
- src/core/orchestrator.ts — добавлен replay функционал:
  - Импорт ReplayAdapter
  - Приватное поле _replayAdapter для временного адаптера
  - Геттер activeAdapter — возвращает replay или обычный адаптер
  - replayShow(showId): Promise<void> — основной метод replay:
    - Проверяет что шоу завершено и есть llm_calls
    - Создаёт и инициализирует ReplayAdapter
    - Очищает события (rollback к началу)
    - Сбрасывает token budget
    - Перезапускает шоу с replay адаптером
    - Устанавливает replayAvailable: true после успеха
  - executeShowRun() — выделенный метод выполнения шоу для переиспользования
- src/core/host-module.ts — добавлено replayAvailable: false при создании шоу

**Acceptance Criteria:**
1. ✅ Метод replayShow(showId): Promise<void>
2. ✅ Использует сохранённые raw_response из llm_calls вместо новых LLM вызовов
3. ✅ Результат идентичен оригинальному выпуску (те же LLM ответы = те же события)
4. ✅ Флаг replayAvailable в таблице shows

**Тесты:** npm run typecheck, npm test — все пройдены (310 tests passed).

## [2026-04-07] TASK-060: Export журнала в JSON
**Статус:** done
**Время:** ~10 минут
**Изменения:**
- src/core/event-journal.ts — добавлен export функционал:
  - Интерфейс JournalExport с полями: version, exportedAt, show, characters, events
  - Метод exportJournal(showId): Promise<string> — возвращает JSON строку с полными данными шоу
  - Выбрасывает ошибку если шоу не найдено
  - Версия формата: '1.0' для совместимости с будущим импортом
- src/api/server.ts — добавлен endpoint:
  - GET /shows/:id/export — возвращает JSON экспорт шоу
  - Content-Type: application/json
  - Content-Disposition: attachment с именем файла
  - 404 если шоу не найдено, 500 при других ошибках

**Acceptance Criteria:**
1. ✅ Метод exportJournal(showId): string (JSON)
2. ✅ API endpoint: GET /shows/:id/export
3. ✅ Включает: все события, метаданные шоу, персонажей
4. ✅ Формат пригоден для импорта в будущем (версионирование, полная структура)

**Тесты:** npm run typecheck, npm test — все пройдены (310 tests passed).

## [2026-04-07] TASK-062: Интеграционные тесты: HostModule + SqliteStore + EventJournal
**Статус:** done
**Время:** ~15 минут
**Изменения:**
- tests/integration/host-store-journal.test.ts — создан файл интеграционных тестов:
  - 13 тестов без моков, все компоненты реальные
  - Тест инициализации шоу: HostModule создаёт шоу через реальный SqliteStore
  - Тест создания персонажей: show_characters записываются в БД
  - Тест создания бюджета: token_budget создаётся при инициализации
  - Тест записи событий: EventJournal пишет события, SqliteStore читает
  - Тест sequence numbers: правильная нумерация для множества событий
  - Тест manageTurnQueue: возвращает персонажей из SqliteStore
  - Тест frequency_weighted: персонажи сортируются по speakFrequency
  - Тест emitTrigger: host_trigger сохраняется в БД и читается
  - Тест полного цикла: init -> characters -> events -> read
  - Используется временная SQLite БД (temp file)

**Acceptance Criteria:**
1. ✅ tests/integration/host-store-journal.test.ts создан
2. ✅ Тест инициализации шоу: HostModule создаёт шоу через реальный SqliteStore
3. ✅ Тест записи событий: EventJournal пишет события которые читаются из SqliteStore
4. ✅ Тест manageTurnQueue: возвращает персонажей созданных через SqliteStore
5. ✅ Тест emitTrigger: событие host_trigger сохраняется в БД и читается через getEventsByShowId
6. ✅ Тесты используют временную SQLite БД (temp file)
7. ✅ Нет моков — все компоненты реальные

**Тесты:** npm run typecheck, npm test — все пройдены (323 tests passed).

## [2026-04-07] TASK-063: Интеграционные тесты: ContextBuilder + EventJournal + MockAdapter
**Статус:** done
**Время:** ~15 минут
**Изменения:**
- tests/integration/context-builder-flow.test.ts — создан файл интеграционных тестов:
  - 9 тестов без моков EventJournal, все компоненты реальные
  - Тест buildPromptPackage: использует реальные события из EventJournal
  - Тест revealed wildcards: wildcard revelations появляются в factsList
  - Тест trimToTokenBudget: обрезает реальный PromptPackage с MockAdapter.estimateTokens()
  - Тест factsList never trimmed: проверка что factsList НИКОГДА не обрезается
  - Тест no modification if within budget: пакет не меняется если бюджет достаточен
  - Тест privacy filtering: события с channel='PRIVATE' корректно фильтруются
  - Тест own private messages: собственные приватные сообщения видны в контексте
  - Тест sliding window trimming: старые события обрезаются, новые остаются
  - Тест contextWindowSize: размер окна берётся из show.configSnapshot
  - Используется временная SQLite БД (temp file)

**Acceptance Criteria:**
1. ✅ tests/integration/context-builder-flow.test.ts создан
2. ✅ Тест buildPromptPackage: использует реальные события из EventJournal
3. ✅ Тест trimToTokenBudget: обрезает реальный PromptPackage с MockAdapter.estimateTokens()
4. ✅ Тест приватности: события с channel='private' корректно фильтруются в контексте
5. ✅ Тест sliding window: старые события обрезаются при превышении бюджета
6. ✅ Проверка что factsList НИКОГДА не обрезается при trim
7. ✅ Нет моков EventJournal — события реально пишутся и читаются из БД

**Тесты:** npm run typecheck, npm test — все пройдены (332 tests passed).

## [2026-04-07] TASK-067: Настройка ESLint + исправление всех ошибок линтера
**Статус:** done
**Время:** ~20 минут
**Изменения:**
- eslint.config.js — создан с правилами для TypeScript:
  - eslint.configs.recommended + tseslint.configs.strict
  - no-explicit-any: error
  - no-unused-vars: error (с игнорированием ^_)
  - no-non-null-assertion: warn
- tsconfig.eslint.json — создан для ESLint (включает src/ и tests/)
- package.json — добавлен скрипт "lint": "eslint src/ tests/ web/"
- ralph.sh — добавлен npm run lint в проверки перед коммитом
- src/adapters/openai-adapter.ts — исправлен useless assignment
- src/core/orchestrator.ts — исправлен unused variable в for-of loop
- src/validation/schemas.ts — добавлен eslint-disable для no-control-regex
- tests/integration/full-show-openai.test.ts — удалена неиспользуемая переменная
- tests/unit/coalition-template.test.ts — удалены неиспользуемые импорты и параметры
- tests/unit/context-builder.test.ts — удалены неиспользуемые импорты
- tests/unit/orchestrator.test.ts — удалён неиспользуемый импорт Phase
- tests/unit/validation.test.ts — удалён неиспользуемый импорт

**Acceptance Criteria:**
1. ✅ eslint и @typescript-eslint установлены как devDependencies
2. ✅ eslint.config.js создан с правилами для TypeScript
3. ✅ Правила: strict типизация, no-any, no-unused-vars, consistent-return
4. ✅ npm run lint скрипт добавлен в package.json
5. ✅ npm run lint проходит БЕЗ ошибок на всём коде (только warnings для non-null assertions)
6. ✅ Все найденные ошибки линтера исправлены
7. ✅ ralph.sh обновлён: добавлен npm run lint в проверки перед коммитом

**Тесты:** npm run lint, npm run typecheck, npm test — все пройдены (332 tests passed).

## [2026-04-07] TASK-064: Интеграционные т��сты: полный цикл хода персонажа
**Статус:** done
**Время:** ~15 минут
**Изменения:**
- tests/integration/turn-cycle.test.ts — создан с 11 тестами:
  - Full turn cycle: HostModule -> ContextBuilder -> MockAdapter -> EventJournal -> SqliteStore
  - Prompt assembly from previous show events
  - Adapter response parsing and event saving with metadata
  - LLM call recording with raw_request/raw_response containing PromptPackage and CharacterResponse
  - Token counts recorded in llm_call records
  - Multiple turns: second turn sees first turn event in context, events accumulate correctly
  - Private channel: private events not visible to non-participants
  - Private channel: participants (sender and receiver) can see their private messages

**Acceptance Criteria:**
1. ✅ tests/integration/turn-cycle.test.ts создан
2. ✅ Тест полно��о хода: HostModule -> ContextBuilder -> MockAdapter -> EventJournal -> SqliteStore
3. ✅ Проверка ч��о промпт собирается из предыдущих событий шоу
4. ✅ Проверка что ответ адаптера парсится и сохра��яется как событие
5. ✅ Проверка что llm_call записы��ается в БД с raw_request/raw_response
6. ✅ Тест нескольких ходов подряд: второй ход ��идит событие первого хода в конте��сте
7. ✅ Тест приватного кана��а: ответ в private channel не виден другим персонажам в следующем ходе

**Тесты:** npm run lint, npm run typecheck, npm test — все пройдены (343 tests passed).

## [2026-04-07] TASK-065: Интеграционные тесты: отслеживание token budget
**Статус:** done
**Время:** ~20 минут
**Изменения:**
- tests/integration/token-budget-flow.test.ts — создан с 21 тестом:
  - Budget creation during initializeShow (totalLimit, usedPrompt=0, usedCompletion=0, mode=normal)
  - Budget decrease after updateBudget calls
  - Token accumulation over multiple LLM calls
  - budget_saving mode at 80% usage
  - graceful_finish mode at 100% usage
  - System events on mode transitions
  - Mode persistence in database
  - Correct summation of promptTokens and completionTokens
  - Full budget flow progressing through all modes
  - Edge cases: non-existent budget returns normal, no duplicate events for same mode

**Acceptance Criteria:**
1. ✅ tests/integration/token-budget-flow.test.ts создан
2. ✅ Тест создания бюджета при initializeShow
3. ✅ Тест уменьшения бюджета после каждого LLM вызова
4. ✅ Тест budget_saving_mode: при достижении 80% возвращается BudgetMode.budget_saving
5. ✅ Тест graceful_finish: при достижении 100% возвращается BudgetMode.graceful_finish
6. ✅ Интеграция с Orchestrator.checkBudget() и реальным SqliteStore
7. ✅ Проверка что promptTokens и completionTokens корректно суммируются

**Тесты:** npm run lint (0 errors), npm run typecheck, npm test — все пройдены (364 tests passed).
