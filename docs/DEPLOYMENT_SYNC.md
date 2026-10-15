> **Исторический документ / Historical reference.** Описывает раннюю версию или диагностику, а не текущее состояние. Актуальные возможности, авторизация, окружение и запуск: [README на русском](../README.ru.md) · [English README](../README.md).
> Describes an earlier implementation or investigation, not the current application. Use the linked README for current features, authentication, environment and setup.

# Синхронизация данных между локальной и продакшн версиями

## Проблема

Данные на `http://localhost:3000` и `https://milekeeper.vercel.app` различаются, потому что они используют разные базы данных Supabase или неправильно настроенные переменные окружения.

## Решение

### Шаг 1: Проверка переменных окружения на Vercel

Убедитесь, что на Vercel настроены те же переменные окружения, что и локально:

1. Откройте [Vercel Dashboard](https://vercel.com/dashboard)
2. Выберите проект `milekeeper`
3. Перейдите в **Settings** → **Environment Variables**
4. Проверьте наличие следующих переменных:

**Обязательные переменные:**
- `NEXT_PUBLIC_SUPABASE_URL` - URL вашего Supabase проекта
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Anon key из Supabase
- `SUPABASE_URL` - тот же URL (для server-side)
- `SUPABASE_ANON_KEY` - тот же Anon key (для server-side)
- `SUPABASE_SERVICE_ROLE_KEY` - Service Role Key из Supabase

**Важно:** Все переменные должны указывать на **один и тот же проект Supabase**.

### Шаг 2: Получение значений из Supabase

1. Откройте [Supabase Dashboard](https://supabase.com/dashboard)
2. Выберите проект (project-ref: `nsmdouxbxajiyjqxgqml`)
3. Перейдите в **Settings** → **API**
4. Скопируйте:
   - **Project URL** → это `NEXT_PUBLIC_SUPABASE_URL` и `SUPABASE_URL`
   - **anon public** key → это `NEXT_PUBLIC_SUPABASE_ANON_KEY` и `SUPABASE_ANON_KEY`
   - **service_role** key → это `SUPABASE_SERVICE_ROLE_KEY`

### Шаг 3: Настройка переменных на Vercel

1. В Vercel Dashboard → **Settings** → **Environment Variables**
2. Добавьте/обновите каждую переменную:
   - Выберите окружения: **Production**, **Preview**, **Development**
   - Вставьте значение из Supabase
   - Сохраните

### Шаг 4: Проверка локальных переменных

Убедитесь, что локально в `.env.local` указаны те же значения:

```bash
# Проверьте файл .env.local (не коммитится в git)
cat .env.local
```

Должны быть те же значения, что и на Vercel.

### Шаг 5: Деплой на Vercel

После обновления переменных окружения:

1. **Вариант A (автоматический):** Если проект подключен к GitHub, просто сделайте push:
   ```bash
   git push origin main
   ```
   Vercel автоматически задеплоит изменения.

2. **Вариант B (ручной):** Если нужно пересобрать без изменений кода:
   - В Vercel Dashboard → **Deployments**
   - Найдите последний деплой
   - Нажмите **Redeploy** (три точки → Redeploy)

### Шаг 6: Проверка синхронизации

После деплоя:

1. Откройте `https://milekeeper.vercel.app`
2. Проверьте текущий пробег — должен совпадать с локальной версией
3. Проверьте элементы обслуживания — данные должны совпадать
4. Если данные всё ещё различаются:
   - Очистите кэш браузера (Ctrl+Shift+R или Cmd+Shift+R)
   - Или откройте в режиме инкогнито

## Важные замечания

1. **Одна база данных:** Локально и на Vercel должны использовать **один и тот же проект Supabase**
2. **Переменные окружения:** Все переменные должны быть одинаковыми
3. **Кэш:** После изменения переменных может потребоваться пересборка проекта на Vercel
4. **Время синхронизации:** Изменения в базе данных видны сразу, но кэш Next.js может задерживать обновления на несколько секунд

## Проверка подключения

Чтобы проверить, что Vercel использует правильную базу данных:

1. Добавьте пробег локально на `http://localhost:3000`
2. Подождите несколько секунд
3. Проверьте на `https://milekeeper.vercel.app` — пробег должен обновиться
4. Если не обновился — проблема в переменных окружения на Vercel

## Troubleshooting

**Данные всё ещё различаются:**
- Проверьте, что все переменные окружения на Vercel установлены для всех окружений (Production, Preview, Development)
- Убедитесь, что используется один и тот же project-ref Supabase
- Сделайте Redeploy на Vercel после изменения переменных
- Очистите кэш браузера

**Ошибки при деплое:**
- Проверьте, что все обязательные переменные окружения установлены
- Проверьте формат значений (без лишних пробелов, кавычек)
- Посмотрите логи деплоя в Vercel Dashboard

