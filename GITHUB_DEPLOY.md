# Автодеплой на 212.34.140.40 через GitHub Actions

Схема: код лежит в GitHub-репозитории → при пуше в `main` GitHub Actions
подключается к серверу по SSH под отдельным deploy-пользователем с
ограниченными правами и синхронизирует только файлы сайта (`rsync`) в уже
подготовленную папку. Никакого ручного SSH при каждом обновлении сайта
больше не нужно.

Готовый workflow уже лежит в проекте: `.github/workflows/deploy.yml`.
Ниже — что нужно сделать один раз, чтобы он заработал.

Важно: сам приватный SSH-ключ и пароли я не создаю и не вижу — вы (или ваш
админ) генерируете ключ и вводите его в GitHub самостоятельно, в интерфейсе
GitHub, а не через меня. Это обычная практика безопасности для CI/CD, а не
дополнительная сложность.

---

## Шаг 1 — Один раз подготовить сервер (как в DEPLOY.md)

Если ещё не сделано — выполните шаги 0–2 и 4 из `DEPLOY.md`: определить
веб-сервер, создать `/var/www/taxi-memo/html`, настроить nginx/apache
server block, проверить конфигурацию, включить сайт. GitHub Actions дальше
будет только обновлять файлы в этой директории — сам веб-сервер настраивать
не будет.

## Шаг 2 — Создать отдельного deploy-пользователя на сервере (рекомендуется)

Отдельный пользователь с правами только на нужную папку — чтобы ключ CI не
давал полного root-доступа:

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo mkdir -p /home/deploy/.ssh
sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh

# дать deploy-пользователю права на папку сайта
sudo chown -R deploy:deploy /var/www/taxi-memo/html
```

Если создавать отдельного пользователя не хочется — можно использовать
существующего непривилегированного пользователя, у которого уже есть права
на `/var/www/taxi-memo/html`. Root-пользователя для этого использовать не
стоит.

## Шаг 3 — Сгенерировать ключ для деплоя (на своём компьютере, не на сервере)

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ./deploy_key -N ""
```

Появятся два файла: `deploy_key` (приватный) и `deploy_key.pub` (публичный).

Публичный ключ — на сервер, в `authorized_keys` пользователя `deploy`:

```bash
cat deploy_key.pub | ssh <ваш_обычный_user>@212.34.140.40 \
  "sudo tee -a /home/deploy/.ssh/authorized_keys && sudo chmod 600 /home/deploy/.ssh/authorized_keys && sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys"
```

Проверить, что ключ работает:

```bash
ssh -i deploy_key deploy@212.34.140.40 "whoami && ls -la /var/www/taxi-memo/html"
```

## Шаг 4 — Создать репозиторий на GitHub и запушить проект

На github.com: New repository → например `taxi-memo-landing` → Create
(без README/лицензии, репозиторий должен быть пустым).

Локально, в папке `taxi-landing/` (та же, что в архиве):

```bash
cd taxi-landing
git init
git add .
git commit -m "Лендинг Памятка водителя"
git branch -M main
git remote add origin git@github.com:<ваш-аккаунт>/taxi-memo-landing.git
git push -u origin main
```

## Шаг 5 — Добавить секреты в репозиторий

В репозитории на GitHub: **Settings → Secrets and variables → Actions → New
repository secret**. Добавить четыре секрета:

| Имя секрета | Значение |
|---|---|
| `DEPLOY_SSH_KEY` | содержимое файла `deploy_key` (приватный ключ, весь файл целиком, включая строки `-----BEGIN...-----` / `-----END...-----`) |
| `DEPLOY_HOST` | `212.34.140.40` |
| `DEPLOY_USER` | `deploy` (или тот пользователь, которого использовали в шаге 2) |
| `DEPLOY_PATH` | `/var/www/taxi-memo/html` (путь из DEPLOY.md, без слэша на конце) |

После этого удалите локальный файл `deploy_key` с приватным ключом со своего
компьютера (он уже сохранён в GitHub Secrets в зашифрованном виде) или
храните его в надёжном месте (менеджере паролей) — не оставляйте лежать в
папке проекта.

## Шаг 6 — Проверить деплой

Любой пуш в `main`, который меняет `index.html` / `styles.css` / `script.js`
/ `data.js` / `assets/**`, запустит workflow автоматически. Также можно
запустить вручную: вкладка **Actions** → **Deploy taxi-landing to
212.34.140.40** → **Run workflow**.

В логе запуска должно быть видно: `Load deploy SSH key` — успешно,
`Rsync files to server` — список переданных файлов без ошибок,
`Smoke test` — `OK: сайт отвечает`.

Если шаг `Rsync` упал с ошибкой доступа — проверьте права на
`/var/www/taxi-memo/html` для пользователя `deploy` (шаг 2). Если упал шаг
`Load deploy SSH key` — проверьте, что в секрет `DEPLOY_SSH_KEY` попал именно
приватный ключ целиком, без лишних пробелов.

## Дальнейшие обновления

После первичной настройки для обновления сайта достаточно:

```bash
# отредактировать data.js / другие файлы
git add .
git commit -m "Обновление данных"
git push
```

GitHub Actions сам синхронизирует изменения на сервер за секунды —
заходить по SSH вручную для рутинных правок больше не нужно.
