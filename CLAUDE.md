# Falcon Time

Учёт времени команды в ChatGPT. Кабинет, API, расширение Chrome/Edge, два рантайма: Sites/Cloudflare и VPS (`falconai.time`).

Правила боевого сервера `.14` — в подключаемом файле, не дублировать и не ослаблять:

@source/AGENTS.md

Код и команды — из `source/`. `runtime/`, `dist/`, `.next/`, `.wrangler/` — артефакты сборки, их не править.

## Команды

Node `>=22.13`, пакетный менеджер `pnpm@11.25.0`. Lockfile не переписывать вручную.

```sh
cd source
pnpm install --frozen-lockfile
pnpm test                 # node:test, tests/*.test.mjs
pnpm typecheck
pnpm lint
pnpm check                # scripts/check-release.mjs
pnpm dev                  # Sites/Vite
pnpm run build:vps        # Next standalone для VPS
pnpm extension:package    # ZIP из public/extension
```

Узкий прогон важнее полного, пока изменение в одном модуле:

```sh
node --no-warnings --experimental-loader ./tests/loader.mjs --test tests/time.test.mjs
```

Тесты импортируют `.ts` через `tests/loader.mjs`. Это не Jest и не Vitest.

## Куда класть правку

| Поведение | Файл | Тест |
| --- | --- | --- |
| Сессии, простой 30 мин, границы NY/DST | `lib/time.ts` | `tests/time.test.mjs` |
| Приём событий, seq, карантин | `lib/ingest.ts`, `lib/tracking.ts` | `tests/api.test.mjs` |
| USDT, ставка, лимит проекта, выплата | `lib/pay.ts` | `tests/pay.test.mjs` |
| Норма дня, выходной, ссылка на результат | `lib/team-plan.ts` | `tests/team-plan.test.mjs` |
| Вход, OTP, роли owner/admin/member | `lib/auth.ts`, `app/chatgpt-auth.ts` | `tests/api.test.mjs` |
| Схема | `db/schema.ts`, новая миграция в `drizzle/` | `tests/migrations.test.mjs` |
| VPS SQLite/бэкапы | `server/` | `tests/vps-storage.test.mjs` |
| Расширение | `public/extension/` | `tests/extension.test.mjs` |
| Кабинет | `app/time-app.tsx`, `components/` | руками по затронутому экрану |

Миграции `0000`…`0006` уже в журнале `drizzle/meta/_journal.json`. Применённый SQL и снапшоты не переписывать. Новая миграция — только `pnpm db:generate` после правки `db/schema.ts`.

## Инварианты

- Событие — факт активности (`kind`, время, проект, устройство). Текст чата, клавиши и файлы не писать и не логировать.
- Простой `IDLE` = 30 минут и входит в закрытую сессию. Открытая сессия не начисляет будущее. Смена проекта закрывает интервал без хвоста. `stop` действует на все устройства до `resume`.
- Отчёт команды режется по `America/New_York`, включая DST (23/25-часовые сутки). «Сегодня» сотрудника — пояс из анкеты, по умолчанию норма 6 часов.
- Часы двух устройств одного человека не суммируются дважды. Поздняя доставка и повтор `seq` не увеличивают итог. Плохое событие не отбрасывает соседние.
- Коррекция и аудит пишутся одним batch. Сбой аудита откатывает интервал.
- Смена личного кода поднимает `authVersion` и отзывает OTP, сессии и устройства. Записи времени остаются.
- Выплата — снимок часов и суммы за период. Тот же период второй раз не готовится. Кабинет хранит хеш транзакции, не ключ и не seed. Кошелёк Trust Wallet живёт в Falcon Messenger, не здесь.
- Sites принимает платформенную аутентификацию через доверенный шлюз. На VPS заголовки `oai-authenticated-user-*` не доверять.
- Почта — Resend, только если заданы `RESEND_API_KEY` и `MAIL_FROM`. Тесты почту не отправляют.
- Origin кабинета в `public/extension/background.js`, `manifest.json` и инструкции совпадает с реальным HTTPS. После смены — пересобрать ZIP.

## Как вести задачу

1. Прочитать модуль-владелец инварианта и его тест. Не чинить время в UI, если формула в `lib/time.ts`.
2. Менять минимальный набор файлов. Общие компоненты `components/ui/` не трогать ради одной кнопки кабинета.
3. Прогнать тест из таблицы. Если задеты схема, авторизация или выплата вместе со временем — ещё `pnpm test`.
4. В ответе писать, какая команда запускалась и чем она кончилась. Неотмеченный прогон не называть успешным.
5. Секреты, личные коды, хеши кодов и содержимое бэкапов в коммит, лог и ответ не класть.

Сервер `.14`, чужие каталоги `/opt/*`, nginx и docker на нём не трогать. Root там нет: см. `@source/AGENTS.md`.
