# Testing / Проверки

[English project overview](../README.md) · [Описание проекта на русском](../README.ru.md)

## English

### Main checks

CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs the same checks on every push and pull request:

```bash
npm run typecheck              # tsc over the whole project
npm run lint                   # ESLint
npm test                       # Vitest
npm run build                  # production build
npm run test:db-security       # disposable local PostgreSQL; never connects to Supabase
```

The database tests need PostgreSQL binaries (`initdb`, `pg_ctl`, `psql`); set `PG_BIN=/path/to/postgresql/bin` if they are not found. On macOS run them with `LC_ALL=en_US.UTF-8` if `postmaster became multithreaded during startup` appears. They create and remove their own socket-only cluster. More on the database setup: [`supabase/README.md`](../supabase/README.md).

### Browser regression scripts

The browser scripts mock the identity provider, run a local Supabase fixture and need Google Chrome plus Playwright installed outside the project:

```bash
npm install --prefix /tmp/milekeeper-browser-tools --no-save playwright
export MILEKEEPER_PLAYWRIGHT_PATH=/tmp/milekeeper-browser-tools/node_modules/playwright
npm run test:demo:hydration
npm run test:auth-recovery:browser
npm run test:i18n:browser
npm run test:onboarding:browser
npm run test:service-records:browser   # replacement / check / top-up, paging, delete
```

Run them one at a time: they share ports 3101 and 54329.

The record-form scenarios follow the release set by `CREATABLE_SERVICE_EVENT_KINDS` (`src/lib/service/serviceEventKinds.ts`, read by `scripts/fixtures/creatable-kinds.cjs`): release A (replacement only) checks that the form has no kind choice, that the server refuses a forged check or top-up, and that existing checks and top-ups are shown, deletable and never move the forecast; release B runs the full check / top-up flow. To check B locally, set the constant to `SERVICE_EVENT_KINDS` (do not commit) and run the same commands.

The onboarding and service-records scripts run each locale (RU, EN) in its own browser context and close it before the next one starts. Clearing cookies in a live context is unsafe: a session sync request still in flight could restore them (the former intermittent race, fixed in `1e88069` and `f31d2a7`; background in section 8.2 of the [security-hardening report](security-hardening-2026-10-15.md)). Keep this isolation when adding scenarios.

## Русский

### Основные проверки

Те же проверки CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) запускает на каждый push и pull request:

```bash
npm run typecheck              # tsc по всему проекту
npm run lint                   # ESLint
npm test                       # Vitest
npm run build                  # production-сборка
npm run test:db-security       # временный локальный PostgreSQL; к Supabase не подключается
```

Тестам БД нужны бинарные файлы PostgreSQL (`initdb`, `pg_ctl`, `psql`); если они не найдены, задайте `PG_BIN=/path/to/postgresql/bin`. Если на macOS появляется `postmaster became multithreaded during startup`, запускайте с `LC_ALL=en_US.UTF-8`. Скрипт сам создаёт и удаляет кластер, доступный только через Unix-сокет. Подробнее о подготовке БД — в [`supabase/README.md`](../supabase/README.md).

### Браузерные регрессионные сценарии

Браузерные сценарии подменяют провайдера входа, поднимают локальную фикстуру Supabase и требуют Google Chrome и Playwright, установленный вне проекта:

```bash
npm install --prefix /tmp/milekeeper-browser-tools --no-save playwright
export MILEKEEPER_PLAYWRIGHT_PATH=/tmp/milekeeper-browser-tools/node_modules/playwright
npm run test:demo:hydration
npm run test:auth-recovery:browser
npm run test:i18n:browser
npm run test:onboarding:browser
npm run test:service-records:browser   # замена / проверка / долив, страницы, удаление
```

Запускайте их по одному: они используют общие порты 3101 и 54329.

Сценарии формы записи проверяют версию, заданную `CREATABLE_SERVICE_EVENT_KINDS` (`src/lib/service/serviceEventKinds.ts`). Её читает `scripts/fixtures/creatable-kinds.cjs`.

- **Версия A** (только замена): у формы нет выбора вида; сервер отклоняет подделанный запрос с проверкой или доливом; существующие проверки и доливы видны, удаляются и не сдвигают прогноз.
- **Версия B**: полный сценарий проверки и долива.

Чтобы проверить B локально, временно поставьте константе значение `SERVICE_EVENT_KINDS` (не коммитить) и запустите те же команды.

Onboarding- и service-records-сценарии запускают каждую локаль (RU, EN) в отдельном браузерном контексте и закрывают его перед следующей. Очищать cookies в живом контексте небезопасно: ещё не завершённый запрос синхронизации сессии может их восстановить (прежняя плавающая гонка, исправлена в `1e88069` и `f31d2a7`; предыстория — в разделе 8.2 [отчёта об усилении безопасности](security-hardening-2026-10-15.md)). Сохраняйте эту изоляцию при добавлении сценариев.
