/** Browser regression for a Flight-like lazy child resolving during hydration.
 * Uses the project's AppShell and Next's bundled React; no app server or account.
 * Playwright is supplied the same way as test-i18n-browser.cjs.
 */
const { build } = require('esbuild'); // Already installed by Vitest.
const { chromium } = require(process.env.MILEKEEPER_PLAYWRIGHT_PATH || 'playwright');
const { mkdtempSync, writeFileSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const temporary = mkdtempSync(path.join(tmpdir(), 'milekeeper-hydration-'));
const fixture = `
import React, { lazy, useEffect } from 'react';
import AppShell from ${JSON.stringify(path.join(root, 'src/app/components/AppShell.tsx'))};
function Content() {
  useEffect(() => { window.committed = true; }, []);
  return <section id="page-content"><input defaultValue="preserved" /></section>;
}
const content = <Content />;
export function serverTree() { return <AppShell>{content}</AppShell>; }
export function clientTree() {
  // Flight chunks have status/value and can resolve in the yield before replay.
  // Keep this as a lazy NODE in children, not a <LazyComponent />.
  const child = lazy(() => {
    window.lazyStarted = true;
    const chunk = { status: 'pending', then(resolve) {
      queueMicrotask(() => {
        chunk.status = 'fulfilled'; chunk.value = { default: content };
        resolve(chunk.value);
      });
    }};
    return chunk;
  });
  return <AppShell>{child}</AppShell>;
}
`;
// Only unrelated private chrome and routing are mocked. AppShell is real.
const mocks = {
  'next/navigation': `export const usePathname = () => globalThis.location?.pathname || '/demo';`,
  './AuthGate': 'export default function AuthGate() { return null; }',
  './ScrollLockRouteGuard': 'export default function Guard() { return null; }',
  './BottomNav': 'export default function Nav() { return null; }',
  './TopBreadcrumbsBar': 'export default function Breadcrumbs() { return null; }',
  './LanguageSwitcher': `import React from 'react'; export default function Switch() { return <div className="language-switcher"><button>RU</button><button>EN</button></div>; }`,
};
const options = {
  bundle: true, write: false, jsx: 'automatic', absWorkingDir: root,
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: {
    '@': path.join(root, 'src'),
    'react': path.join(root, 'node_modules/next/dist/compiled/react'),
    'react-dom': path.join(root, 'node_modules/next/dist/compiled/react-dom'),
  },
  plugins: [{ name: 'fixture', setup(b) {
    b.onResolve({ filter: /^fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'jsx', resolveDir: root }));
    b.onResolve({ filter: /^(next\/navigation|\.\/(AuthGate|ScrollLockRouteGuard|BottomNav|TopBreadcrumbsBar|LanguageSwitcher))$/ }, args => ({ path: args.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'jsx', resolveDir: root }));
  }}],
};
let browser, server;
(async () => {
  const ssr = await build({ ...options, platform: 'node', format: 'cjs', stdin: {
    contents: `import { renderToString } from 'react-dom/server'; import { serverTree } from 'fixture'; module.exports = renderToString(serverTree());`, resolveDir: root,
  }});
  const filename = path.join(temporary, 'server.cjs');
  writeFileSync(filename, ssr.outputFiles[0].text);
  const html = require(filename);
  const client = await build({ ...options, platform: 'browser', format: 'iife', stdin: {
    contents: `import { hydrateRoot } from 'react-dom/client'; import { startTransition } from 'react'; import { clientTree } from 'fixture';
      window.errors = []; window.originalMain = document.querySelector('main');
      startTransition(() => hydrateRoot(document.getElementById('root'), clientTree(), { onRecoverableError: e => window.errors.push(e.message) }));`, resolveDir: root,
  }});
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/client.js' ? 'application/javascript' : 'text/html');
    res.end(req.url === '/client.js' ? client.outputFiles[0].text : `<!doctype html><div id="root">${html}</div><script src="/client.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ ...(process.env.MILEKEEPER_CHROME_PATH ? { executablePath: process.env.MILEKEEPER_CHROME_PATH } : { channel: 'chrome' }), headless: true });
  const results = [];
  for (const viewport of [{width:320,height:360}, {width:1280,height:900}]) {
    const page = await browser.newPage({ viewport });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    for (const route of ['/demo', '/en/demo']) for (let run=0; run<5; run++) {
      await page.goto(`http://127.0.0.1:${server.address().port}${route}`);
      await page.waitForFunction(() => window.committed);
      results.push({ route, viewport, ...await page.evaluate(() => ({
        errors: window.errors, preserved: window.originalMain === document.querySelector('main'),
        content: !!document.getElementById('page-content'), lazyStarted: window.lazyStarted,
      })) });
    }
    await page.close();
    assert.deepEqual(pageErrors, []);
  }
  console.log(JSON.stringify(results, null, 2));
  assert(results.every(r => r.errors.length === 0 && r.preserved && r.content && r.lazyStarted), 'Hydration must preserve the server DOM when an RSC child resolves during replay');
  console.log('PASS 20 lazy-child hydrations: RU/EN, desktop/320x360, SSR DOM preserved');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve());
  rmSync(temporary, { recursive: true, force: true });
});
