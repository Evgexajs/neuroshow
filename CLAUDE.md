# Development Process

## CRITICAL RULES

- **НИКОГДА не дропать базу данных** — ни при каких обстоятельствах, ни в тестах, ни для "фикса". Данные пользователя священны.
- Если тесты падают из-за "disk I/O error" — это проблема локов, а не повод удалять БД

## Debug UI

- После изменения `web/debug-ui/app.ts` запусти `npm run build:ui` для пересборки JS
- Pre-commit hook автоматически пересобирает и добавляет app.js при коммите app.ts
- Если коммит блокируется — запусти `npm run build:ui` вручную

## Working with Tasks

1. Read task from `tasks.json`
2. **Acceptance criteria are LITERAL** — names, signatures, return types must match exactly
3. Before commit, verify EACH criterion is met
4. One task = one commit: `feat(TASK-XXX): <description>`

## References

- `PRD.md` — product spec, data model
- `tasks.json` — tasks with acceptance criteria  
- `progress.md` — completed work log
