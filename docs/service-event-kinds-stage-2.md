# Этап 2: виды записей обслуживания (замена, проверка, долив) — 03.11.2026

Ветка: `feature/service-event-kinds`, создана от `origin/main` (`ac9c7c8`).
Миграция `supabase/migrations/20261103120000_add_service_event_kind.sql`
проверена только на одноразовом локальном PostgreSQL 16 (`npm run test:db-security`).
**В production не применялась. Deployment не выполнялся.**

## Двухшаговый выпуск: версия A, затем версия B (07.11.2026)

Этап выпускается двумя отдельными PR и двумя production-deployments:

| | Что читает | Что можно создать | Где |
|---|---|---|---|
| **A** (совместимая) | `replacement`, `check`, `top_up` | только `replacement` | PR #3 (эта ветка) |
| **B** (полная) | `replacement`, `check`, `top_up` | все три вида | отдельный PR после выдержки A |

- Разница между A и B — одна константа `CREATABLE_SERVICE_EVENT_KINDS` в
  `src/lib/service/serviceEventKinds.ts`. В A это `['replacement']`, в B —
  `SERVICE_EVENT_KINDS`. Флагов, env-переменных и новой инфраструктуры нет.
- Модель данных и миграция у A и B одинаковые. На шаге B база не меняется.
- **Запрет в A действует на сервере.** `addServiceEvent` проверяет вид через
  `isCreatableServiceEventKind()`. На `check` и `top_up` он отвечает `invalid-input`
  ещё до обращения к БД и до чтения одометра. Подделанный запрос server action
  тоже ничего не сохранит. Форма лишь следует тому же списку: если доступен один вид,
  он выбран сразу, а переключатель вида не показывается.
- **Чтение в A полное.** История показывает существующие проверки и доливы (с объёмом)
  и позволяет удалить их. Удаление не меняет прогноз. Прогнозы, «последняя замена» и
  интервалы между заменами считаются только по `replacement`.
- **Зачем так.** Пока работает A, записей `check` и `top_up` из приложения не появляется.
  Поэтому откат A на текущий production безопасен. После B целью отката становится A,
  уже проверенный production-deployment, который правильно читает новые виды. Откат
  B → A не требует изменений данных.
- **Что A не закрывает.** Политики RLS разрешают вошедшему пользователю писать любой
  `kind` напрямую через PostgREST, минуя приложение (anon-ключ публичный, JWT в браузере).
  Поэтому перед откатом A на старый код нужен контрольный запрос (см. «Откат»).
  Ограничение на уровне БД (`CHECK (kind = 'replacement')`) в этот PR не входит.

Тесты:

- поведение B (создание проверок и доливов) остаётся покрытым. Тесты формы и server
  action подменяют модуль видов через `src/lib/service/__tests__/allKindsCreatable.ts`;
- поведение A покрыто без подмены: `serviceEventCreationReleaseA.test.ts` (серверный
  запрет, удаление существующих `check`/`top_up`) и `serviceRecordFormReleaseA.test.tsx`
  (форма без выбора вида, шторка с существующими проверкой и доливом);
- браузерные сценарии читают версию из `CREATABLE_SERVICE_EVENT_KINDS`
  (`scripts/fixtures/creatable-kinds.cjs`). Для A `test:service-records:browser`
  проверяет:
  - замену;
  - подделанный запрос server action с `kind = check`/`top_up`;
  - историю и прогноз с существующими проверками и доливами;
  - их удаление.

  Для B выполняется прежний полный сценарий. Проверить B локально: поменять константу
  на `SERVICE_EVENT_KINDS` и запустить те же команды.

## Что меняется в данных

- `service_events.kind text NOT NULL DEFAULT 'replacement'`, CHECK:
  `replacement | check | top_up`.
- `service_events.amount_liters numeric(5,2)`, CHECK: `NULL` либо
  `kind = 'top_up' AND amount_liters > 0 AND amount_liters <> 'NaN'::numeric`
  (NaN исключён явно: в PostgreSQL `'NaN' > 0` истинно). Произвольного продуктового верхнего
  предела нет: максимум 999,99 л и две цифры после запятой задаёт сам тип
  `numeric(5,2)` (значение больше — SQLSTATE 22003). Приложение проверяет то же
  самое до запроса: положительное число, не больше двух знаков, не больше 999,99.
- Дата записи проверяется на сервере (`addServiceEvent`): не позже текущего момента
  (допуск 10 минут на часы клиента) и не раньше 1 января 1950 года; иначе
  результат `date-in-future` / `date-too-old` с понятным сообщением RU/EN.
- Все существующие строки получают `kind = 'replacement'` через константный
  DEFAULT (в PostgreSQL 11+ — изменение только метаданных, без перезаписи таблицы
  и без `UPDATE`). Смысл старых записей не меняется.
- RLS, четыре политики, внешний ключ владельца и триггер ограничения пробега не
  затрагиваются и действуют для новых видов.
- Неиспользуемая приложением RPC `get_last_service_events_for_items` сохраняет
  сигнатуру и `SECURITY INVOKER`, но возвращает только замены (раньше ссылалась
  на `service_item_id` без квалификации).
- Миграция — одна транзакция с `lock_timeout = 5s`: применяется целиком или никак.

Все расчёты следующей замены (сервер, `/api/service-events`, demo, клиентские
fallback) используют только `kind = 'replacement'`.

## Риск Preview: он смотрит в боевую базу (проверено только чтением, 04.11.2026)

Что показала конфигурация Vercel (проект `milekeeper`, значения переменных не
запрашивались, только имена, окружения и типы):

| Переменная | Окружения |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | development + **Preview** + production (одна запись на все три) |
| `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` | только production (в Preview их нет) |

- **Preview подключён к тому же Supabase, что и production**: одна запись
  переменной действует на оба окружения, а в аккаунте единственный проект
  (`nsmdouxbxajiyjqxgqml`, см. `docs/auth-e2e-preview-plan.md`). Отдельной
  тестовой базы нет.
- **Каждый push ветки создавал Preview автоматически**: `createDeployments: enabled`,
  Git-репозиторий связан, а `vercel.json` отключал автодеплой только для `main`
  (теперь отключён для всех веток, см. ниже).
  Последние Preview (`feature/mileage-history-improvements`,
  `security/nextjs-october-2026` и др.) собраны именно так, `source: git`. Открытие
  PR отдельного деплоя не добавляет, но каждый коммит в ветке PR даёт новый Preview.
- **Ключа service role в Preview нет**, поэтому административные операции там
  недоступны. Доступ к данным возможен только как у обычного пользователя под RLS:
  нужно войти в аккаунт.
- **Вход из Preview практически невозможен**, пока в Supabase Auth разрешены
  только `localhost:3001` и `milekeeper.vercel.app` (состояние на октябрь 2026,
  в этот раз через Dashboard не перепроверялось): OAuth вернёт на основной сайт.
  Preview также закрыт Vercel Authentication (`all_except_custom_domains`).
  Защита хрупкая: добавление шаблона `https://*.vercel.app/**` в Redirect URLs
  (его предлагают для E2E) сразу откроет Preview доступ к реальным аккаунтам.
- Последствия, если зайти под реальным пользователем:
  - **Preview нового кода до миграции**: запросы с `kind` падают, функция не работает;
  - **Preview нового кода после миграции**: запись `check` / `top_up` уходит в боевую
    БД, а работающий production (старый код) посчитает её заменой и сбросит прогноз
    (см. «Откат»).

### Как безопасно проверять до миграции (бесплатно, ничего не создавая)

1. **Основная проверка — локально**: одноразовый PostgreSQL (`test:db-security`),
   синтетическая фикстура Supabase и браузерные сценарии (`test:service-records:browser`
   на 320 и 390 px, RU/EN), `npm run build`. Это уже выполнено для этой ветки.
2. **Не давать веткам Preview.** С 07.11.2026 `vercel.json` отключает автодеплой из Git
   **для всех веток**. Это сознательное решение для MileKeeper, пока Preview работает с
   боевой Supabase:
   ```json
   "git": { "deploymentEnabled": false }
   ```
   - Настройка действует только на deployments, которые запускает Git-интеграция
     Vercel при push. Ручной `vercel deploy` из CLI она не затрагивает: в самом CLI
     этого ключа нет, он работает только на стороне Git-интеграции. С 16.10 так уже
     выпускается production при `"main": false`.
   - GitHub CI ничего не деплоит (`permissions: contents: read`, без секретов Vercel)
     и от этой настройки не зависит.
   - Vercel читает `vercel.json` из коммита, который запушен. Ветки, созданные от
     `main` до merge этого PR, по-прежнему получат Preview, потому что в их `vercel.json`
     отключён только `main`. Ветку для B нужно создавать от коммита A.
   - Если Preview понадобится, нужна отдельная тестовая база (п. 5) и явное включение
     нужных веток.
3. **Не вводить `*.vercel.app` в Redirect URLs Supabase** и не использовать Preview
   для E2E с реальными аккаунтами, пока нет отдельной тестовой базы.
4. Выпуск: резервная копия → миграция → production deployment через CLI → smoke
   (шаги ниже). Старый код с новой схемой совместим, обратное — нет.
5. Если позже понадобится настоящий Preview: отдельный бесплатный проект Supabase
   (только по явному разрешению, потому что это новый ресурс) и переменные Preview,
   заданные только для окружения Preview. До тех пор Preview этой ветки
   использовать нельзя.
6. После первых `check` / `top_up` откат на старый код небезопасен. Поэтому выбран
   двухшаговый выпуск A → B (см. раздел в начале): пока работает только A, такие
   записи из приложения не появляются.

## Порядок выпуска

Каждый шаг ниже, связанный с production, требует отдельного согласования.

### Шаг A (этот PR)

1. **Резервная копия** production-БД (снимок Supabase или `pg_dump` 17 таблиц
   `service_events`, `service_items`, `odometer_entries`), сохранить вне Git.
2. **Проверка до применения** (только чтение):
   ```sql
   SELECT count(*), md5(string_agg(id::text || mileage_km || occurred_at, ',' ORDER BY id))
   FROM public.service_events;
   SELECT column_name FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'service_events';
   ```
   Колонок `kind` и `amount_liters` ещё нет; записать count и md5.
3. **Dry-run**: `supabase db push --linked --dry-run` должен показать ровно одну
   миграцию `20261103120000_add_service_event_kind.sql`.
4. **Применить миграцию до deployment нового кода.** Старое приложение с новой
   схемой работает как раньше: его вставки без `kind` становятся `replacement`.
5. **Проверка после применения**:
   ```sql
   -- count и md5 совпадают с шагом 2
   SELECT kind, count(*), count(amount_liters) FROM public.service_events GROUP BY kind;
   -- ожидается одна строка: replacement | N | 0
   SELECT conname, convalidated, pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conrelid = 'public.service_events'::regclass
     AND conname IN ('service_events_kind_check', 'service_events_amount_liters_check');
   -- определение amount_liters_check содержит 'NaN'
   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.service_events'::regclass;
   SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'service_events';
   ```
6. **Merge PR #3 (версия A)**. Автодеплоя нет. Затем production deployment через CLI
   (`vercel deploy --prod --skip-domain` → `READY` → `vercel promote`). Записать id
   deployment A: он станет целью отката для B.
7. **Smoke A**:
   - главная, `/items/[id]` и `/history` открываются, прогнозы совпадают с прежними;
   - в форме нет выбора вида, кнопка «Сохранить замену»;
   - форму можно открыть и закрыть без сохранения;
   - в логах Vercel нет ошибок.
8. **Выдержка A**: несколько дней реального использования. Срок определяет владелец.

### Шаг B (отдельный PR)

1. Ветка от коммита A. В её `vercel.json` уже `deploymentEnabled: false`.
2. Одна правка: `CREATABLE_SERVICE_EVENT_KINDS = SERVICE_EVENT_KINDS`. Подмены
   `allKindsCreatable` в тестах становятся лишними, их можно убрать. Тесты `*ReleaseA`
   заменить проверкой B. Браузерные сценарии сами переключатся на полный вариант B.
3. Свежая резервная копия и count/md5. Миграций нет: dry-run показывает 0.
4. Merge, затем production deployment через CLI, как для A.
5. **Smoke B**: добавить проверку и долив. Дата и прогноз последней замены не
   меняются. Пробег выше одометра отклоняется с предложением «Обновить пробег».
   Запись с датой раньше последнего показания требует указать пробег на эту дату.

## Откат

- **A → предыдущий production** (старый код без `kind`). Сначала выполнить контрольный запрос:
  ```sql
  SELECT count(*) FROM public.service_events WHERE kind <> 'replacement';
  ```
  - **0** → `vercel rollback` на прежний deployment. Схема остаётся: старый код с ней
    совместим, его вставки получают DEFAULT `replacement`.
  - **> 0** (кто-то писал напрямую через PostgREST) → на старый код не откатываться,
    исправлять вперёд в A.
- **B → A**: `vercel rollback` на deployment A. БД не трогать. Записи `check`/`top_up`
  остаются: A их правильно показывает, удаляет и не учитывает в прогнозах. Создавать
  новые A не даёт.
- После `vercel rollback` Vercel отключает автоназначение production-домена. Вернуться
  вперёд можно только явным `vercel promote`.
- Ни в каком сценарии не удалять колонки, не переписывать `kind`, не удалять записи
  пользователей и не выполнять down-миграцию. Down-миграции нет намеренно.

## Проверки этапа

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`,
`npm run test:db-security` (с `LC_ALL=en_US.UTF-8` на macOS), браузерные
`test:demo:hydration`, `test:auth-recovery:browser`, `test:i18n:browser`,
`test:onboarding:browser` и новый `test:service-records:browser` (в нём 320×568 и
390×844, RU/EN: сегменты типа, объём долива без прокрутки, историческая дата,
серверный отказ по будущей дате, подтверждение удаления и работа с клавиатуры).
Браузерные сценарии проверяют ту версию (A или B), которую задаёт
`CREATABLE_SERVICE_EVENT_KINDS`. Для A вместо создания проверки и долива они проверяют
серверный отказ на подделанный запрос, существующие проверки и доливы в истории и
прогнозе и их удаление.

Примечание: `ItemDetailsSheet` на `/items` сейчас нельзя открыть из интерфейса
(строка списка ведёт на страницу `/items/[id]`, а шторка открывается только после
сохранения «Настроек», которые открываются из самой шторки). Поэтому форма и
удаление в ней покрыты модульным тестом `itemDetailsSheet.test.tsx`, а не браузером.
