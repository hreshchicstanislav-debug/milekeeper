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

The database tests need PostgreSQL binaries (`initdb`, `pg_ctl`, `psql`); set `PG_BIN=/path/to/postgresql/bin` if they are not found. They create and remove their own socket-only cluster. More on the database setup: [`supabase/README.md`](../supabase/README.md).

### Browser regression scripts

The browser scripts mock the identity provider, run a local Supabase fixture and need Google Chrome plus Playwright installed outside the project:

```bash
npm install --prefix /tmp/milekeeper-browser-tools --no-save playwright
export MILEKEEPER_PLAYWRIGHT_PATH=/tmp/milekeeper-browser-tools/node_modules/playwright
npm run test:demo:hydration
npm run test:auth-recovery:browser
npm run test:i18n:browser
npm run test:onboarding:browser
```

Run them one at a time: they share ports 3101 and 54329.

Known issue: the onboarding script has an intermittent race in the test itself (it clears cookies while a session sync request may still be in flight). See section 8.2 of the [security-hardening report](security-hardening-2026-10-15.md).

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

Тестам БД нужны бинарные файлы PostgreSQL (`initdb`, `pg_ctl`, `psql`); если они не найдены, задайте `PG_BIN=/path/to/postgresql/bin`. Скрипт сам создаёт и удаляет кластер, доступный только через Unix-сокет. Подробнее о подготовке БД — в [`supabase/README.md`](../supabase/README.md).

### Браузерные регрессионные сценарии

Браузерные сценарии подменяют провайдера входа, поднимают локальную фикстуру Supabase и требуют Google Chrome и Playwright, установленный вне проекта:

```bash
npm install --prefix /tmp/milekeeper-browser-tools --no-save playwright
export MILEKEEPER_PLAYWRIGHT_PATH=/tmp/milekeeper-browser-tools/node_modules/playwright
npm run test:demo:hydration
npm run test:auth-recovery:browser
npm run test:i18n:browser
npm run test:onboarding:browser
```

Запускайте их по одному: они используют общие порты 3101 и 54329.

Известная особенность: в onboarding-сценарии есть плавающая гонка в самом тесте (он очищает cookies, пока может выполняться запрос синхронизации сессии). См. раздел 8.2 [отчёта об усилении безопасности](security-hardening-2026-10-15.md).
