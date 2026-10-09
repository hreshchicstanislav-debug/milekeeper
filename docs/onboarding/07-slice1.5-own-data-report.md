# MileKeeper — Slice 1.5: второе действие приветствия

Дата: 2026-10-09. Ветка: `codex/onboarding-demo`. Перед UX-доработкой сохранён отдельный локальный коммит `43f9ec0` — исправление React #418, browser-регрессия и [отчёт 06](06-hydration-fix-report.md). Незакоммиченные изменения предыдущей задачи проверены и сохранены без сброса; UX в этот коммит не включён.

## Изменение

Под синей кнопкой «Исследовать демо» / “Explore demo” добавлено вторичное действие «Перейти к своим данным» / “Use my own data”. Кнопки расположены вертикально с промежутком 10 px. Вторичное действие — обычный `<a>` в существующем нейтральном стиле `btn-secondary`, с рамкой, без prefetch. Адрес вычисляется чистым `localizedPath('/', locale)`: RU → `/`, EN → `/en`, включая перевод уже открытого окна.

Основная кнопка по-прежнему закрывает окно на демоэкране. Вторичная вызывает тот же обработчик закрытия и сохраняет общий `milekeeper.demo.welcome.v1=seen`, затем выполняет обычный document GET. Прежняя защита направляет гостя на `/login` или `/en/login`; авторизованный посетитель открывает свой существующий аккаунт. Внутри демо нет проверки сессии, auth-sync, sign-out или Supabase/API-запроса. Демоданные не передаются в адресе, storage или запросах аккаунта.

Описания, крестик, Escape, повторное открытие, focus return и scroll lock сохранены. Клавиатурный цикл учитывает новую ссылку: RU → EN → крестик → основная кнопка → вторичное действие → RU; обратный цикл работает. Focus-visible применяется и к ссылке. Диалог сохраняет `max-height: calc(100dvh - 32px)` и внутреннюю прокрутку. На 320×360 обе кнопки достигаются прокруткой; на 390×844 и desktop обе помещаются в окне. RU/EN screenshots визуально проверены.

Согласованный объём обновлён в [03-approved-scope.md](03-approved-scope.md). Фикс AppShell в UX-доработке не менялся. Формулы, Supabase, middleware/auth/OAuth, demo snapshot и другие функции не изменялись; Slice 2 не начат.

## Регрессии

- Unit: два новых RU/EN-сценария проверяют адрес, точную подпись, запись маркера и закрытие/освобождение scroll lock. Существующий тест переключения открытого окна дополнительно проверяет перевод и обновление адреса вторичного действия.
- Browser smoke: добавлены RU/EN × гость/аккаунт. Переход выполняется клавиатурой Enter через новую ссылку, а document GET проверяется отдельно. До выхода нет запросов provider, личных API, POST/server actions; cookies и storage сохраняются. Гость видит прежний Google-вход без вызова provider; аккаунт показывает своё существующее показание 120000 км, auth cookies сохраняют значения, sign-out и REST-записей нет. После возвращения в демо маркер предотвращает автоматический повторный показ.
- Проверки геометрии и screenshots включают вторичное действие на RU/EN, ширины 320/360/390/430/1280 px и низкий экран 320×360. Проверены отсутствие горизонтального overflow/обрезания подписи, достижимость обеих кнопок, прямой и обратный Tab, Escape, крестик, основная кнопка, повторное открытие, shared marker, отказ storage и reduced motion.

## Результаты

- `npm test`: 30 файлов, 424 теста PASS.
- `npm run test:demo:hydration`: 20/20 PASS, RU/EN × 320×360/desktop; исходный SSR DOM сохранён, #418 отсутствует.
- `npx tsc --noEmit --incremental false`: 14 прежних ошибок; полный вывод совпал с baseline до исправления #418, новых ошибок нет.
- Полный dev browser smoke: PASS, включая новое действие и существующие Google mock OAuth, callback, login/logout, личные маршруты и формы.
- Production build с локальным fixture: PASS. `.env.local` не изменялась.
- Полный production browser smoke: PASS, включая RU/EN × гость/аккаунт для новой ссылки, keyboard/storage/геометрию и все прежние сценарии. Ошибок console/pageerror/hydration в демо нет.
- Финальный обычный `npm run build`: PASS; локальная сборка без fixture. `git diff --check`: PASS.

Артефакты этой задачи: `/Users/stanislav/Documents/ChatGPT/MileKeeper/artifacts/onboarding-slice1.5-own-data/`. Логи: `unit.log`, `hydration.log`, `tsc.log`, `dev-browser.log`, `build-fixture.log`, `production-browser.log`, `production-server.log`, `build-final.log`. Сохранены production screenshots RU/EN: `welcome-*-320x360-bottom.png`, `welcome-*-390x844.png`, `welcome-*-1280x900.png`. Playwright передавался через `MILEKEEPER_PLAYWRIGHT_PATH`, использован установленный Chrome. Внешняя сеть в browser smoke блокируется; provider — локальный read-only fixture.

## Ограничения и завершение

Проверки выполнены локально в Chrome; физические iOS/Android и Safari не проверялись. Google OAuth проверен существующим mock-сценарием, настоящий аккаунт/Supabase не использовались. Известная несовместимость `next lint` с Next 16 сохраняется.

Работа завершается вторым локальным UX-коммитом. Deployment, promotion, push и merge не выполнялись; production не изменён.
