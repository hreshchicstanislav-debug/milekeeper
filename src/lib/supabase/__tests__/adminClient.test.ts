import { expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Vitest cannot evaluate the react-server boundary itself; `next build` does.
// This keeps the marker from being dropped silently in a refactor.
it('keeps the service-role client behind the build-time server-only boundary', () => {
  const source = fs.readFileSync(path.resolve('src/lib/supabase/adminClient.ts'), 'utf8');
  expect(source).toMatch(/^import 'server-only';$/m);
});
