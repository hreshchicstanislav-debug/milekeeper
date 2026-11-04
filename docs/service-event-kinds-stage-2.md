# Этап 2: виды записей обслуживания (замена, проверка, долив) — 03.11.2026

Ветка: `feature/service-event-kinds`, создана от `origin/main` (`ac9c7c8`).
Миграция `supabase/migrations/20261103120000_add_service_event_kind.sql`
проверена только на одноразовом локальном PostgreSQL 16 (`npm run test:db-security`).
**В production не применялась. Deployment не выполнялся.**

## Что меняется в данных

- `service_events.kind text NOT NULL DEFAULT 'replacement'`, CHECK:
  `replacement | check | top_up`.
- `service_events.amount_liters numeric(5,2)`, CHECK: `NULL` либо
  `kind = 'top_up' AND amount_liters > 0`. Произвольного продуктового верхнего
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
- **Каждый push ветки создаёт Preview автоматически**: `createDeployments: enabled`,
  Git-репозиторий связан, а `vercel.json` отключает автодеплой только для `main`.
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
2. **Не давать этой ветке Preview**. Самый простой способ — одна строка в
   `vercel.json` ветки (minimatch поддерживается, `main` уже отключён):
   ```json
   "git": { "deploymentEnabled": { "main": false, "feature/service-event-kinds": false } }
   ```
   Строку нужно убрать после выпуска. Менять настройки Vercel для этого не требуется.
   Либо не пушить ветку до дня выпуска и сразу выпускать по списку ниже.
3. **Не вводить `*.vercel.app` в Redirect URLs Supabase** и не использовать Preview
   для E2E с реальными аккаунтами, пока нет отдельной тестовой базы.
4. Выпуск: резервная копия → миграция → production deployment через CLI → smoke
   (шаги ниже). Старый код с новой схемой совместим, обратное — нет.
5. Если позже понадобится настоящий Preview: отдельный бесплатный проект Supabase
   (только по явному разрешению, потому что это новый ресурс) и переменные Preview,
   заданные только для окружения Preview. До тех пор Preview этой ветки
   использовать нельзя.
6. Осталось неустранённым: после первых `check` / `top_up` откат на старый код
   небезопасен. Надёжнее двухшаговый выпуск: сначала версия, которая только
   *читает* `kind`, затем включение формы. Здесь он не реализован (решение
   владельца).

## Порядок выпуска

1. **Резервная копия** production-БД (снимок Supabase или `pg_dump` таблицы
   `service_events`), сохранить вне Git.
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
   SELECT conname, convalidated FROM pg_constraint
   WHERE conrelid = 'public.service_events'::regclass
     AND conname IN ('service_events_kind_check', 'service_events_amount_liters_check');
   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.service_events'::regclass;
   SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'service_events';
   ```
6. **Deployment нового кода** — сразу в production через CLI, отдельное согласование.
   Preview этой ветки не использовать (см. риск выше): он работает с боевой базой.
7. Smoke-проверка: добавить проверку и долив — дата и прогноз последней замены не
   меняются; пробег выше одометра отклоняется с предложением «Обновить пробег»;
   запись с датой раньше последнего показания требует указать пробег на эту дату.

## Откат

- **До появления новых видов** (сразу после шага 6, пока никто не сохранил
  проверку или долив) можно вернуть предыдущий deployment: схема с ним совместима.
- **После того как появились записи `check`/`top_up`, старый deployment больше не
  безопасен**: он не знает `kind` и посчитает проверки и доливы заменами, сбросив
  прогнозы.
- Восстановление — только исправленной совместимой версией приложения (fix-forward).
  Новые данные пользователей **не удалять** и `kind` не переписывать.
- Down-миграции нет намеренно: удаление колонок уничтожило бы данные пользователей.

## Проверки этапа

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`,
`npm run test:db-security` (с `LC_ALL=en_US.UTF-8` на macOS), браузерные
`test:demo:hydration`, `test:auth-recovery:browser`, `test:i18n:browser`,
`test:onboarding:browser` и новый `test:service-records:browser` (в нём 320×568 и
390×844, RU/EN: сегменты типа, объём долива без прокрутки, историческая дата,
серверный отказ по будущей дате, подтверждение удаления и работа с клавиатуры).

Примечание: `ItemDetailsSheet` на `/items` сейчас нельзя открыть из интерфейса
(строка списка ведёт на страницу `/items/[id]`, а шторка открывается только после
сохранения «Настроек», которые открываются из самой шторки). Поэтому форма и
удаление в ней покрыты модульным тестом `itemDetailsSheet.test.tsx`, а не браузером.
