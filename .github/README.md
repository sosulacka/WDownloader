# GitHub Actions

`Windows build and release` собирает приложение для Windows x64 на push в
`main`, pull request и при ручном запуске из вкладки Actions. Тесты не запускаются.

В артефакте `windows-x64` находятся лёгкий установщик, portable-архив,
исходники соответствующего коммита и `SHA256SUMS.txt`. Артефакты хранятся 14 дней.
Внешние инструменты в эти сборки не включаются; приложение установит их при запуске.

## Релиз

Обновите версии в `package.json`, `package-lock.json`, обоих `Cargo.toml` и
обоих `tauri.conf.json`, затем отправьте коммит в `main`.
Тег должен совпадать с версией, например:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

После успешной сборки workflow публикует GitHub Release с файлами и описанием
изменений. Теги с суффиксом, например `v0.2.0-beta.1`, создают prerelease.
Версия тега проверяется до сборки.

Отдельный PAT не нужен: публикация использует встроенный `GITHUB_TOKEN` с
`contents: write` только в задаче релиза. Сборка и pull request получают доступ
на чтение. Компоненты Actions закреплены по SHA.

Офлайн-установщик по-прежнему собирается локально:

```powershell
npm run setup:tools
npm run setup:build
```
