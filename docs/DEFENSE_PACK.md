# CinemaRate defense pack - индекс / index

| Файл / File | RU | EN |
| --- | --- | --- |
| docs/DEFENSE.ru.md | полный текст защиты: роль, флоу, решения, абзацы | full defense text in Russian |
| docs/DEFENSE.en.md | то же на английском | full defense text in English |
| docs/DEFENSE.he.md | то же на иврите | full defense text in Hebrew |
| docs/FLOW.ru.md | поднять проект с нуля, все проверки | bring the project up from zero |
| docs/AI_SETUP.ru.md | провайдеры ИИ, ключи, диагностика | AI providers, keys, diagnostics |
| docs/SKILLS.ru.md | строки для CV и формулировки | CV lines and phrasings |
| docs/PITCH.en.md | одностраничный питч | one-page pitch |
| docs/PITCH.he.md | одностраничный питч на иврите | one-page pitch in Hebrew |
| README.md | обзор проекта | project overview |
| DEPLOY.md | процедура деплоя | deploy procedure |

## Демо-скрипт на пять минут / five-minute demo script

1. 0:00-0:30 - открыть https://cinemarate.vercel.app и сказать, зачем это
   нужно: рейтинги из нескольких источников в одной карточке.
   Open the live site and state the problem it solves.
2. 0:30-1:30 - найти фильм, показать собранную карточку и ссылки на источники,
   отметить прогрессивный рендеринг.
   Search a title, show the merged card, mention progressive rendering.
3. 1:30-2:30 - добавить в общий список, открыть панель избранного, объяснить
   серверный merge и почему last-write-wins терял записи.
   Add to the shared list and explain the server-side merge.
4. 2:30-3:30 - открыть панель ИИ, задать тип и годы, показать список идей,
   открыть карточку прямо из списка и добавить её в избранное.
   Use the AI panel, open a card straight from the list, save it.
5. 3:30-4:15 - показать репозиторий: коммиты по одному смыслу, зелёный CI,
   guard против секретов, `infra/` на Terraform.
   Show the repository, the CI run, and infrastructure as code.
6. 4:15-5:00 - назвать следующие шаги и честно разделить сделанное и
   запланированное.
   Name the next steps and separate done from planned.

## Правило: говорить только о том, что есть / claim only what exists

В документации и в рассказе разделено то, что работает сейчас (общий список с
серверным merge, кэш на CDN, таймауты на внешние вызовы, фолбэк ИИ, CI,
Terraform), и то, что в планах (log drain, SLO с алертами, ночной бэкап, rate
limit). На собеседовании второе называется планом, а не результатом - это
проверяемо и вызывает доверие.

Documentation and speech separate what already works (shared list with a
server-side merge, CDN cache, timeouts on external calls, AI fallback, CI,
Terraform) from what is planned (log drain, SLO with alerting, nightly backup,
rate limiting). In an interview the second group is presented as a plan, not
as a result.
