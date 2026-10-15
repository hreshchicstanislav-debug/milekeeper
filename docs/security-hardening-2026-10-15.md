# MileKeeper — security hardening перед публикацией исходников

Дата: **15 октября 2026 года**. Ветка: `security-hardening` (локально — изолированный
worktree `worktree-security-hardening`).
Основание: `880a3bf` = `codex/mobile-auth-recovery` = `origin/codex/mobile-auth-recovery`
(production source `02ee4d0` + документация релиза).

Отчёт фиксируется одним коммитом вместе с исправлениями. С разрешения владельца в GitHub
отправляется только эта ветка; preview из неё создаёт Vercel Git integration. Merge,
push в `main`, production deployment/promotion, изменения настроек Vercel, Supabase,
OAuth и пользовательских данных **не выполнялись**. Результаты проверки preview в этот
коммит не входят. Исходный рабочий каталог с подготовкой портфолио использовался
только для чтения.

Окружение проверок: macOS, Node.js **24.22.0** (production на Vercel — Node.js 24.x),
npm 11.11.0, Google Chrome через Playwright 1.60.0. Все браузерные и интеграционные
проверки выполнены на **синтетической** локальной фикстуре Supabase
(`scripts/fixtures/i18n-supabase.cjs`, 127.0.0.1) без production credentials;
запросы за пределы localhost в браузерных тестах блокировались.

## Итог

| Показатель | До (`880a3bf`) | После (эта ветка) |
| --- | --- | --- |
| `npm audit --omit=dev` | 7 пакетов: 1 critical, 5 high, 1 moderate | **0** |
| `npm audit` (всё дерево) | 13 пакетов: 3 critical, 7 high, 3 moderate | 5 пакетов, **только dev**: 2 critical, 1 high, 2 moderate |
| Next.js | 16.1.1 — 38 advisory | 16.3.8 — известных advisory нет |
| Dev Server Actions в production-сборке | защищены только оптимизацией сборщика | явный серверный отказ вне `next dev` |
| `/api/keep-alive` без `CRON_SECRET` | `Authorization: Bearer undefined` → **200**, запись admin-клиентом | 401 до обращения к БД |
| Admin client (service role) | только runtime-проверка `window` | build-time граница `server-only` |
| Vitest | 496/496 | 516/516 |
| `tsc --noEmit` (весь проект) | **FAIL**: 14 старых ошибок в тестах | **FAIL**: те же 14, построчно идентичны |
| Проверка типов в `next build` | PASS (тесты исключены) | PASS (тесты исключены, раздел 8.1) |

Зелёная сборка **не означает**, что проект проходит проверку типов: `next build` проверяет
только код приложения без тестов, а полный `npx tsc --noEmit` по-прежнему падает
(список ошибок — в разделе 8.1).

Все три замечания предыдущего аудита подтверждены и исправлены с регрессионными тестами.
Обновление Next.js выявило одно несовместимое изменение сборки (раздел 9), оно учтено.
Оставшиеся уязвимости относятся только к dev-инструменту тестирования (Vitest 1.x) и
к MileKeeper в текущем использовании неприменимы; для них нужно мажорное обновление,
которое по условиям задачи не применялось (результаты пробного обновления — в разделе 6).

**Не проверялись:** настоящий Google OAuth, Safari/WebKit и iOS, установленная PWA,
runtime/CDN Vercel и preview deployment, production-БД Supabase. `CRON_SECRET` задан
в Vercel для Production и Preview — проверено по списку переменных проекта через API,
значения не читались.

## 1. Состояние проекта до изменений

**Git.** Worktree был создан из `origin/main` (`664da09`), то есть **без** production-исправления
мобильной авторизации. История линейная: `664da09` → `02ee4d0` (fix auth) → `880a3bf` (docs).
Worktree переведён на `880a3bf` через `git merge --ff-only` — без переписывания истории.
`main` и `origin/main` остаются на `664da09` и отстают от production, как и было
зафиксировано в `portfolio-review-2026-10-15.md` (этот отчёт пока существует только
в исходном рабочем каталоге, не в Git).

**Версии.** `next` 16.1.1 (production build — Turbopack); `react`/`react-dom` 19.2.3, но App
Router использует React, встроенный в Next (`19.3.0-canary-f93b9fd4-20251217` в 16.1.1);
`@supabase/supabase-js` 2.90.1; `vitest` 1.6.1; `typescript` 5.9.3. Правил для агентов
(`AGENTS.md`, `CLAUDE.md`, `.cursorrules`) в репозитории не было.

**Baseline-проверки на `880a3bf`** (выполнены в этой работе):

| Проверка | Результат |
| --- | --- |
| `npm ci` | PASS |
| `npm test` | PASS, 33 файла, 496 тестов |
| `npx tsc --noEmit --incremental false` | FAIL, 14 ошибок в 5 старых файлах тестов `src/lib/service/__tests__` |
| `next build` (Turbopack) | PASS |
| `npm run lint` | FAIL: `next lint` отсутствует в Next 16 |
| `npm audit` / `--omit=dev` | 13 / 7 уязвимых пакетов (за ними 60 уникальных advisory) |

## 2. Обнаруженные уязвимости

### 2.1. Зависимости

Источники: `npm audit`, GitHub Advisory Database (каждое advisory загружено через
`gh api /advisories/<id>`), перекрёстно — OSV.dev по всем пакетным версиям lockfile
(189 до обновления, 190 после).
OSV подтвердил тот же набор и не нашёл записей о вредоносных пакетах (`MAL-*`).

| Пакет (версия) | Дерево | Путь | Advisory | Исправлено в |
| --- | --- | --- | --- | --- |
| `next` 16.1.1 | prod | прямая | 38: 2 critical, 14 high, 18 moderate, 4 low | 16.3.8 (минимальная версия, закрывающая все) |
| `sharp` 0.34.5 | prod, optional | next | 3 high (libvips, libheif, librsvg) | 0.35.5 |
| `postcss` 8.4.31 (и 8.5.6 у vite) | prod/dev | next, vite | 2 high, 2 moderate | 8.5.23 |
| `nanoid` 3.3.11 | prod | postcss | 3 high | 3.3.18 |
| `source-map-js` 1.2.1 | prod | postcss | 1 high | 1.2.2 |
| `baseline-browser-mapping` 2.9.14 | prod | next | 1 moderate | 2.11.0 |
| `ws` 8.19.0 | prod | supabase realtime-js | 1 high, 1 moderate | 8.21.0 |
| `rollup` 4.55.1 | dev | vite | 1 high | 4.59.0 |
| `tinypool` 0.8.4 | dev | vitest | 2 critical | 2.1.2 (нужен Vitest 4+) |
| `vitest` 1.6.1 | dev | прямая | 1 critical | 3.2.6 / 4.1.0 |
| `vite` 5.4.21 | dev | vitest | 1 high, 2 moderate | 6.4.3+ (нужен Vitest 3+/4+) |
| `esbuild` 0.21.5 | dev | vite | 1 moderate | 0.25.0 (нужен Vite 6+) |
| `vite-node` 1.6.1 | dev | vitest | только через vite | вместе с Vitest |

Advisory для самих `react`, `react-dom`, `@supabase/supabase-js`, `typescript` не найдено
ни в npm audit, ни в OSV. Уязвимости React Server Components (CVE-2026-23864,
CVE-2026-23869, CVE-2026-23870) касаются встроенного в Next React и закрываются
обновлением Next (GHSA-h25m-26qc-wcjf, GHSA-q4gf-8mx6-v5v3, GHSA-8h8q-6873-q5fj).

### 2.2. Серверная безопасность

1. **Dev Server Actions.** `src/lib/actions/devActions.ts` (`'use server'`) экспортирует
   `seedDemoData`, `simulateTrip`, `simulateTripRange`, `resetAndSeedDemoData`, `wipeAllData`.
   Их импортирует `DevToolsPanel`, скрытая в production условием `NODE_ENV`. Проверка
   production-сборок исходного кода:
   - Turbopack (используется по умолчанию и на Vercel): в `server-reference-manifest.json`
     14 действий, dev-действий **нет** — их убирает dead-code elimination;
   - webpack (`next build --webpack`): зарегистрированы **все 5** dev-действий (их ID нет
     в клиентских чанках);
   - на `next start` webpack-сборки прямой `POST /` с `Next-Action: <id wipeAllData>` и
     синтетической сессией **исполнил действие**: фикстура получила
     `GET /auth/v1/user` и `DELETE /rest/v1/service_events` (отклонён только потому,
     что фикстура read-only).

   Вывод: недоступность держалась на поведении сборщика, а не на проверке. RLS и
   `getRlsClientAndUserId()` ограничивают действия данными вызывающего пользователя;
   межпользовательского доступа не обнаружено. Риск: удаление/засорение собственных
   данных при смене сборщика или рефакторинге условия; GHSA-955p-x3mx-jcvp описывает
   раскрытие ID Server Functions как вектор разведки.

2. **Keep Alive.** Проверка `authHeader !== \`Bearer ${process.env.CRON_SECRET}\``
   при незаданной переменной ожидала строку `Bearer undefined`. Новый регрессионный тест
   на исходном коде показал: без `CRON_SECRET` запрос с этим заголовком получает **200**
   и вызывает admin-клиент. Пустой и пробельный секрет на практике не эксплуатировались:
   `Headers` (Fetch) обрезает пробелы по краям значения, и сравнение не совпадало.
   В Vercel `CRON_SECRET` задан для Production и Preview, и ежедневные пинги проходили;
   при заданном секрете обход не работает. Уязвимость проявилась бы при удалении
   переменной, в новом окружении или при локальном запуске без неё.

3. **Admin client.** `createAdminClient()` используется только в `/api/keep-alive`, ключ не
   имеет префикса `NEXT_PUBLIC_`. Защита — runtime-проверка `typeof window`. Негативная
   сборка исходного кода с временным Client Component, импортирующим admin client,
   **завершилась успешно**: ошибка проявилась бы только во время выполнения.

### 2.3. Обнаружено попутно

- Next 16.3 по умолчанию проверяет типы при сборке через `tsc` CLI, включая тесты, —
  `next build` падает на 14 старых ошибках (раздел 9).
- Next 16.3 при `next dev` **под AI-агентом** (определяется через `@vercel/detect-agent`:
  Codex, Claude Code и т. п.) создаёт в корне `AGENTS.md` и `CLAUDE.md` и предлагает их
  коммитить. В ручном запуске из терминала этого не происходит. Созданные при проверке
  файлы удалены; решение — коммитить, игнорировать или удалять — за владельцем.
- `scripts/test-own-data-browser.cjs` нестабилен из-за гонки в самом тесте (раздел 8).
- Предупреждение `middleware` → `proxy` (было и в 16.1.1) и неработающий `next lint`
  сохраняются.

## 3. Какие риски реально применимы к MileKeeper

Конфигурация: Vercel (Linux), App Router, `src/middleware.ts` с matcher, сборка Turbopack,
Server Actions в Node.js runtime, динамический маршрут `/items/[id]`. В `next.config.js`
нет `images`, `rewrites`, `i18n`, `cacheComponents`/PPR; `next/image`, `next/script`,
CSP nonces не используются. Данные читаются только после `auth.getUser(accessToken)`
и через RLS; auth-cookies HttpOnly, Secure, SameSite=Lax; документы отдаются с `no-store`.
Попытки эксплуатации advisory Next.js не выполнялись.

| Категория | Advisory Next.js | Оценка для MileKeeper |
| --- | --- | --- |
| Обход middleware | GHSA-267c-6grr-h53f, GHSA-26hh-7cqf-hhc6 (именно `middleware.ts` + Turbopack), GHSA-492v-c6pp-mqqv (динамические маршруты) | **Применимы по конфигурации.** Последствия ограничены: middleware — только первая проверка; данные защищены серверной проверкой JWT и RLS. Обход дал бы рендер оболочки без данных пользователя. |
| DoS через RSC/Server Actions | GHSA-h25m-26qc-wcjf, GHSA-q4gf-8mx6-v5v3, GHSA-8h8q-6873-q5fj, GHSA-m99w-x7hq-7vfj | **Применимы**: приложение использует Server Functions. Влияние — доступность и стоимость. |
| Раскрытие ID Server Functions | GHSA-955p-x3mx-jcvp | **Применимо** как разведка; вместе с п. 2.2.1 — причина явной блокировки dev-действий. |
| CSRF Server Actions через `Origin: null` | GHSA-mq59-m269-xvcx | Применимо формально; смягчено SameSite=Lax: межсайтовый запрос не несёт auth-cookies. Отдельно не тестировалось. |
| Отравление общего кэша | GHSA-wfc6-r584-vfw7, GHSA-vfv6-92ff-j949, GHSA-3g8h-86w9-wvmq | Низкий риск: страницы и redirect middleware отдаются с `no-store`. |
| Только `next dev` | GHSA-39w2-rjm5-chcv (MCP endpoint), GHSA-jcc7-9wpm-mj36 (требует `allowedDevOrigins`, не настроен) | Касается машины разработчика, не production. |
| Неприменимы по конфигурации/хостингу | GHSA-2xp9-vwfh-vxw4 (AVIF RCE: нет remote images и загрузок, image optimization на Vercel выполняет платформа), GHSA-p293-qw3h-jr36 (Windows), GHSA-6gpp-xcg3-4w24 и GHSA-36qx-fr4f-26g5 (i18n в next.config / Pages Router), GHSA-89xv-2m56-2m9x (custom server), GHSA-p9j2-gv94-2wf4 и GHSA-ggv3-7p47-pfv8 (внешние rewrites), GHSA-c4j6-fc7j-m34r (WebSocket, self-hosted), GHSA-cjq9-62q9-8jv4, GHSA-9g9p-9gw9-jx7f, GHSA-q8wf-6r8g-63ch, GHSA-h64f-5h5j-jqjh, GHSA-3x4c-7xq6-9pq8 (image optimization: remotePatterns/self-hosted), GHSA-mg66-mrh9-m8jx, GHSA-h27x-g6w4-24gq, GHSA-5f7q-jpqc-wp7h (PPR/Cache Components), GHSA-ffhc-5mcf-pf4q (CSP nonce), GHSA-gx5p-jg67-6x7h (`beforeInteractive`), GHSA-68g3-v927-f742 (паттерн `fetch(new Request(), init)` не используется, в т. ч. в `@supabase/*`), GHSA-4633-3j49-mh5q (не-UTF-8 тела), GHSA-4c39-4ccg-62r3 (Edge Server Actions), GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p (Pages SSG/ISR, catch-all), GHSA-f87g-xv8r-7p7x (динамические metadata image routes) | Не применимы. Закрыты обновлением попутно. |

Транзитивные production-зависимости: `sharp` (используется только self-hosted image
optimization, а приложение не оптимизирует изображения пользователя), `postcss`/`nanoid`/
`source-map-js`/`baseline-browser-mapping` (сборка собственного CSS проекта),
`ws` (Realtime в MileKeeper не используется). Реальная эксплуатация требует входных
данных атакующего, которых в этих путях нет; обновлены ради чистого дерева.

## 4. Что исправлено и каким способом

1. **Dev Server Actions** — `src/lib/actions/devActions.ts`: функция
   `assertDevActionsEnabled()` бросает ошибку при `NODE_ENV !== 'development'` и вызывается
   первой строкой каждого экспортируемого действия — до чтения cookies и обращения к БД.
   Разрешение только для `development` (а не «запрет для production») выбрано как
   deny-by-default. Проверки:
   - webpack-сборка исправленного кода: прямой POST на каждое из 5 действий → отказ,
     **0 запросов** к фикстуре; клиент получает только digest без текста ошибки;
   - Turbopack 16.3.8: dev-действий в манифесте по-прежнему нет;
   - `next dev`: DevToolsPanel работает — «Очистить все данные» доходит до
     `DELETE /rest/v1/service_events` синтетической фикстуры.

2. **Keep Alive** — `src/app/api/keep-alive/route.ts`: пустой, пробельный или
   отсутствующий `CRON_SECRET` → 401 и серверная запись
   `[keep-alive] CRON_SECRET is not configured; refusing request` (без значений).
   Сравнение заголовка — `timingSafeEqual` по SHA-256 обеих строк (без раннего выхода и
   утечки длины; это усиление, а не исправление подтверждённой атаки). Формат заголовка,
   admin-клиент, insert, очистка записей старше 30 дней и расписание `vercel.json`
   (`0 12 * * *`) не изменены. На `next start`: без секрета `Bearer undefined` и запрос без
   заголовка → 401 без обращений к БД; с синтетическим секретом неверный заголовок → 401,
   верный → 200 и прежние `POST` + `DELETE keep_alive_pings` (5/5).

3. **Admin client** — `src/lib/supabase/adminClient.ts`: `import 'server-only'` первой
   инструкцией; runtime-проверка `window` сохранена. Next 16 обрабатывает этот импорт сам,
   отдельный npm-пакет по документации необязателен и не добавлялся. Негативная сборка:
   временный Client Component с импортом admin client → `next build` падает с
   `'server-only' cannot be imported from a Client Component module`; временные файлы
   удалены. В публичных клиентских чанках финальной сборки нет упоминаний service role,
   `createAdminClient` и `CRON_SECRET`; единственный серверный чанк со ссылкой на ключ
   принадлежит `/api/keep-alive`.

4. **Регрессионные тесты** (20 новых):
   - `src/lib/actions/__tests__/devActions.test.ts` — 11 тестов: отказ всех действий при
     `production` и `test` без обращения к клиенту БД; проход в `development`;
   - `src/app/api/keep-alive/__tests__/route.test.ts` — +8 тестов: близкие к верному
     заголовки и отсутствующий/пустой/пробельный секрет;
   - `src/lib/supabase/__tests__/adminClient.test.ts` — 1 тест на наличие `server-only`
     (Vitest не умеет проверять границу react-server, её проверяет `next build`).

   Контроль: на исходных версиях трёх файлов **10 из 20** новых тестов падают
   (5 + 1 dev-действий, 3 keep-alive, 1 admin client), на исправленных — проходят все.

5. **Совместимость сборки** — `next.config.js`: `experimental.useTypeScriptCli: false`
   возвращает проверку типов при `next build` через TypeScript API, как в 16.1.1 (раздел 9).
   Диагностика тестовых файлов при этом отбрасывается, 14 ошибок остаются (раздел 8.1).

## 5. Какие зависимости обновлены

Метод: без `npm audit fix --force`, без мажорных обновлений и без `overrides`.
Прямая зависимость — `npm install next@16.3.8`; транзитивные — `npm update` в пределах
уже объявленных диапазонов. Для снижения supply-chain-риска применён **карантин свежих
релизов** через `--before`: не моложе 7 дней (`2026-10-08`). Для `ws` и `rollup`
выбрана минимальная исправленная линия с последним патчем в ней. Все записи lockfile
разрешаются в `registry.npmjs.org` и имеют `integrity`; `npm ci` с нуля проходит.

| Пакет | Было | Стало | Дерево | Дата релиза | Как |
| --- | --- | --- | --- | --- | --- |
| `next` (+ `@next/env`, 8× `@next/swc-*`) | 16.1.1 | **16.3.8** | prod | 2026-09-30 | прямая, `^16.3.8` |
| `@swc/helpers` | 0.5.15 | 0.5.23 | prod | — | закреплена в next 16.3.8 |
| `postcss` | 8.4.31 (+ 8.5.6 у vite) | 8.5.23 (одна копия) | prod/dev | — | закреплена в next 16.3.8 |
| `sharp` (+ `@img/sharp-*`, `@img/sharp-libvips-*` 1.3.4, `@img/colour`, `@emnapi/runtime`, `semver`) | 0.34.5 | 0.35.5 | prod, optional | 2026-09-27 | `^0.35.4` из next |
| `nanoid` | 3.3.11 | 3.3.20 | prod | 2026-10-05 | транзитивная |
| `source-map-js` | 1.2.1 | 1.2.2 | prod | 2026-09-30 | `npm update` |
| `baseline-browser-mapping` | 2.9.14 | 2.11.27 | prod | 2026-10-01 | транзитивная |
| `ws` | 8.19.0 | 8.21.3 | prod | 2026-08-07 | `npm update`, линия 8.21.x |
| `rollup` (+ 25 платформенных пакетов) | 4.55.1 | 4.59.1 | dev | 2026-03-21 | `npm update`, линия 4.59.x |

Итог lockfile: 70 изменённых записей, 2 добавленные (опциональные `@img/sharp-freebsd-wasm32`
и `@img/sharp-webcontainers-wasm32` из sharp 0.35.5), 1 удалённая (дубль postcss у vite).
`rollup` 4.64.x отклонён: он добавляет нативную optional-зависимость
`@napi-rs/lzma-linux-x64-gnu` (это задокументированное мейнтейнерами изменение, но оно
расширяет набор бинарников на Linux-сборке ради неприменимой dev-уязвимости).

Сознательно **не обновлялись**: `@supabase/supabase-js` (advisory нет; auth-js определяет
логику восстановления сессий и требует отдельной приёмки), `react`/`react-dom` (advisory
нет; App Router использует React из Next), `typescript`, `@types/*`, `vitest` (мажорное).

## 6. Какие уязвимости остались и почему

```text
$ npm audit --omit=dev
found 0 vulnerabilities

$ npm audit
esbuild  <=0.24.2      moderate  (через vite)
vite     <=6.4.2       high      (через vitest)
vite-node <=2.2.0-beta.2 moderate (через vitest)
vitest   <=4.0.0-beta.19 critical
tinypool <=2.1.1       critical  (через vitest)
5 vulnerabilities (2 moderate, 1 high, 2 critical)
fix available via `npm audit fix --force` → vitest@5.0.4 (breaking change)
```

OSV.dev для финального lockfile: те же `esbuild`, `tinypool`, `vite`, `vitest`.

| Advisory | Условие эксплуатации | MileKeeper |
| --- | --- | --- |
| GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr (`tinypool`) | Предварительное загрязнение `Object.prototype` в процессе тестов | Тесты исполняют только код проекта; источника загрязнения нет. CI нет. |
| GHSA-5xrq-8626-4rwp (`vitest`) | Открытый в сеть Vitest UI/API или UI/Browser Mode на Windows | `@vitest/ui` не установлен, `--ui`/`--api` не используются, macOS. |
| GHSA-fx2h-pf6j-xcff, GHSA-4w7w-66w2-5vf9, GHSA-v6wh-96g9-6wx3 (`vite`) | Vite dev server, открытый в сеть, и/или Windows | `vitest run` не поднимает такой сервер. |
| GHSA-67mh-4wv8-2f99 (`esbuild`) | Режим `esbuild serve` | Используется только `build` API в `test:demo:hydration`. |

Все пять пакетов — dev-зависимости, не попадают в production-сборку и не исполняются
на Vercel во время работы приложения. Устраняются только мажорным обновлением Vitest.

**Пробное обновление (не применено):** в изолированной копии `vitest@4.1.11`
(с тем же карантином) разрешился Vite 8.3.3 + rolldown; `npm audit` — **0** для обоих
деревьев; **516/516 тестов без изменений кода**. Но:
- Vite 8 больше не приносит `esbuild`, и `npm run test:demo:hydration` падает с
  `Cannot find module 'esbuild'` — нужна явная dev-зависимость `esbuild` (≥ 0.25) или Vite 7;
- Vite 8 предупреждает, что `vitest.config.ts` с ESM-синтаксисом в CommonJS-пакете
  несовместим с будущим загрузчиком конфигурации (решение — `vitest.config.mts`).

Отсутствие находок `npm audit` и OSV не доказывает отсутствие уязвимостей: не покрыты
неопубликованные уязвимости, платформа Vercel, серверная часть Supabase и логика
приложения за пределами проверенных путей.

## 7. Список изменённых файлов

| Файл | Изменение |
| --- | --- |
| `src/lib/actions/devActions.ts` | серверная блокировка dev-действий вне `development` |
| `src/lib/actions/__tests__/devActions.test.ts` | новый, 11 тестов |
| `src/app/api/keep-alive/route.ts` | отказ без секрета, сравнение `timingSafeEqual`, запись о неверной конфигурации |
| `src/app/api/keep-alive/__tests__/route.test.ts` | +8 тестов, восстановление spy после теста |
| `src/lib/supabase/adminClient.ts` | `import 'server-only'` |
| `src/lib/supabase/__tests__/adminClient.test.ts` | новый, 1 тест |
| `next.config.js` | `experimental.useTypeScriptCli: false` с пояснением |
| `package.json` | `next` `^16.1.1` → `^16.3.8` |
| `package-lock.json` | обновления из раздела 5 |
| `next-env.d.ts` | автогенерация `next build` 16.3.8: добавлен `import "./.next/types/root-params.d.ts"` |
| `docs/security-hardening-2026-10-15.md` | этот отчёт |

Не изменялись: middleware, auth-модули, recovery, `/api/auth/*`, RLS-клиент, SQL-миграции,
`vercel.json`, `.gitignore`, `.vercelignore`, README и материалы портфолио.

## 8. Результаты тестов

| Проверка | До (`880a3bf`, Next 16.1.1) | После | Окружение |
| --- | --- | --- | --- |
| `npm ci` с нуля | PASS | PASS | локально |
| `npm test` (Vitest) | 496/496, 33 файла | **516/516**, 35 файлов | unit/integration с моками |
| `npx tsc --noEmit` (весь проект) | **FAIL**, 14 ошибок | **FAIL**, те же 14, построчно идентичны (и со свежими `.next/types`) | — |
| `npm run lint` | FAIL (`next lint` нет в Next 16) | FAIL, без изменений | — |
| `next build` (Turbopack) | PASS | PASS (без опции из п. 4.5 — FAIL) | синтетические env |
| `next build --webpack` | PASS | PASS, предупреждение Next о `process.cwd` в Edge-бандле `next/server` | синтетические env |
| Server Actions в манифесте | Turbopack 14 / webpack 19 (5 dev) | те же; dev-действия отказывают | — |
| Прямой POST на dev-действие (webpack, `next start`) | `wipeAllData` исполнен до `DELETE` | 5/5 отказ, 0 запросов к БД | фикстура |
| DevToolsPanel в `next dev` | — | работает | фикстура |
| `/api/keep-alive` на `next start` | — | 5/5 | фикстура, фиктивные ключи |
| Негативная сборка `server-only` | клиентский импорт собирается | сборка падает | — |
| `test:auth-recovery:browser` (`next start`) | 33/33 по portfolio review, мной не перезапускался | **33/33**, ошибок runtime 0 | фикстура, Chrome, mobile-эмуляция |
| `test:i18n:browser` (`next start`) | 24/24 по portfolio review | **24/24** | фикстура, Chrome |
| `test:demo:hydration` | 20 по portfolio review | **20/20**, React из Next 16.3.8 | Chrome |
| `test:onboarding:browser` (`next start`) | 4/6 в моих прогонах | 2/7 | фикстура, Chrome |
| gitleaks 8.30.1 | — | нет находок: история 58 коммитов (все refs, 3.4 МБ) и файлы ветки (2.3 МБ) | архив сверен с официальным SHA-256 |

**Onboarding-тест нестабилен и до изменений.** Падение в обоих вариантах на одном шаге:
после RU-итерации тест «выходит» через `context.clearCookies()` и `localStorage.clear()`,
пока приложение ещё выполняет штатный `POST /api/auth/sync`. Ответ приходит после
очистки, его `Set-Cookie` восстанавливает `mk_sb_at`/`mk_sb_rt`, SDK заново сохраняет
сессию, и `/en` открывается авторизованным вместо `/en/login`. Механизм подтверждён
журналом запросов на Next 16.1.1 и 16.3.8. В копии теста вне репозитория с
`await page.waitForLoadState('networkidle')` перед выходом — **20/20** на обновлённой
сборке. Это диагностика причины, а не предлагаемое исправление: `networkidle` скрывает
любой фоновой трафик, включая ошибочный. Выборка 4/6 против 2/7 слишком мала, чтобы
утверждать изменение частоты. Один раз (до устранения гонки, в инструментированной
копии) был таймаут на шаге `Record replacement`; причина не установлена, в 20 последующих
прогонах не повторился. Тестовый скрипт в этой ветке не изменялся — план в разделе 8.2.

Пробная сборка `next dev` под агентом временно создавала `AGENTS.md`/`CLAUDE.md`;
они удалены. `git diff --check` проходит.

**Ограничения:** все браузерные проверки — Chromium-движок (Chrome) с мобильной эмуляцией
и синтетическим провайдером. Они не подтверждают настоящий Google OAuth, Safari/iOS,
установленную PWA, поведение Vercel Functions/CDN и production-данные. Временные журналы
проверок хранились вне репозитория и не публикуются.

### 8.1. Проверка типов: что означает зелёная сборка

В Next.js 16.3.8 (`next/dist/server/config-shared.js`) по умолчанию
`experimental.useTypeScriptCli: true`: `next build` запускает
`tsc --project tsconfig.json --noEmit` по всему проекту. При `false` сборка использует
TypeScript API (`next/dist/lib/typescript/runTypeCheck.js`) и **отбрасывает диагностику**
файлов `**/__tests__/**`, `**/__mocks__/**`, `*.test.*` и `*.spec.*` — тем же регулярным
выражением, что и Next 16.1.1. В этом режиме сборка останавливается на первой ошибке в коде
приложения. В `next dev` флаг проверку типов не включает (`shouldRunTypeCheck: false`).

Проверено в изолированной копии ветки, worktree не изменялся:

| Вариант | `next build` | `npx tsc --noEmit` |
| --- | --- | --- |
| флаг `false` + ошибка типа в новом модуле приложения `src/lib/type-probe.ts` | **FAIL**: `Type error: Type 'string' is not assignable to type 'number'` | 15 ошибок |
| флаг `false` + та же ошибка в `src/lib/__tests__/type-probe.test.ts` | PASS, `Finished TypeScript` | 15 ошибок |
| без флага (умолчание 16.3.8), без внесённых ошибок | **FAIL** на 14 ошибках в тестах | 14 ошибок |

Вывод: флаг не отключает проверку кода приложения, но строка `Finished TypeScript`
в журнале `next build` (локально и на Vercel) означает «код приложения без тестов».
Полная проверка проекта **не проходит**:

| Файл в `src/lib/service/__tests__/` | Строки | Ошибка |
| --- | --- | --- |
| `calcServiceStatus.regression.test.ts` | 6, 22 | TS2322: в фикстуре `user_id` необязателен, а в `ServiceItem`/`ServiceEvent` обязателен |
| `calcServiceStatus.test.ts` | 7, 24 | TS2322: то же |
| `compareServiceUrgency.test.ts` | 3 | TS2305: `@/lib/db/types` больше не экспортирует `ServiceStatusResult` |
| `compareServiceUrgency.test.ts` | 7 | TS2322: необязательный `user_id` в фикстуре `ServiceItem` |
| `mileageAndForecastToBe.test.ts` | 8, 19, 81, 117 | TS2741: в фикстурах `OdometerEntry`, `ServiceEvent`, `ServiceItem` нет обязательного `user_id` |
| `odometerForecast.test.ts` | 15 | TS2345: аргумент без `user_id` передан как `OdometerEntry` |
| `odometerForecast.test.ts` | 52, 71, 78 | TS2741: в фикстурах `OdometerEntry` нет `user_id` |

Итого 14 ошибок в 5 файлах: устаревшие тестовые данные и один удалённый тип. В коде
приложения `tsc` ошибок не находит. Скрипта `typecheck` в `package.json` нет; его стоит
добавить вместе с исправлением этих тестов и удалением флага.

### 8.2. План исправления onboarding-теста (в этой ветке не выполнялся)

Цель — убрать гонку самого теста и не скрыть возможные ошибки приложения.

1. **Выходить так же, как пользователь.** Заменить `context.clearCookies()` и
   `localStorage.clear()` в `scripts/test-own-data-browser.cjs` (строка 121) на штатный
   выход: кнопка «Выйти»/«Sign out» в `TopBreadcrumbsBar` → подтверждение. Приложение само
   ставит выход в очередь после незавершённой синхронизации (`BrowserSession.logout()`:
   `logoutBlocked` и общая очередь). Если штатный выход проиграет гонку `/api/auth/sync`,
   тест упадёт и покажет дефект приложения.
2. **Ждать конкретные ответы, а не тишину сети.** До клика подписаться на
   `page.waitForResponse` для `POST /api/auth/logout`, проверить статус 200 и `{ ok: true }`,
   затем `page.waitForURL` на `/login` или `/en/login`. `networkidle` не использовать.
3. **Проверять результат выхода явно:** auth-cookies `mk_sb_at`/`mk_sb_rt` отсутствуют, а
   `page.goto(home(nextLocale))` ведёт на страницу входа. При нарушении тест должен
   сообщать «сессия восстановилась после выхода», а не падать по таймауту кнопки Google.
4. **Отслеживать auth-запросы.** Учитывать `request`/`requestfinished`/`requestfailed`
   для `/api/auth/*`; перед выходом проверить, что все они завершились с ожидаемыми
   статусами, иначе упасть с их перечнем. Любой 5xx — ошибка теста.
5. **Добавить отдельный сценарий гонки:** задержать ответ `POST /api/auth/sync` через
   `page.route`, во время задержки выполнить штатный выход, затем отпустить ответ.
   Ожидание: выход завершён, auth-cookies нет, `/` ведёт на вход.
6. **Диагностировать редкий таймаут `Record replacement`:** Playwright trace с сохранением
   при падении и журнал запросов фикстуры; без воспроизведения ожидания шага не менять.
7. **Критерий приёмки:** 20 прогонов подряд на `next start` без падений и без уменьшения
   числа проверок; контрольный прогон со сломанным выходом (`/api/auth/logout` → 503)
   должен падать с понятным сообщением.

## 9. Возможные breaking changes

- **Проверка типов при сборке (Next 16.3).** `experimental.useTypeScriptCli` теперь `true`
  по умолчанию: `next build` запускает `tsc --project tsconfig.json`, который проверяет
  и `__tests__`/`*.test.*` (Next ≤16.2 исключал их диагностику). Без мер локальная
  `next build` падала на 14 старых ошибках; Vercel выполняет ту же команду. Временно
  возвращён прежний режим (п. 4.5, поведение подтверждено в 8.1); после исправления
  тестовых типов флаг нужно удалить (он экспериментальный и может исчезнуть).
- **Prefetch inlining** (по умолчанию с 16.3.0) и **нативные Node.js streams в SSR** — меняют
  транспорт prefetch и рендеринг. Сценарии Router Cache/prefetch и гидратации, связанные
  с недавними auth-исправлениями, прошли (33/33, 20/20), но только на синтетике.
- **`next dev` под AI-агентом** создаёт `AGENTS.md` и `CLAUDE.md` (см. 2.3).
- **`next-env.d.ts`** получил строку `root-params.d.ts`; файл генерируется Next.
- **Dev-действия** отключены во всех окружениях, кроме `NODE_ENV=development`,
  в том числе в Vitest (`test`): тест, вызывающий их, должен задавать окружение явно.
- **Keep Alive** отклоняет пустой и пробельный секрет; для валидного секрета поведение
  не изменилось.
- `sharp` 0.34 → 0.35, `postcss` 8.4 → 8.5, `ws` 8.19 → 8.21 — semver-совместимые
  обновления; сборка, тесты и браузерные сценарии проходят.

## 10. Риски для существующего production

Production в этой работе не изменялся. При выкате этой ветки:

1. Меняется версия фреймворка (16.1.1 → 16.3.8, две минорные версии). Главная зона
   риска — восстановление сессий, prefetch/Router Cache и Server Actions: синтетические
   проверки проходят, настоящий OAuth и устройства — нет.
2. Keep Alive продолжит работать: `CRON_SECRET` задан в Production (проверено 15.10 по
   списку переменных). Без переменной cron получил бы 401; так было бы и раньше, потому
   что Vercel не отправляет заголовок без секрета.
3. Dev-действия в Turbopack-сборке не регистрировались и раньше, поведение production
   не меняется.
4. Откат — штатный Vercel rollback на текущий production deployment
   `dpl_3914nXp5RTh2MiyCox25ocFN5fEQ` (сборка `02ee4d0`, READY; на него указывает
   `milekeeper.vercel.app` — проверено 15.10).
5. Vercel Git integration: production branch — `main`, автоматические deployments включены.
   Push в `main` запускает production deployment, push другой ветки — preview.
6. **Preview работает с production-данными.** Переменные Supabase, включая
   `SUPABASE_SERVICE_ROLE_KEY`, заданы одной записью для Development, Preview и
   Production, поэтому каждый preview обращается к production-проекту Supabase и
   имеет service role key. Preview-деплои закрыты Vercel Authentication
   (`ssoProtection: all_except_custom_domains`), для fork-веток включена
   `gitForkProtection`. Проверки preview поэтому только читающие.

## 11. Готовность ветки к preview deployment

Технически ветка **готова к preview**: сборка, тесты и синтетические сценарии проходят,
production-дерево без известных advisory. Коммит и push только этой ветки разрешены
владельцем 15.10; preview создаёт Vercel Git integration.

Условия и проверки для preview:
- В Preview scope есть все Supabase-переменные и `CRON_SECRET` (проверено по списку).
  Cron на preview не запускается; без секрета endpoint отказывал бы.
- Preview использует production-проект Supabase (раздел 10, п. 6): никаких записей,
  настоящих refresh-обменов и вызова Keep Alive с секретом.
- Реальный Google-вход на произвольном preview-домене может не пройти из-за redirect
  allowlist (ранее staged OAuth возвращал на production) — это не дефект ветки.
- Smoke на preview: `/` и `/en` без cookies → 307 на `/auth/recover`; RU/EN login и demo → 200;
  `POST /api/auth/recover` без cookies → 401, с чужим Origin → 403;
  `GET /api/keep-alive` без заголовка → 401; manifest RU/EN.
- Ручная приёмка после production promotion, как в `mobile-auth-recovery-2026-10-12.md`:
  Google OAuth, Safari и установленная PWA на iPhone, сохранение черновика, независимость
  сессий устройств, следующий ежедневный Keep Alive.

## 12. Что необходимо сделать перед публичным открытием GitHub

Обязательно:
1. Принять preview этой ветки и после отдельного подтверждения выкатить и принять
   в production по п. 11. Публиковать код лучше **после** выката: сейчас production
   работает на Next 16.1.1 с опубликованными advisory и на исходной версии keep-alive.
2. Синхронизировать `main` с проверенным production-коммитом (fast-forward от `880a3bf`
   поверх этой ветки), учитывая автодеплой `main` на Vercel.
3. Закоммитить подготовленные материалы портфолио из исходного каталога (README RU/EN,
   docs, скриншоты, `.gitignore`/`.vercelignore`, исключение `.vercel/project.json` и
   `tsconfig.tsbuildinfo`) и повторить скан секретов на итоговом коммите.
4. Разделить Preview и Production: убрать `SUPABASE_SERVICE_ROLE_KEY` из Preview
   (admin-клиент нужен только cron-маршруту, а cron на preview не работает) или завести
   отдельный Supabase-проект для preview; сохранить `gitForkProtection` и Vercel
   Authentication для preview — после открытия репозитория pull request из fork станет
   обычным сценарием.
5. Решить судьбу `deploy2` (автоматический `git add .` + push в `main`).

Желательно (отдельный этап качества):
6. Обновить Vitest до 4.1.x с явной dev-зависимостью `esbuild` и `vitest.config.mts` —
   это убирает 2 critical из `npm audit` полного дерева, которые увидит проверяющий.
7. Исправить 14 ошибок типов в тестах и удалить `useTypeScriptCli: false`; заменить
   `next lint` на ESLint CLI.
8. Исправить гонку в `scripts/test-own-data-browser.cjs` по плану из раздела 8.2.
9. Добавить CI (`npm ci`, `npm test`, `next build`, `npm audit --omit=dev`), защиту `main`,
   Dependabot/Renovate с карантином свежих релизов.
10. Рассмотреть security headers (`frame-ancestors`/CSP, `X-Content-Type-Options`,
    `Referrer-Policy`), миграцию `middleware.ts` → `proxy.ts`, лицензию и описание репозитория.

## Готовность к публичному техническому просмотру

Оценка, а не измерение. Кодовая часть безопасности после этой ветки выглядит
профессионально: production-зависимости без известных advisory, подтверждённые
находки исправлены минимально и закреплены тестами, которые падают на старом коде,
отличия применимых рисков от формальных зафиксированы. Публиковать **сегодня** рано:
ветка не выкачена в production, `main` отстаёт от production, материалы портфолио
не в Git, полный `npm audit` показывает 2 critical в dev-инструменте, `tsc` (14 ошибок
в тестах) и lint не зелёные, CI нет. После пунктов 1–5 репозиторий пригоден для walkthrough с
работодателем при честном объяснении оставшихся пунктов (ориентировочно 7/10 против
6/10 в portfolio review); после пунктов 6–9 — около 8/10.

## Выпуск в production — 15 октября 2026

Раздел добавлен после выпуска; выводы выше описывают состояние до него. Ветка выпущена
после отдельного подтверждения владельца по схеме из раздела 11: штатный CLI собрал
production-сборку коммита `8724c011d8c7578952f554727c65ec29d460fcbb` без назначения
домена, затем тот же build продвинут на основной домен.

| Проверка (read-only API Vercel, 16.10.2026) | Результат |
| --- | --- |
| Deployment | `dpl_5GPfj4gZhnT5PLpAmwRCDyPLbk7U`: READY, production, source CLI, сборка 15.10 15:29 UTC |
| `milekeeper.vercel.app` | назначен на этот deployment 15.10 16:06 UTC |
| Rollback | предыдущий production deployment (`02ee4d0`) READY |
| Переменные окружения | `SUPABASE_SERVICE_ROLE_KEY` и `CRON_SECRET` — только Production |

Тем же днём отдельными согласованными шагами выполнены пункт 4 раздела 12 в части ключей
(preview-сборки больше не получают service role key и `CRON_SECRET`; URL и publishable/anon
key проекта Supabase у preview остаются, доступ к данным ограничивает RLS), удаление старых
deployments, собранных с прежними настройками, включая январские сборки до авторизации,
и отзыв automation bypass secret Vercel Deployment Protection.

Публичный smoke 16.10.2026: `/demo`, `/en/demo`, `/login`, `/en/login` и manifest — 200;
`/` и `/en` без сессии — 307 на `/auth/recover`; `/api/keep-alive` без заголовка — 401.
По подтверждению владельца приложение работает на реальном телефоне, а Keep Alive после
выпуска выполнен успешно.

## Источники

- GitHub Advisory Database: `https://github.com/advisories/<GHSA-ID>` (все ID выше)
- [OSV.dev](https://osv.dev/)
- [Next.js 16.2](https://nextjs.org/blog/next-16-2), [Next.js 16.3](https://nextjs.org/blog/next-16-3)
- [useTypeScriptCli](https://nextjs.org/docs/app/api-reference/config/next-config-js/useTypeScriptCli)
- [prefetchInlining](https://nextjs.org/docs/app/api-reference/config/next-config-js/prefetchInlining)
- [Server and Client Components: preventing environment poisoning](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning)
- [gitleaks v8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1)
