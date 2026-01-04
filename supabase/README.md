# Supabase Local Development

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

