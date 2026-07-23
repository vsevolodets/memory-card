# Развёртывание лендинга «Памятка водителя» на сервере 212.34.140.40

Пошаговая инструкция для того, кто выполняет развёртывание по SSH (вы сами или
администратор). Все команды — копировать и выполнять по порядку. Ничего не
делайте предположительно: каждый шаг сначала проверяет текущее состояние
сервера, и только потом действует.

---

## 0. Подключение и первичная диагностика

```bash
ssh <user>@212.34.140.40
```

Дальше на сервере:

```bash
# ОС и версия
cat /etc/os-release

# Текущий пользователь и права
whoami; id

# Свободное место
df -h

# Какой веб-сервер установлен и запущен
which nginx apache2 httpd 2>/dev/null
systemctl list-units --type=service --state=running | grep -iE "nginx|apache|httpd"

# Firewall
sudo ufw status verbose 2>/dev/null || sudo firewall-cmd --list-all 2>/dev/null || sudo iptables -L -n

# Сертификаты (Let's Encrypt / прочие)
sudo ls -la /etc/letsencrypt/live/ 2>/dev/null
sudo certbot certificates 2>/dev/null
```

Запишите результат каждой команды — он определяет, какой раздел ниже
использовать (Nginx или Apache), и где физически лежат существующие сайты.

## 1. Найти существующие сайты и не мешать им

**Nginx:**
```bash
ls -la /etc/nginx/sites-available/ /etc/nginx/sites-enabled/ 2>/dev/null
ls -la /etc/nginx/conf.d/ 2>/dev/null
sudo nginx -T 2>/dev/null | grep -E "server_name|root|listen"
```

**Apache:**
```bash
ls -la /etc/apache2/sites-available/ /etc/apache2/sites-enabled/ 2>/dev/null
apache2ctl -S 2>/dev/null
```

Обратите внимание на:
- какие домены/порты уже заняты (`server_name` / `ServerName`);
- где физически лежат сайты (`root` / `DocumentRoot`), обычно
  `/var/www/<имя>/` — по этому же образцу разместите новый сайт;
- используется ли уже 80/443 порт другим `server_name` по умолчанию
  (`default_server`) — если да, новый сайт должен получить свой домен или
  явный `server_name`, а не претендовать на дефолтный блок.

## 2. Выбрать путь размещения и создать директорию

Не занимайте существующие каталоги. Создайте отдельный, например:

```bash
sudo mkdir -p /var/www/taxi-memo/{html,logs}
sudo chown -R $(whoami):$(whoami) /var/www/taxi-memo/html   # или www-data, если так принято на сервере
```

## 3. Загрузить проект через rsync

С локальной машины (там, где лежит папка `taxi-landing/` — файлы index.html,
styles.css, script.js, data.js, assets/, README.md):

```bash
rsync -avz --progress \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.DS_Store' \
  --exclude='*.tmp' \
  --exclude='.idea' \
  --exclude='.vscode' \
  taxi-landing/ <user>@212.34.140.40:/var/www/taxi-memo/html/
```

Проект полностью статический — `node_modules`/`.git` в нём и так нет
(чистый HTML/CSS/JS), но флаги оставлены на случай, если в папку что-то
добавится позже.

Проверить, что всё скопировалось:

```bash
ssh <user>@212.34.140.40 "ls -la /var/www/taxi-memo/html/"
# ожидается: index.html, styles.css, script.js, data.js, README.md, assets/logo.png
```

## 4. Создать virtual host (только если нужен новый)

Если у существующих сайтов уже есть подходящий домен/поддомен для памятки —
можно добавить `location` в их конфиг вместо нового server block. Если нет —
создайте отдельный конфиг.

### Nginx

`sudo nano /etc/nginx/sites-available/taxi-memo.conf`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name ЗАМЕНИТЕ_НА_ДОМЕН_ИЛИ_IP;   # например memo.taximania.ru или сам 212.34.140.40

    root /var/www/taxi-memo/html;
    index index.html;

    access_log /var/www/taxi-memo/logs/access.log;
    error_log  /var/www/taxi-memo/logs/error.log;

    location / {
        try_files $uri $uri/ =404;
    }

    # корректные MIME-типы (обычно уже есть в mime.types, но на всякий случай)
    types {
        text/html              html;
        text/css               css;
        application/javascript js;
        image/png              png;
    }

    # кеширование статики
    location ~* \.(css|js|png|jpg|jpeg|svg|ico)$ {
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }
    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    # gzip (если не включён глобально в nginx.conf)
    gzip on;
    gzip_types text/css application/javascript text/html;
    gzip_min_length 256;
}
```

Если на сервере уже есть SSL-сертификат (шаг 0) для нужного домена — добавьте
второй `server` блок на 443 по образцу существующих сайтов
(`sudo nginx -T | grep -A20 "listen 443"` покажет пример) и `ssl_certificate` /
`ssl_certificate_key` пути из `/etc/letsencrypt/live/<домен>/`. Не создавайте
новый сертификат, если подходящий уже есть; не трогайте сертификаты других
доменов.

Включить сайт:

```bash
sudo ln -s /etc/nginx/sites-available/taxi-memo.conf /etc/nginx/sites-enabled/
sudo nginx -t          # ОБЯЗАТЕЛЬНО перед перезапуском
```

Если `nginx -t` вернул ошибку — не перезапускать, читать `journalctl -u nginx -n 50`
и `tail -f /var/log/nginx/error.log`, исправить, повторить проверку.

Только после `syntax is ok / test is successful`:

```bash
sudo systemctl reload nginx   # reload, не restart — не разрывает существующие соединения
```

### Apache (если на сервере он вместо nginx)

`sudo nano /etc/apache2/sites-available/taxi-memo.conf`:

```apache
<VirtualHost *:80>
    ServerName ЗАМЕНИТЕ_НА_ДОМЕН_ИЛИ_IP
    DocumentRoot /var/www/taxi-memo/html

    <Directory /var/www/taxi-memo/html>
        Options -Indexes +FollowSymLinks
        AllowOverride None
        Require all granted
    </Directory>

    ErrorLog /var/www/taxi-memo/logs/error.log
    CustomLog /var/www/taxi-memo/logs/access.log combined

    # кеширование статики (требует mod_expires)
    <IfModule mod_expires.c>
        ExpiresActive On
        ExpiresByType text/css "access plus 30 days"
        ExpiresByType application/javascript "access plus 30 days"
        ExpiresByType image/png "access plus 30 days"
    </IfModule>
</VirtualHost>
```

```bash
sudo a2ensite taxi-memo.conf
sudo a2enmod expires deflate headers   # deflate = gzip для Apache
sudo apachectl configtest              # ОБЯЗАТЕЛЬНО перед перезапуском
```

Если `configtest` вернул `Syntax OK` — только тогда:

```bash
sudo systemctl reload apache2
```

Если нет — `journalctl -u apache2 -n 50`, `tail -f /var/log/apache2/error.log`,
исправить, повторить `configtest`.

## 5. Проверка после публикации

Замените `ЗАМЕНИТЕ_НА_ДОМЕН_ИЛИ_IP` на реальный адрес сайта:

```bash
# базовая доступность и заголовки
curl -I http://ЗАМЕНИТЕ_НА_ДОМЕН_ИЛИ_IP/

# HTML отдаётся
curl -s http://ЗАМЕНИТЕ_НА_ДОМЕН_ИЛИ_IP/ | head -20

# статика отдаётся и с правильным MIME
curl -I http://ЗАМЕНИТЕ_НА_ДОМЕН_ИЛИ_IP/styles.css
curl -I http://ЗАМЕНИТЕ_НА_ДОМЕН_ИЛИ_IP/script.js
curl -I http://ЗАМЕНИТЕ_НА_ДОМЕН_ИЛИ_IP/data.js
curl -I http://ЗАМЕНИТЕ_НА_ДОМЕН_ИЛИ_IP/assets/logo.png

# 404 действительно 404 (проверка, что несуществующая страница не отдаёт 200)
curl -I http://ЗАМЕНИТЕ_НА_ДОМЕН_ИЛИ_IP/nonexistent-page

# gzip работает
curl -H "Accept-Encoding: gzip" -I http://ЗАМЕНИТЕ_НА_ДОМЕН_ИЛИ_IP/styles.css
# в ответе должен быть Content-Encoding: gzip
```

Затем откройте сайт в обычном браузере (с телефона и с компьютера) и
проверьте вручную по списку из ТЗ:
- HTML/CSS/JS загружаются без ошибок (открыть консоль разработчика — ошибок
  быть не должно);
- выбор колонны — переключаются менеджеры;
- телефоны — кликабельны (`tel:`);
- FAQ — поиск, категории, раскрытие ответов;
- карта — маркер на месте осмотра (Нахимовский тоннель, 55.663290, 37.620497);
- кнопка Telegram-бота ведёт на `https://t.me/taxi_mania_bot`;
- никаких 404 в консоли (вкладка Network) — особенно на `logo.png`,
  `styles.css`, `script.js`, `data.js`.

## 6. Откат, если что-то пошло не так

```bash
sudo rm /etc/nginx/sites-enabled/taxi-memo.conf   # для nginx
# или
sudo a2dissite taxi-memo.conf                      # для apache

sudo nginx -t && sudo systemctl reload nginx
# или
sudo apachectl configtest && sudo systemctl reload apache2
```

Это отключает только новый сайт и не затрагивает остальные конфиги — уже
работающие сайты на сервере не пострадают ни на одном из шагов выше, так как
все изменения ограничены новым файлом конфигурации и новой директорией
`/var/www/taxi-memo/`.

---

По завершении заполните для отчёта: используемая ОС, веб-сервер и его
версия, путь размещения, использовался ли существующий SSL-сертификат или
сайт пока только на 80 порту, итоговый URL и результаты проверок из пункта 5.
