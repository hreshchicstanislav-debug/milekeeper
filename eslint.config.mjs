import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Browser regression scripts and their fixtures are Node.js CommonJS by design.
    // AppMode/AppNow are shared by server and client code and load the cookie bridge
    // (and next/headers) lazily with require() to keep it out of client bundles.
    files: ['**/*.cjs', 'src/lib/appCookieBridge.ts', 'src/lib/appMode.ts', 'src/lib/appNow.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // eslint-plugin-react-hooks 7 ships React Compiler rules. The app does not use the
    // compiler, so existing findings stay visible as warnings instead of forcing
    // behaviour-changing refactors of working components.
    files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/set-state-in-render': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/error-boundaries': 'warn',
    },
  },
  {
    // DevToolsPanel returns before its hooks when NODE_ENV is 'production'. NODE_ENV is a
    // build-time constant, so hook order never changes within a build, and this early
    // return is what lets the bundler drop the panel and its dev Server Actions from
    // production builds (moving the hooks into a child component re-registers them).
    files: ['src/app/components/DevToolsPanel.tsx'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
  {
    // Legacy `any` types are tracked as warnings until they are replaced.
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);
