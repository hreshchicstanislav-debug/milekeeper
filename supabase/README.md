# Supabase database / База данных Supabase

[English overview](../README.md) · [Описание на русском](../README.ru.md) · [Documentation / Документация](../docs/README.md)

## Current project notes / Текущие сведения о проекте

The repository contains ordered SQL migrations and isolated database security tests. No Edge Functions or `seed.sql` are shipped. The public demo does not need a database. / В репозитории есть упорядоченные SQL-миграции и изолированные проверки безопасности БД. Edge Functions и `seed.sql` отсутствуют. Публичному демо БД не нужна.

From the application root, with PostgreSQL binaries (`initdb`, `pg_ctl`, `psql`) available: / Из корня приложения, при наличии бинарных файлов PostgreSQL:

```bash
npm run test:db-security
# If needed / При необходимости:
PG_BIN=/path/to/postgresql/bin npm run test:db-security
```

The runner creates and removes its own temporary cluster, uses a private Unix socket, applies all migrations and exercises access control and migration rollback with fictional data. It never connects to Supabase. The test bootstrap emulates Auth roles only for these tests. / Скрипт создаёт и удаляет собственный временный кластер, использует отдельный Unix-сокет, применяет все миграции, проверяет контроль доступа и откат миграции с вымышленными данными. Он не соединяется с Supabase. Тестовый bootstrap имитирует роли Auth только для этих проверок.

For real sign-in and persistence, prepare your own development Supabase project with Google Auth and apply `migrations/*.sql` in filename order. Auth roles and schema must already exist. Use an empty application schema: migrations add non-null `user_id` without assigning owners to existing data. Existing records require a reviewed backfill plan. / Для настоящего входа и сохранения данных нужен собственный development-проект Supabase с Google Auth и миграциями `migrations/*.sql`, применёнными по порядку имён. Схема и роли Auth уже должны существовать. Начинайте с пустой схемы приложения: миграции добавляют обязательный `user_id`, но не назначают владельцев существующим данным. Для них требуется проверенный план backfill.

Use that project's URL and publishable/legacy anon key in `.env.local`. Set the Supabase Site URL to `http://localhost:3001` and allow application callback `http://localhost:3001/auth/callback`. Google provider credentials stay in Supabase; use its supplied provider callback URL in Google configuration. / Укажите URL и publishable/прежний anon key своего проекта в `.env.local`. Задайте Supabase Site URL `http://localhost:3001` и разрешите callback приложения `http://localhost:3001/auth/callback`. Credentials Google provider хранятся в Supabase; для Google используйте выданный Supabase callback URL провайдера.

The bundled CLI config is not a verified one-command setup: it references missing `seed.sql` and old auth URLs on port 3000. `npm run supabase:link` asks which of your own projects to link; it no longer targets a fixed hosted project. Review these settings before using the CLI with your development project, and do not push this local config to a hosted project. No remote push/reset/deploy is needed for the demo. / Приложенная CLI-конфигурация не является проверенным запуском одной командой: в ней указан отсутствующий `seed.sql` и старые auth URL на порту 3000. `npm run supabase:link` предлагает выбрать один из ваших проектов и больше не указывает на фиксированный облачный проект. Перед работой с CLI проверьте настройки для своего development-проекта и не отправляйте эту локальную конфигурацию в облачный проект. Для демо не нужны удалённые push/reset/deploy.

## Historical generic CLI reference / Историческая общая справка CLI

The remaining text predates this audit and includes examples, not verified project setup commands. The Edge Function and seed examples are not implemented project features. / Оставшаяся справка предшествует этому аудиту и содержит примеры, а не проверенные команды запуска проекта. Примеры Edge Functions и seed не являются реализованными возможностями проекта.

This directory contains the Supabase configuration, migrations, and edge functions for local development.

## Structure

```
supabase/
├── config.toml          # Supabase configuration
├── migrations/          # Database migration files (SQL)
├── functions/           # Edge functions (Deno)
└── seed.sql            # Seed data (optional)
```

## Migrations

Database migrations are versioned SQL files that define your database schema.

### Creating a Migration

```bash
supabase migration new migration_name
```

This creates a timestamped file in `migrations/` like:
- `20240101120000_migration_name.sql`

### Writing Migrations

Edit the generated SQL file to define your schema:

```sql
-- Example: Create a table
CREATE TABLE odometer_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date TIMESTAMPTZ NOT NULL,
  mileage_km INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes
CREATE INDEX idx_odometer_entries_date ON odometer_entries(date);
```

### Applying Migrations

**Local (with `supabase start`):**
```bash
supabase db reset  # Resets and applies all migrations
```

**Remote:**
```bash
supabase db push  # Pushes migrations to remote project
```

### Best Practices

- ✅ One logical change per migration
- ✅ Use descriptive migration names
- ✅ Test migrations locally before pushing
- ✅ Never edit existing migration files (create new ones)
- ✅ Include both `up` and `down` operations if needed

## Edge Functions

Edge functions are serverless functions that run on Supabase's edge network.

### Creating a Function

```bash
supabase functions new function_name
```

This creates a directory in `functions/function_name/` with:
- `index.ts` - Function entry point

### Writing Functions

Functions use Deno runtime. Example:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  )

  const { data, error } = await supabase
    .from('table_name')
    .select('*')

  return new Response(
    JSON.stringify({ data, error }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})
```

### Testing Functions Locally

Start local Supabase first:
```bash
supabase start
```

Then serve functions:
```bash
supabase functions serve function_name
# or serve all functions
supabase functions serve
```

### Deploying Functions

```bash
supabase functions deploy function_name
# or deploy all
supabase functions deploy
```

## Local Development

### Start Local Supabase

```bash
supabase start
```

This starts:
- Postgres database (port 54322)
- Supabase Studio (http://localhost:54323)
- API server (port 54321)
- Auth, Storage, Realtime services

### Stop Local Supabase

```bash
supabase stop
```

### View Logs

```bash
supabase logs
```

## Configuration

Edit `config.toml` to customize:
- Database ports
- API settings
- Auth providers
- Storage limits
- And more...

See [Supabase CLI Config Docs](https://supabase.com/docs/guides/local-development/cli/config) for details.

## Linking to Remote Project

Link your local setup to a remote Supabase project:

```bash
supabase link --project-ref your-project-ref
```

Find your project ref in the Supabase dashboard URL.

## Type Generation

Generate TypeScript types from your database:

```bash
supabase gen types typescript --local > src/types/database.types.ts
```

Or from remote:

```bash
supabase gen types typescript --linked > src/types/database.types.ts
```

## Important Notes

- ⚠️ Never commit `.env` files or secrets
- ⚠️ Migration files are versioned - don't edit existing ones
- ⚠️ Test migrations locally before pushing to production
- ✅ Use descriptive names for migrations and functions
- ✅ Keep migrations small and focused

## Resources

- [Supabase CLI Docs](https://supabase.com/docs/reference/cli)
- [Database Migrations Guide](https://supabase.com/docs/guides/database/migrations)
- [Edge Functions Guide](https://supabase.com/docs/guides/functions)
- [Local Development Guide](https://supabase.com/docs/guides/local-development)

