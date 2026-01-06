# P3 — Прод-диагностика: Конфиг окружения и целевой Supabase проект

## Обзор

Документ описывает конфигурацию окружения для production (Vercel) и содержит чек-лист для диагностики проблем с данными, связанных с неправильной настройкой переменных окружения или подключением к другому Supabase проекту.

## Переменные окружения

### Обязательные переменные для production

#### 1. Server-side переменные (не экспортируются в браузер)

**`SUPABASE_URL`**
- **Назначение**: URL проекта Supabase для server-side операций
- **Формат**: `https://[project-ref].supabase.co`
- **Пример**: `https://nsmdouxbxajiyjqxgqml.supabase.co`
- **Использование**: 
  - `src/lib/supabase/adminClient.ts:27`
  - `src/lib/supabase/serverClient.ts:11`
- **Валидация**: Проверяется при создании клиента, выбрасывает ошибку, если отсутствует

**`SUPABASE_ANON_KEY`**
- **Назначение**: Anon (публичный) ключ для server-side операций с RLS
- **Формат**: JWT токен (начинается с `eyJ...`)
- **Использование**: 
  - `src/lib/supabase/serverClient.ts:12`
- **Валидация**: Проверяется при создании клиента, выбрасывает ошибку, если отсутствует
- **Примечание**: В текущей реализации не используется (все операции используют `createAdminClient()`)

**`SUPABASE_SERVICE_ROLE_KEY`**
- **Назначение**: Service Role ключ для обхода RLS (admin операции)
- **Формат**: JWT токен (начинается с `eyJ...`)
- **Использование**: 
  - `src/lib/supabase/adminClient.ts:28`
- **Валидация**: Проверяется при создании клиента, выбрасывает ошибку, если отсутствует
- **⚠️ КРИТИЧНО**: Никогда не должен быть доступен в браузере (только server-side)

#### 2. Client-side переменные (экспортируются в браузер)

**`NEXT_PUBLIC_SUPABASE_URL`**
- **Назначение**: URL проекта Supabase для client-side операций
- **Формат**: `https://[project-ref].supabase.co`
- **Пример**: `https://nsmdouxbxajiyjqxgqml.supabase.co`
- **Использование**: 
  - `src/lib/supabase/browserClient.ts:8`
- **Валидация**: Проверяется при создании клиента, выбрасывает ошибку, если отсутствует
- **Примечание**: В текущей реализации не используется (нет client-side операций с Supabase)

**`NEXT_PUBLIC_SUPABASE_ANON_KEY`**
- **Назначение**: Anon (публичный) ключ для client-side операций
- **Формат**: JWT токен (начинается с `eyJ...`)
- **Использование**: 
  - `src/lib/supabase/browserClient.ts:9`
- **Валидация**: Проверяется при создании клиента, выбрасывает ошибку, если отсутствует
- **Примечание**: В текущей реализации не используется (нет client-side операций с Supabase)

### Опциональные переменные

**`NODE_ENV`**
- **Назначение**: Окружение выполнения (development/production)
- **Значения**: `development`, `production`, `test`
- **Использование**: 
  - Проверки для dev-only функциональности (DevToolsPanel, логирование, профилирование)
  - Управление кэшированием (`getLatestOdometerEntry()` обходит кэш в dev)
- **Установка**: Автоматически устанавливается Next.js/Vercel

## Места использования переменных окружения

### 1. Admin Client (основной, используется везде)

**Файл**: `src/lib/supabase/adminClient.ts`

**Используемые переменные**:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

**Использование**:
- Все server actions (`src/lib/actions/odometerActions.ts`, `src/lib/actions/serviceActions.ts`)
- API routes (`src/app/api/service-events/route.ts`)
- Dev actions (`src/lib/actions/devActions.ts`)

**RLS**: Обходит Row Level Security (использует Service Role Key)

**Проверка безопасности**: 
- Runtime проверка: `typeof window !== 'undefined'` — выбрасывает ошибку, если вызывается в браузере

### 2. Server Client (не используется в текущей реализации)

**Файл**: `src/lib/supabase/serverClient.ts`

**Используемые переменные**:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

**Использование**: Не используется в текущей реализации (все операции используют `createAdminClient()`)

**RLS**: Соблюдает Row Level Security (использует Anon Key)

### 3. Browser Client (не используется в текущей реализации)

**Файл**: `src/lib/supabase/browserClient.ts`

**Используемые переменные**:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**Использование**: Не используется в текущей реализации (нет client-side операций с Supabase)

**RLS**: Соблюдает Row Level Security (использует Anon Key)

## Определение целевого Supabase проекта

### Project Reference (project-ref)

**Из URL**: `https://[project-ref].supabase.co`

**Текущий проект**: `nsmdouxbxajiyjqxgqml`

**Где проверить**:
1. **Локально**: `.env.local` файл
   ```bash
   grep SUPABASE_URL .env.local
   # Должно быть: SUPABASE_URL=https://nsmdouxbxajiyjqxgqml.supabase.co
   ```

2. **На Vercel**: 
   - Dashboard → Project → Settings → Environment Variables
   - Проверить `SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_URL`
   - Оба должны содержать `nsmdouxbxajiyjqxgqml`

3. **В Supabase Dashboard**:
   - Settings → API → Project URL
   - Должен совпадать с переменными окружения

### Ключи доступа

**Где получить**:
1. **Supabase Dashboard** → Settings → API
   - **Project URL** → для `SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** → для `SUPABASE_ANON_KEY` и `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → для `SUPABASE_SERVICE_ROLE_KEY`

**Формат ключей**:
- Anon key: JWT токен, начинается с `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
- Service Role key: JWT токен, начинается с `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

**⚠️ ВАЖНО**: Ключи должны быть из **одного и того же проекта**. Если URL указывает на один проект, а ключи от другого — подключение не будет работать.

## Чек-лист диагностики

### 1. Проверка переменных окружения на Vercel

**Шаги**:
1. Откройте [Vercel Dashboard](https://vercel.com/dashboard)
2. Выберите проект `milekeeper`
3. Перейдите в **Settings** → **Environment Variables**
4. Проверьте наличие всех переменных:
   - ✅ `SUPABASE_URL`
   - ✅ `SUPABASE_ANON_KEY`
   - ✅ `SUPABASE_SERVICE_ROLE_KEY`
   - ✅ `NEXT_PUBLIC_SUPABASE_URL`
   - ✅ `NEXT_PUBLIC_SUPABASE_ANON_KEY`

5. Проверьте, что переменные установлены для всех окружений:
   - ✅ Production
   - ✅ Preview
   - ✅ Development

6. Проверьте значения:
   - `SUPABASE_URL` должен содержать `nsmdouxbxajiyjqxgqml`
   - `NEXT_PUBLIC_SUPABASE_URL` должен содержать `nsmdouxbxajiyjqxgqml`
   - Ключи должны быть JWT токенами (начинаются с `eyJ...`)

**Где подтвердить в коде**:
- `src/lib/supabase/adminClient.ts:27-28` — проверка переменных
- `src/lib/supabase/browserClient.ts:8-9` — проверка переменных

### 2. Проверка соответствия локальных и production переменных

**Шаги**:
1. **Локально**: Проверьте `.env.local`
   ```bash
   cat .env.local | grep SUPABASE
   ```

2. **На Vercel**: Скопируйте значения из Dashboard

3. **Сравните**:
   - `SUPABASE_URL` должен совпадать
   - `NEXT_PUBLIC_SUPABASE_URL` должен совпадать
   - Ключи должны совпадать (но могут отличаться форматом, если один из них устарел)

4. **Проверьте project-ref**:
   - Извлеките project-ref из URL: `https://([^.]+)\.supabase\.co`
   - Должен быть одинаковым: `nsmdouxbxajiyjqxgqml`

**Где подтвердить в коде**:
- Все клиенты проверяют переменные при создании, но не валидируют project-ref
- Нужно проверить вручную, что URL содержит правильный project-ref

### 3. Проверка подключения к правильному Supabase проекту

**Шаги**:
1. **Локально**: Добавьте тестовую запись пробега
   ```bash
   # Через UI или напрямую в Supabase Dashboard
   ```

2. **На Vercel**: Проверьте, видна ли запись
   - Откройте `https://milekeeper.vercel.app`
   - Проверьте текущий пробег

3. **В Supabase Dashboard**:
   - Откройте Table Editor → `odometer_entries`
   - Проверьте, что запись существует

4. **Если запись не видна на Vercel**:
   - Проверьте, что Vercel использует правильный project-ref
   - Проверьте логи деплоя на Vercel (может быть ошибка подключения)

**Где подтвердить в коде**:
- `src/lib/supabase/adminClient.ts:52` — создание клиента
- `src/lib/actions/odometerActions.ts:102-109` — запрос к базе

### 4. Проверка Row Level Security (RLS)

**Статус**: ❌ RLS политики **не настроены**

**Доказательства**:
- `supabase/migrations/20260101114456_init_milekeeper.sql:4-5`:
  ```sql
  -- TODO: Add Row Level Security (RLS) policies when authentication is implemented
  -- TODO: Consider adding RLS policies to restrict access based on user context
  ```

**Текущая реализация**:
- Все операции используют `createAdminClient()` с Service Role Key
- Service Role Key **обходит RLS** (полный доступ к базе)
- RLS политики не влияют на доступ к данным

**Гипотеза "RLS блокирует доступ"**: ❌ Не применима, так как RLS не настроен

**Где подтвердить в коде**:
- `src/lib/supabase/adminClient.ts:6` — комментарий: "bypasses Row Level Security (RLS)"
- `supabase/migrations/20260101114456_init_milekeeper.sql:4-5` — TODO комментарии

### 5. Проверка кэширования

**Статус**: ✅ Кэш отключен для критических операций

**Детали**:
1. **`getMaxMileageEntry()`**: Кэш отключен (после коммита `2e6f64b`)
   - Файл: `src/lib/actions/odometerActions.ts:129-134`
   - Всегда запрашивает свежие данные из базы

2. **`getLatestOdometerEntry()`**: Кэш включен в production
   - Файл: `src/lib/actions/odometerActions.ts:87-94`
   - Использует `unstable_cache` с тегом `TAGS.odometer`

3. **`listOdometerEntries()`**: Кэш включен
   - Файл: `src/lib/actions/odometerActions.ts:40-50`
   - Использует `unstable_cache` с тегом `TAGS.odometerEntries`

4. **Next.js Fetch Cache**: Отключен
   - Все страницы используют `export const dynamic = 'force-dynamic'`
   - `export const revalidate = 0`

**Гипотеза "кэш держит старьё"**: ⚠️ Возможна для `getLatestOdometerEntry()` и `listOdometerEntries()`, но не для `getMaxMileageEntry()` (используется для текущего пробега)

**Где подтвердить в коде**:
- `src/lib/actions/odometerActions.ts:129-134` — `getMaxMileageEntry()` обходит кэш
- `src/app/page.tsx:19-20` — `force-dynamic` для главной страницы
- `src/app/items/[id]/page.tsx:8-10` — `force-dynamic` для страницы элемента

### 6. Проверка ISR (Incremental Static Regeneration)

**Статус**: ❌ ISR не используется

**Доказательства**:
- Все страницы используют `export const dynamic = 'force-dynamic'`
- `export const revalidate = 0` (отключение revalidation)

**Гипотеза "ISR держит старьё"**: ❌ Не применима, так как ISR не используется

**Где подтвердить в коде**:
- `src/app/page.tsx:19-20`
- `src/app/items/page.tsx:10-11`
- `src/app/items/[id]/page.tsx:8-10`

### 7. Проверка demo data / сидов

**Статус**: ✅ Защищено от запуска в production

**Детали**:
1. **`DevToolsPanel`**: Не рендерится в production
   - Файл: `src/app/components/DevToolsPanel.tsx:14-16`
   - Проверка: `if (process.env.NODE_ENV === 'production') return null;`

2. **`seedDemoData()`**: Не имеет защиты на уровне функции, но вызывается только из `DevToolsPanel`
   - Файл: `src/lib/actions/devActions.ts:79`
   - Защита: Косвенная (через UI, который не рендерится в production)

3. **`simulateTripRange()`**: Аналогично, вызывается только из `DevToolsPanel`

4. **`wipeAllData()`**: Аналогично, вызывается только из `DevToolsPanel`

**Гипотеза "demo data включены в prod"**: ❌ Не применима, так как DevToolsPanel не рендерится в production

**Где подтвердить в коде**:
- `src/app/components/DevToolsPanel.tsx:14-16` — проверка `NODE_ENV === 'production'`
- `src/app/components/HomeContentClient.tsx:67` — DevToolsPanel рендерится только если `NODE_ENV !== 'production'`

## Гипотезы проблем и способы подтверждения

### Гипотеза 1: "Не тот Supabase проект"

**Описание**: Vercel использует переменные окружения, указывающие на другой Supabase проект.

**Симптомы**:
- Данные на localhost и Vercel различаются
- Добавление записи локально не видно на Vercel
- Project-ref в URL не совпадает

**Как подтвердить**:
1. Проверить `SUPABASE_URL` на Vercel:
   - Vercel Dashboard → Settings → Environment Variables
   - Извлечь project-ref: `https://([^.]+)\.supabase\.co`
   - Должен быть: `nsmdouxbxajiyjqxgqml`

2. Проверить ключи:
   - Скопировать `SUPABASE_SERVICE_ROLE_KEY` с Vercel
   - Проверить в Supabase Dashboard → Settings → API → service_role key
   - Должны совпадать

3. Проверить данные напрямую:
   - Добавить запись через Supabase Dashboard
   - Проверить, видна ли она на Vercel
   - Если не видна — проблема в переменных окружения

**Где подтвердить в коде**:
- `src/lib/supabase/adminClient.ts:27-28` — переменные читаются из `process.env`
- Нет валидации project-ref в коде (нужно проверить вручную)

### Гипотеза 2: "RLS блокирует доступ"

**Описание**: Row Level Security политики блокируют доступ к данным.

**Статус**: ❌ Не применима

**Причина**: 
- RLS политики не настроены (см. миграцию `20260101114456_init_milekeeper.sql:4-5`)
- Все операции используют `createAdminClient()` с Service Role Key, который обходит RLS

**Где подтвердить в коде**:
- `supabase/migrations/20260101114456_init_milekeeper.sql:4-5` — TODO комментарии
- `src/lib/supabase/adminClient.ts:6` — комментарий: "bypasses Row Level Security (RLS)"

### Гипотеза 3: "Кэш держит старьё"

**Описание**: Next.js кэш или Vercel Edge Cache держит устаревшие данные.

**Статус**: ⚠️ Частично применима

**Детали**:
1. **`getMaxMileageEntry()`**: Кэш отключен ✅
2. **`getLatestOdometerEntry()`**: Кэш включен ⚠️
3. **`listOdometerEntries()`**: Кэш включен ⚠️
4. **Next.js Fetch Cache**: Отключен ✅
5. **Vercel Edge Cache**: Может быть активен (не контролируется в коде)

**Как подтвердить**:
1. Проверить логи деплоя на Vercel:
   - Могут быть сообщения о кэшировании
   - Проверить время последнего деплоя

2. Добавить cache-busting параметр в URL:
   - `https://milekeeper.vercel.app/?_t=1234567890`
   - Если данные обновляются — проблема в кэше

3. Проверить заголовки ответа:
   - `Cache-Control` заголовки
   - `X-Vercel-Cache` заголовки

**Где подтвердить в коде**:
- `src/lib/actions/odometerActions.ts:129-134` — `getMaxMileageEntry()` обходит кэш
- `src/lib/actions/odometerActions.ts:87-94` — `getLatestOdometerEntry()` использует кэш
- `src/app/page.tsx:19-20` — `force-dynamic` отключает статическое кэширование

### Гипотеза 4: "ISR держит старьё"

**Описание**: Incremental Static Regeneration кэширует статические страницы.

**Статус**: ❌ Не применима

**Причина**: 
- Все страницы используют `export const dynamic = 'force-dynamic'`
- `export const revalidate = 0` отключает revalidation

**Где подтвердить в коде**:
- `src/app/page.tsx:19-20`
- `src/app/items/page.tsx:10-11`
- `src/app/items/[id]/page.tsx:8-10`

### Гипотеза 5: "Demo data включены в prod"

**Описание**: Функции сидирования данных запускаются в production.

**Статус**: ❌ Не применима

**Причина**:
- `DevToolsPanel` не рендерится в production (`NODE_ENV === 'production'`)
- Все функции сидирования вызываются только из `DevToolsPanel`

**Где подтвердить в коде**:
- `src/app/components/DevToolsPanel.tsx:14-16` — проверка `NODE_ENV === 'production'`
- `src/app/components/HomeContentClient.tsx:67` — DevToolsPanel рендерится только в dev

## Чек-лист для быстрой диагностики

### Шаг 1: Проверка переменных окружения на Vercel

- [ ] Открыть Vercel Dashboard → Settings → Environment Variables
- [ ] Проверить наличие всех 5 переменных:
  - [ ] `SUPABASE_URL`
  - [ ] `SUPABASE_ANON_KEY`
  - [ ] `SUPABASE_SERVICE_ROLE_KEY`
  - [ ] `NEXT_PUBLIC_SUPABASE_URL`
  - [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] Проверить, что переменные установлены для Production окружения
- [ ] Проверить project-ref в URL: должен быть `nsmdouxbxajiyjqxgqml`

### Шаг 2: Сравнение с локальными переменными

- [ ] Проверить `.env.local` локально
- [ ] Сравнить `SUPABASE_URL` (должны совпадать)
- [ ] Сравнить `NEXT_PUBLIC_SUPABASE_URL` (должны совпадать)
- [ ] Сравнить project-ref (должен быть одинаковым)

### Шаг 3: Проверка подключения к базе

- [ ] Добавить тестовую запись пробега локально
- [ ] Проверить в Supabase Dashboard, что запись существует
- [ ] Проверить на Vercel, видна ли запись
- [ ] Если не видна — проблема в переменных окружения

### Шаг 4: Проверка кэширования

- [ ] Проверить логи деплоя на Vercel
- [ ] Добавить cache-busting параметр: `?_t=1234567890`
- [ ] Если данные обновляются — проблема в кэше
- [ ] Проверить заголовки ответа (`Cache-Control`, `X-Vercel-Cache`)

### Шаг 5: Проверка RLS

- [ ] Проверить миграции: RLS политики не настроены (ожидаемо)
- [ ] Проверить, что используется `createAdminClient()` (обходит RLS)
- [ ] Если RLS настроен — проверить политики в Supabase Dashboard

## Рекомендации

### Для предотвращения проблем

1. **Документировать project-ref**:
   - Добавить в README или `.env.example`
   - Указать в комментариях кода

2. **Валидация project-ref**:
   - Добавить проверку project-ref при создании клиента
   - Выбрасывать ошибку, если project-ref не совпадает с ожидаемым

3. **Мониторинг**:
   - Логировать project-ref при старте приложения (только в dev)
   - Добавить health check endpoint, который проверяет подключение к базе

4. **Документация**:
   - Создать скрипт для проверки переменных окружения
   - Добавить в CI/CD проверку переменных перед деплоем

## Связанные документы

- `docs/forensics/current-mileage-mismatch.md` — описание проблемы расхождения пробега
- `docs/architecture/current-mileage-sources.md` — источники данных для текущего пробега
- `docs/DEPLOYMENT_SYNC.md` — инструкции по синхронизации данных

## Дата создания

2026-01-05

## Автор

Forensic analysis for production environment configuration.

