# Documentation / Документация

[English project overview](../README.md) · [Описание проекта на русском](../README.ru.md)

Start with the root README for current capabilities and architecture. The documents below are dated engineering records written during development, mostly in Russian; some describe investigations, proposals or behaviour that was later replaced. Planned fleet functionality is not part of the shipped product.

Начните с корневого README: там описаны текущие возможности и архитектура. Документы ниже — датированные инженерные записи, сделанные по ходу разработки; часть из них описывает исследования, предложения или поведение, которое позже изменилось. Запланированное управление автопарком не входит в выпущенный продукт.

| Topic / Тема | Document / Документ |
| --- | --- |
| Calculation rules: mileage, driving pace, forecasts / Правила расчётов: пробег, темп, прогнозы | [Mileage and forecast / Пробег и прогноз](calculations/mileage-and-forecast-to-be.md) |
| Data ownership: RLS, composite keys, migration tests / Владение данными: RLS, составные ключи, тесты миграций | [Database security, stage 1 / Безопасность БД, этап 1](database-security-stage-1.md) |
| Session security / Безопасность сессий | [Auth security, stage 2 / Безопасность авторизации, этап 2](auth-security-stage-2.md) |
| Release incident and rollback / Инцидент релиза и откат | [Google callback incident, 2026-10-09 / Инцидент Google callback](auth-sync-incident-2026-10-09.md) |
| Mobile session recovery and its release / Восстановление мобильных сессий и релиз | [Recovery, 2026-10-12–13 / Восстановление](mobile-auth-recovery-2026-10-12.md) |
| Dependency and server hardening before publication / Усиление безопасности перед публикацией | [Security hardening, 2026-10-15 / Усиление безопасности](security-hardening-2026-10-15.md) |
| English localization / Английская локализация | [Implementation report / Отчёт о реализации](i18n-implementation-report.md) |
| Public demo boundary and scope / Изоляция и объём демо | [Approved demo scope / Согласованный объём демо](onboarding/03-approved-scope.md) |
| Getting started with own data / Первые шаги со своими данными | [Getting started / Первые шаги](onboarding/08-own-data-getting-started.md) |
| Database setup and test prerequisites / Подготовка БД и запуск проверок | [Supabase notes / Инструкция Supabase](../supabase/README.md) |
| Demo screenshots / Скриншоты демо | [Images and provenance / Изображения и происхождение](images/README.md) |

## Historical reference / Исторические материалы

- [`APP_OVERVIEW.md`](APP_OVERVIEW.md), [`SYSTEM_LOGIC.md`](SYSTEM_LOGIC.md), [`DEPLOYMENT_SYNC.md`](DEPLOYMENT_SYNC.md) and `forensics/` describe earlier implementations and incidents. They are not current setup instructions. / Эти документы и каталог `forensics/` описывают ранние реализации и инциденты; это не текущие инструкции запуска.
- `ui-status-*`, `app-mode-*`, `appmode-*`, timezone and prediction audits preserve design reasoning; some describe proposals or superseded behaviour. / Эти аудиты сохраняют ход проектирования; часть описывает предложения или заменённое поведение.
- [`Fleet Mode (автопарк).md`](Fleet%20Mode%20%28%D0%B0%D0%B2%D1%82%D0%BE%D0%BF%D0%B0%D1%80%D0%BA%29.md) and the documents in `документация для юр лиц/` are specifications of a possible future product, not implemented multi-vehicle functionality. / Это спецификации возможного будущего продукта, а не реализованная поддержка нескольких автомобилей.

Release records are evidence for the stated date, not a guarantee of current uptime. Deployment identifiers in them refer to the author's Vercel project and are not needed to run the code. / Записи о релизах — свидетельства на указанную дату, а не гарантия текущей доступности. Идентификаторы деплоев в них относятся к Vercel-проекту автора и для запуска кода не нужны.
