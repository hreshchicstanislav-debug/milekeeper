# Этап 2: виды записей обслуживания (замена, проверка, долив) — 03.11.2026

Ветка: `feature/service-event-kinds`, создана от `origin/main` (`ac9c7c8`).
Миграция `supabase/migrations/20261103120000_add_service_event_kind.sql`
проверена только на одноразовом локальном PostgreSQL 16 (`npm run test:db-security`).
**В production не применялась. Deployment не выполнялся.**

## Что меняется в данных

- `service_events.kind text NOT NULL DEFAULT 'replacement'`, CHECK:
  `replacement | check | top_up`.
- `service_events.amount_liters numeric(5,2)`, CHECK: `NULL` либо
  `kind = 'top_up' AND 0 < amount_liters <= 99.99`.
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
6. **Deployment нового кода** (preview → проверка → production), отдельное
   согласование.
7. Smoke-проверка: добавить проверку и долив — дата и прогноз последней замены не
   меняются; пробег выше одометра отклоняется с предложением «Обновить пробег».

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
`test:onboarding:browser` и новый `test:service-records:browser`.
