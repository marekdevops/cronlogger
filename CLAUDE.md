# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stan projektu

Projekt zaimplementowany. Kod aplikacji w `src/`, konfiguracja w `config/`, deploy w `deploy/`.
`SCRIPT_ANALYSIS.md` zawiera analizę `logs_template.sh`.

---

# Cron Script Manager Web App (RHEL 7 / 8 / 9)

## Cel projektu

Zbuduj webową aplikację do zarządzania i monitorowania skryptów uruchamianych z crona na systemie RHEL 7.
Aplikacja ma być dostępna przez przeglądarkę, serwowana przez nginx jako reverse proxy, z interfejsem
w stylu terminala linuxowego (hacker/admin aesthetic).

---

## Krok 1 — Analiza skryptu `logs_template.sh`

Zanim napiszesz jakikolwiek kod, **przeczytaj i przeanalizuj skrypt** `logs_template.sh`
z bieżącego katalogu roboczego.

Zrób następujące rzeczy:
1. Zrozum co skrypt robi — jakie zmienne konfiguracyjne używa, jakie operacje wykonuje
   (szukanie logów, pakowanie, transfer FTP).
2. Zidentyfikuj sekcje konfiguracyjne (zmienne u góry skryptu) — to będzie podstawa
   do generowania opisów w UI.
3. Zidentyfikuj gdzie skrypt zapisuje logi swojego wykonania (stdout/stderr, plik logów).
4. **NIE modyfikuj** pliku `logs_template.sh` — jest to szablon produkcyjny.
5. Zapisz wyniki analizy w osobnym pliku `SCRIPT_ANALYSIS.md`:
   - Krótki opis co skrypt robi (1–3 zdania, po polsku)
   - Lista zmiennych konfiguracyjnych z opisem
   - Sugestie ulepszeń skryptu poprawiające integrację z dashboardem (exit code file,
     structured logging, PID file) — **tylko jako dokumentacja, nie implementuj ich automatycznie**

---

## Krok 2 — Stack technologiczny

### Kompatybilność systemowa

Aplikacja obsługuje RHEL 7, 8 i 9. `install.sh` wykrywa wersję automatycznie.

| Wersja RHEL | Menadżer pakietów | Źródło Node.js | Ścieżka node |
|---|---|---|---|
| RHEL 7 | `yum` | SCL `rh-nodejs12` (`rhel-server-rhscl-7-rpms`) | `/opt/rh/rh-nodejs12/root/usr/bin/node` |
| RHEL 8 | `dnf` | AppStream module `nodejs:18` (`rhel-8-for-x86_64-appstream-rpms`) | `/usr/bin/node` |
| RHEL 9 | `dnf` | AppStream module `nodejs:20` (`rhel-9-for-x86_64-appstream-rpms`) | `/usr/bin/node` |

**Nie używaj:** EPEL, npmjs.com, pip, gem ani żadnych innych zewnętrznych źródeł.

### Node.js na RHEL 7 — SCL

Na RHEL 7 Node.js pochodzi z Red Hat Software Collections. Binarka wymaga zmiennych środowiskowych SCL.
`install.sh` generuje `cronmanager.service` z tymi zmiennymi automatycznie:
```
Environment="PATH=/opt/rh/rh-nodejs12/root/usr/bin:..."
Environment="LD_LIBRARY_PATH=/opt/rh/rh-nodejs12/root/usr/lib64"
Environment="NODE_PATH=/opt/rh/rh-nodejs12/root/usr/lib/node_modules"
```
Na RHEL 8/9 te zmienne nie są potrzebne — używany jest standardowy `/usr/bin/node`.

### Stack aplikacji

- **Backend**: Node.js (≥12), **wyłącznie wbudowane moduły** — zero npm install w produkcji
- **Web server / reverse proxy**: nginx — terminuje SSL i HTTP Basic Auth, proxuje do Node.js
- **Frontend**: czysty HTML5 + CSS3 + vanilla JavaScript (bez frameworków, bez bundlerów)
- **Autentykacja**: HTTP Basic Auth przez nginx (`openssl passwd`)
- **Konfiguracja**: pliki JSON w katalogu `config/`
- **Proces manager**: systemd unit (nie PM2 — PM2 to npm)

### Dozwolone built-in moduły Node.js

```
http          — serwer HTTP
fs / fs.promises — operacje plikowe
path          — ścieżki
child_process — execFile() do odczytu crontabów (tylko z whitelisted args)
crypto        — hashowanie
os            — hostname, uptime
readline      — czytanie dużych plików linia po linii
url           — parsowanie URL i query string
querystring   — parsowanie parametrów
stream        — streaming logów
util          — promisify
```

**Zakaz używania:** express, fastify, koa, lodash, moment, axios, żadnych pakietów z npmjs.com.

---

## Krok 3 — Architektura aplikacji

### Wzorzec: minimalistyczny HTTP router w Node.js

Napisz własny prosty router oparty na `http.createServer()`:

```javascript
// src/router.js
const routes = new Map();

function register(method, pattern, handler) {
  routes.set(`${method}:${pattern}`, handler);
}

function dispatch(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const key = `${req.method}:${parsedUrl.pathname}`;
  const handler = routes.get(key) ?? notFound;
  handler(req, res, parsedUrl);
}
```

Aplikacja ma kilka endpointów — prosty router w zupełności wystarczy.

### Struktura katalogów

```
/opt/cronmanager/                   # katalog aplikacji
├── src/
│   ├── server.js                   # główny punkt wejścia, http.createServer()
│   ├── router.js                   # prosty URL router
│   ├── api/
│   │   ├── dashboard.js            # GET /api/dashboard — podsumowanie statusów
│   │   ├── crontabs.js             # GET /api/crontabs — lista wpisów cron
│   │   ├── logs.js                 # GET /api/logs/:scriptId — logi skryptu
│   │   └── status.js               # GET /api/status/:scriptId — status wykonania
│   ├── lib/
│   │   ├── CrontabReader.js        # parsowanie /var/spool/cron i /etc/cron.d/
│   │   ├── LogReader.js            # czytanie plików logów (tail N lines)
│   │   ├── StatusResolver.js       # determinowanie OK/FAIL/UNKNOWN
│   │   └── ConfigLoader.js         # ładowanie i walidacja config/scripts.json
│   └── public/                     # statyczne pliki serwowane przez nginx
│       ├── index.html              # SPA shell — cały UI
│       ├── assets/
│       │   ├── style.css           # terminal theme
│       │   └── app.js              # frontend — fetch API, DOM manipulation
│       └── favicon.ico
├── config/
│   ├── scripts.json                # definicje zarządzanych skryptów + app config
├── scripts/
│   └── logs_template.sh            # oryginalny skrypt (nie modyfikować)
├── logs/                           # logi samej aplikacji webowej
│   └── app.log
└── package.json                    # name, version, scripts — BEZ dependencies

/etc/systemd/system/
└── cronmanager.service             # systemd unit dla Node.js procesu

/etc/nginx/conf.d/
└── cronmanager.conf                # nginx reverse proxy + SSL + auth
```

### `package.json` — tylko metadane, zero zależności

```json
{
  "name": "cronmanager",
  "version": "1.0.0",
  "description": "Cron Script Manager for RHEL 7",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js"
  },
  "engines": {
    "node": ">=12.0.0"
  },
  "dependencies": {}
}
```

---

## Krok 4 — Backend — szczegóły implementacji

### 4.1 `src/server.js` — główny serwer

```javascript
'use strict';
const http   = require('http');
const router = require('./router');
const config = require('./lib/ConfigLoader');

const PORT = config.get('app.port', 3000);
const HOST = '127.0.0.1'; // nginx proxuje — Node słucha tylko lokalnie

const server = http.createServer((req, res) => {
  // nginx obsługuje auth — tutaj weryfikuj nagłówek proxy_set_header
  if (req.headers['x-authenticated'] !== 'true') {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  router.dispatch(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`[${new Date().toISOString()}] CronManager listening on ${HOST}:${PORT}`);
});
```

### 4.2 `src/lib/CrontabReader.js`

Odczyt crontabów przez bezpośredni odczyt plików — bezpieczniejszy niż exec crontab:

```javascript
// Parsuj pojedynczą linię cron expression
// Zwróć: { user, schedule, command, isManaged, managedId } lub null (komentarze/puste)
function parseLine(line, user) { ... }

// Odczytaj /var/spool/cron/<username> dla każdego user z whitelist
function readUserCrontab(username) { ... }

// Przeszukaj /etc/cron.d/ — pliki z dodatkowym polem username w linii
function readCronD() { ... }

// Oznacz wpisy należące do zarządzanych skryptów (porównanie ścieżek z config)
function markManagedEntries(entries, managedScripts) { ... }
```

Whitelist użytkowników z `config/scripts.json` (`app.cron_users`).
Nigdy nie wykonuj `exec()` z danymi pochodzącymi od użytkownika HTTP.

### 4.3 `src/lib/LogReader.js`

Czytanie ogona pliku bez wczytywania całości do pamięci:

```javascript
// Zwróć ostatnie N linii pliku — efektywne dla dużych plików logów
// Implementacja: fs.createReadStream z odpowiednim podejściem do chunków od końca
async function tailLines(filePath, n = 200) { ... }

// Zwróć stat pliku { mtime, size } lub null jeśli nie istnieje
async function fileStat(filePath) { ... }

// Klasyfikacja linii: zwróć 'ok' | 'fail' | 'warn' | 'info' | 'plain'
function classifyLine(line) { ... }
```

### 4.4 `src/lib/StatusResolver.js`

```javascript
const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48h

async function resolve(scriptConfig) {
  // 1. Sprawdź plik .status (preferred): "0" → OK, inne → FAIL
  // 2. Fallback: keyword scan ostatnich 20 linii logu
  //    /\b(SUCCESS|COMPLETED|OK|DONE)\b/i → OK
  //    /\b(ERROR|FAILED|FAILURE|CRITICAL)\b/i → FAIL
  // 3. mtime logu starszy niż STALE_THRESHOLD → UNKNOWN
  // 4. plik logu nie istnieje → UNKNOWN
  return { status: 'OK'|'FAILED'|'UNKNOWN', lastRun: Date|null, message: String };
}
```

### 4.5 API Response format

Wszystkie endpointy zwracają JSON:

```javascript
// Sukces
res.writeHead(200, { 'Content-Type': 'application/json' });
res.end(JSON.stringify({ ok: true, data: { ... } }));

// Błąd
res.writeHead(400, { 'Content-Type': 'application/json' });
res.end(JSON.stringify({ ok: false, error: 'Opis błędu (bez ścieżek systemowych)' }));
```

Nigdy nie zwracaj stack trace ani ścieżek systemowych w HTTP response.
Loguj szczegóły błędów do `logs/app.log`.

### 4.6 Podział serwowania

- **Pliki statyczne** (`/`, `/assets/*`) → nginx serwuje bezpośrednio z `src/public/`
- **API** (`/api/*`) → nginx `proxy_pass` do Node.js na `127.0.0.1:3000`

Node.js **nie obsługuje** plików statycznych — tylko API.

---

## Krok 5 — Frontend (`src/public/`)

### `index.html` — Single Page App

Jedna strona HTML z widokami przełączanymi przez JS (bez przeładowania strony):

```html
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CRON MANAGER</title>
  <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
  <header id="term-header">
    <!-- ASCII logo, hostname, live clock, uptime -->
  </header>
  <nav id="term-nav">
    <!-- [DASHBOARD] [CRONTABS] [LOGS] -->
  </nav>
  <main id="app">
    <section id="view-dashboard" class="view active"></section>
    <section id="view-crontabs"  class="view"></section>
    <section id="view-logs"      class="view"></section>
  </main>
  <footer id="term-footer">
    <!-- wersja, status połączenia, timestamp -->
  </footer>
  <script src="/assets/app.js"></script>
</body>
</html>
```

### `assets/app.js` — vanilla JS, ES6, zero zewnętrznych bibliotek

```javascript
'use strict';

// Hash-based router: #dashboard, #crontabs, #logs/scriptId
// Fetch API do komunikacji z /api/*
// DOM manipulation bez jQuery ani żadnego frameworka

const App = {
  async init()                 { ... },
  async navigate(route)        { ... },
  async loadDashboard()        { ... },
  async loadCrontabs()         { ... },
  async loadLogs(scriptId)     { ... },
  renderScriptRow(script)      { ... },
  renderLogLine(line, level)   { ... },
  formatRelativeTime(date)     { ... },   // "2 godziny temu", "wczoraj o 02:15"
  parseCronHuman(expression)   { ... },   // "0 2 * * *" → "codziennie o 02:00"
};

// Auto-refresh co 60 sekund dla dashboardu z widocznym countdown
// Live clock w nagłówku (setInterval 1s)
// Scroll log output do dołu przy pierwszym załadowaniu

document.addEventListener('DOMContentLoaded', () => App.init());
window.addEventListener('hashchange', () => App.navigate(location.hash));
```

### `assets/style.css` — Terminal CSS Theme

```css
:root {
  --bg-primary:     #0a0a0a;
  --bg-secondary:   #111111;
  --bg-tertiary:    #1a1a1a;
  --border-color:   #1a5c1a;
  --text-primary:   #00ff41;   /* Matrix green */
  --text-secondary: #00bb30;
  --text-dim:       #005510;
  --text-muted:     #334433;
  --accent-ok:      #00ff41;
  --accent-fail:    #ff2244;
  --accent-warn:    #ffaa00;
  --accent-info:    #00aaff;
  --font-mono:      'Courier New', Courier, monospace;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.5;
}

/* CRT scanline overlay */
body::after {
  content: '';
  position: fixed;
  inset: 0;
  background: repeating-linear-gradient(
    0deg, transparent, transparent 2px,
    rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px
  );
  pointer-events: none;
  z-index: 9999;
}

/* Glow na głównym tekście */
.glow { text-shadow: 0 0 6px var(--text-primary); }

/* Migający kursor */
@keyframes blink { 0%,100% { opacity:1; } 50% { opacity:0; } }
.cursor::after { content: '█'; animation: blink 1s step-end infinite; }
```

---

## Krok 6 — Funkcjonalności do zaimplementowania

### 6.1 Dashboard główny (`#dashboard`)

Widok główny — terminal-style:

```
╔══════════════════════════════════════════════════════════════╗
║  [CRON MANAGER v1.0]          hostname: server01.local       ║
║  2026-03-30 14:22:05█         uptime:   47 days, 3h          ║
╠══════════════════════════════════════════════════════════════╣
║  SCRIPTS: 5   ║   OK: 3   ║   FAILED: 1   ║   UNKNOWN: 1   ║
╠═══════════════╩═══════════╩═══════════════╩════════════════╣
║  SCRIPT NAME          SCHEDULE        LAST RUN     STATUS   ║
║  ─────────────────────────────────────────────────────────  ║
║  logs_backup_app1     0 2 * * *       2h ago       [  OK  ] ║
║  logs_backup_db       30 1 * * *      7h ago       [ FAIL ] ║
║  logs_cleanup         0 */6 * * *     3h ago       [  OK  ] ║
║                                                             ║
║  Auto-refresh in: [45s] ░░░░░░░░░░░░████████████████████   ║
╚══════════════════════════════════════════════════════════════╝
```

- Status badge: `[  OK  ]` zielony, `[ FAIL ]` czerwony, `[  ??  ]` żółty
- Każdy wiersz klikalny → nawiguje do `#logs/<scriptId>`
- Progress bar countdown do auto-refresh
- Hostname i uptime z `/api/dashboard`

### 6.2 Przeglądarka crontabów (`#crontabs`)

- Tabela: użytkownik | raw schedule | opis po ludzku | komenda | managed?
- Wpisy zarządzanych skryptów oznaczone badge: `[MANAGED]`
- `/etc/cron.d/` jako osobna sekcja z nagłówkiem
- Human-readable schedule implementowany w czystym JS:
  - `0 2 * * *` → `codziennie o 02:00`
  - `*/15 * * * *` → `co 15 minut`
  - `0 */6 * * *` → `co 6 godzin`
  - itp.
- Breadcrumb: `root@hostname:~$ crontab -l`

### 6.3 Przeglądarka logów (`#logs/:scriptId`)

- Whitelist `scriptId` — tylko wartości z `config/scripts.json`
- Wyświetl ostatnie 200 linii w `<pre class="log-output">`
- Kolorowanie linii przez klasy CSS: `log-ok`, `log-fail`, `log-warn`, `log-info`
- Przycisk `[REFRESH]` + `Last modified: 14:20:33 (3 min ago)`
- Jeśli plik nie istnieje → `[ NO LOG FILE FOUND — check config/scripts.json ]`
- Scroll do dołu automatycznie przy pierwszym załadowaniu
- Breadcrumb: `root@hostname:~$ tail -200 /var/log/scripts/<name>.log`

### 6.4 Panel szczegółów skryptu (modal lub inline expand)

Po kliknięciu w wiersz skryptu rozwiń szczegóły:
- Pełna nazwa, opis, ścieżka skryptu
- Tagi: `[backup]` `[ftp]` `[logs]`
- Timestamp ostatniego uruchomienia i status
- Przycisk `[VIEW LOGS]`

---

## Krok 7 — Bezpieczeństwo (PRIORYTET — system produkcyjny)

### 7.1 Autentykacja — HTTP Basic Auth przez nginx

```nginx
auth_basic           "CronManager — Authorized Access Only";
auth_basic_user_file /etc/nginx/.cronmanager_htpasswd;
```

Nginx po pomyślnej autentykacji przekazuje nagłówek do Node.js:
```nginx
proxy_set_header X-Authenticated "true";
proxy_set_header X-Remote-User   $remote_user;
```

Node.js weryfikuje obecność `X-Authenticated: true` — dodatkowa warstwa obrony w głąb.

### 7.2 Nginx hardening

```nginx
server_tokens off;
add_header Strict-Transport-Security "max-age=31536000" always;
add_header X-Frame-Options           SAMEORIGIN;
add_header X-Content-Type-Options    nosniff;
add_header X-XSS-Protection          "1; mode=block";
add_header Content-Security-Policy   "default-src 'self'; style-src 'self' 'unsafe-inline'";

# Blokuj dostęp do wrażliwych lokalizacji
location ~ /\.(git|env|json|log)$ { deny all; return 404; }
location /config/                  { deny all; return 404; }
location /logs/                    { deny all; return 404; }

# Tylko bezpieczne metody HTTP
if ($request_method !~ ^(GET|POST|HEAD)$) { return 405; }
```

### 7.3 Node.js — zasady bezpieczeństwa kodu

```javascript
// ❌ NIGDY nie rób tego:
const id = req.query.id;
exec(`cat /var/log/${id}.log`);          // path traversal!
readFileSync(`/var/spool/cron/${id}`);   // path traversal!

// ✅ Zawsze waliduj przez whitelist:
const allowed = config.getScriptIds();   // z scripts.json, nie od usera
if (!allowed.includes(scriptId)) {
  return sendError(res, 403, 'Forbidden');
}
const logPath = config.getScript(scriptId).log_file; // ścieżka z config
```

Zasady:
- **Nigdy** nie buduj ścieżek plików z danych od użytkownika HTTP
- **Nigdy** nie wykonuj `exec()` / `spawn()` z niezwalidowanymi argumentami
- Whitelist wszystkich `scriptId` na podstawie `config/scripts.json`
- Dostęp do plików logów: tylko ścieżki jawnie zdefiniowane w konfiguracji
- Crontaby: bezpośredni odczyt `/var/spool/cron/<user>` tylko z whitelisted users

### 7.4 HTTPS — self-signed cert (generowany przez `install.sh`)

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/cronmanager.key \
  -out    /etc/nginx/ssl/cronmanager.crt \
  -subj   "/CN=$(hostname)/O=Internal/C=PL"
chmod 600 /etc/nginx/ssl/cronmanager.key
```

Redirect HTTP → HTTPS obowiązkowy.

### 7.5 Systemd — izolacja procesu Node.js

```ini
[Service]
User=cronmanager
Group=cronmanager
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadOnlyPaths=/
ReadWritePaths=/opt/cronmanager/logs
```

Stwórz dedykowanego systemowego użytkownika `cronmanager` bez shell.
Użytkownik `cronmanager` musi mieć prawa odczytu do:
- `/var/spool/cron/` — odczyt plików crontabów
- Katalogów logów skryptów zdefiniowanych w `config/scripts.json`

Skonfiguruj przez `setfacl` lub grupę systemową — bez nadawania ogólnych uprawnień.

### 7.6 Ograniczenie dostępu sieciowego (zalecane — dodaj do nginx)

```nginx
# Dostęp tylko z sieci wewnętrznej
allow 10.0.0.0/8;
allow 192.168.0.0/16;
deny all;
```

---

## Krok 8 — Konfiguracja nginx (`/etc/nginx/conf.d/cronmanager.conf`)

```nginx
# Redirect HTTP → HTTPS
server {
    listen      80;
    server_name _;
    return 301  https://$host$request_uri;
}

server {
    listen      443 ssl;
    server_name _;

    ssl_certificate     /etc/nginx/ssl/cronmanager.crt;
    ssl_certificate_key /etc/nginx/ssl/cronmanager.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5:!3DES;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;

    # Basic Auth — jedyny punkt wejścia
    auth_basic           "CronManager — Authorized Access Only";
    auth_basic_user_file /etc/nginx/.cronmanager_htpasswd;

    # Security headers
    server_tokens off;
    add_header X-Frame-Options        SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection       "1; mode=block" always;

    # Pliki statyczne — serwowane bezpośrednio przez nginx
    root  /opt/cronmanager/src/public;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
        expires 1h;
        add_header Cache-Control "public";
    }

    # API — proxy do Node.js
    location /api/ {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host             $host;
        proxy_set_header   X-Real-IP        $remote_addr;
        proxy_set_header   X-Authenticated  "true";
        proxy_set_header   X-Remote-User    $remote_user;
        proxy_read_timeout 30s;
        proxy_connect_timeout 5s;

        # Nie cache'uj API responses
        add_header Cache-Control "no-store, no-cache";
    }

    # Blokady
    location ~ /\.(git|env|json|log)$ { deny all; return 404; }
    location /config/                  { deny all; return 404; }
    location /logs/                    { deny all; return 404; }

    if ($request_method !~ ^(GET|POST|HEAD)$) { return 405; }
}
```

---

## Krok 9 — Systemd Unit (`/etc/systemd/system/cronmanager.service`)

```ini
[Unit]
Description=CronManager Web Application (Node.js)
After=network.target
Requires=network.target

[Service]
Type=simple
User=cronmanager
Group=cronmanager
WorkingDirectory=/opt/cronmanager

# Aktywacja SCL Node.js 12 przez zmienne środowiskowe
Environment="PATH=/opt/rh/rh-nodejs12/root/usr/bin:/usr/local/bin:/usr/bin:/bin"
Environment="LD_LIBRARY_PATH=/opt/rh/rh-nodejs12/root/usr/lib64"
Environment="NODE_ENV=production"
Environment="NODE_PATH=/opt/rh/rh-nodejs12/root/usr/lib/node_modules"

ExecStart=/opt/rh/rh-nodejs12/root/usr/bin/node src/server.js
Restart=always
RestartSec=5
TimeoutStopSec=10

# Logowanie do pliku przez journald redirect
StandardOutput=append:/opt/cronmanager/logs/app.log
StandardError=append:/opt/cronmanager/logs/app.log

# Hardening
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

---

## Krok 10 — `config/scripts.json`

```json
{
  "app": {
    "port": 3000,
    "cron_users": ["root"],
    "status_stale_hours": 48
  },
  "scripts": [
    {
      "id": "logs_template",
      "name": "Backup i transfer logów",
      "description": "Wyszukuje pliki logów według konfiguracji wewnętrznej, pakuje je i przesyła przez FTP na zdalny serwer.",
      "script_path": "/opt/scripts/logs_template.sh",
      "log_file": "/var/log/scripts/logs_template.log",
      "status_file": "/var/log/scripts/logs_template.status",
      "cron_user": "root",
      "tags": ["backup", "ftp", "logs"]
    }
  ]
}
```

Uzupełnij automatycznie pierwszy wpis na podstawie analizy `logs_template.sh` z Kroku 1.
Dla pól `script_path` i `log_file` — wykryj z analizy lub zaproponuj konwencję i zapytaj.

---

## Krok 11 — `install.sh` — skrypt instalacyjny

```bash
#!/bin/bash
set -euo pipefail

echo "╔══════════════════════════════════════════╗"
echo "║      CronManager Installer v1.0          ║"
echo "╚══════════════════════════════════════════╝"

# 1. Weryfikacja systemu
grep -q "Red Hat Enterprise Linux Server release 7" /etc/redhat-release \
  || { echo "[ERROR] Wymaga RHEL 7"; exit 1; }
[[ $EUID -eq 0 ]] || { echo "[ERROR] Uruchom jako root"; exit 1; }

# 2. Aktywacja repozytoriów
subscription-manager repos \
  --enable=rhel-7-server-extras-rpms \
  --enable=rhel-server-rhscl-7-rpms

# 3. Instalacja pakietów
yum install -y nginx rh-nodejs12 openssl cronie

# 4. Weryfikacja Node.js
/opt/rh/rh-nodejs12/root/usr/bin/node --version \
  || { echo "[ERROR] Node.js SCL nie działa"; exit 1; }

# 5. Tworzenie użytkownika systemowego
useradd -r -s /sbin/nologin -d /opt/cronmanager cronmanager 2>/dev/null || true

# 6. Deploy plików
cp -r src config package.json /opt/cronmanager/
mkdir -p /opt/cronmanager/logs
chown -R cronmanager:cronmanager /opt/cronmanager
chmod -R 750 /opt/cronmanager
chmod 640 /opt/cronmanager/config/scripts.json

# 7. SSL cert
mkdir -p /etc/nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/cronmanager.key \
  -out    /etc/nginx/ssl/cronmanager.crt \
  -subj   "/CN=$(hostname)/O=Internal/C=PL" 2>/dev/null
chmod 600 /etc/nginx/ssl/cronmanager.key

# 8. htpasswd
echo ""
read -sp "[INPUT] Podaj haslo administratora: " PASSWD; echo
HASH=$(openssl passwd -apr1 "$PASSWD")
echo "admin:${HASH}" > /etc/nginx/.cronmanager_htpasswd
chmod 640 /etc/nginx/.cronmanager_htpasswd
chown root:nginx /etc/nginx/.cronmanager_htpasswd

# 9. Konfiguracja nginx i systemd
cp deploy/cronmanager.conf    /etc/nginx/conf.d/
cp deploy/cronmanager.service /etc/systemd/system/
nginx -t || { echo "[ERROR] Błędna konfiguracja nginx"; exit 1; }

# 10. ACL — dostęp do logów skryptów
# (dopasuj ścieżki do log_file z config/scripts.json)
setfacl -R -m u:cronmanager:r-x /var/log/scripts/ 2>/dev/null || \
  echo "[WARN] setfacl nieudane — ręcznie nadaj uprawnienia do katalogów logów"

# 11. Start usług
systemctl daemon-reload
systemctl enable --now cronmanager nginx

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Instalacja zakonczona!                  ║"
echo "║  URL:  https://$(hostname -s)            ║"
echo "║  User: admin                             ║"
echo "╚══════════════════════════════════════════╝"
```

---

## Ograniczenia i zasady

| Zasada | Opis |
|--------|------|
| ❌ Nie modyfikuj `logs_template.sh` | Szablon produkcyjny — tylko odczyt i analiza |
| ❌ Nie używaj `npm install` w produkcji | Zero zewnętrznych zależności npm na serwerze |
| ❌ Nie buduj ścieżek plików z danych od użytkownika HTTP | Path traversal prevention |
| ❌ Nie uruchamiaj Node.js jako root | Dedykowany user `cronmanager` przez systemd |
| ❌ Nie zwracaj stack trace w HTTP responses | Loguj do pliku, nie do klienta |
| ✅ Waliduj wszystkie `scriptId` przez whitelist z `scripts.json` | Bezpieczeństwo API |
| ✅ Node.js słucha tylko na `127.0.0.1:3000` | Nginx jest jedynym publicznym punktem wejścia |
| ✅ Komentarze w kodzie po polsku lub angielsku | Czytelny kod |
| ✅ Używaj Node.js 12 syntax: async/await, const/let, arrow functions | Nowoczesny czytelny JS |
| ✅ Każdy błąd loguj z timestampem do `logs/app.log` | Audytowalność |

---

## Sugestie dla `logs_template.sh` — do README (nie implementować automatycznie)

Po analizie skryptu zaproponuj następujące opcjonalne ulepszenia:

1. **Exit code file** — aplikacja webowa może jednoznacznie określić status bez keyword scanning:
   ```bash
   SCRIPT_EXIT=$?
   echo "$SCRIPT_EXIT" > "${LOG_DIR}/logs_template.status"
   exit $SCRIPT_EXIT
   ```

2. **Ustrukturyzowane logi** z poziomem i timestampem — dashboard może kolorować automatycznie:
   ```bash
   log() {
     local level="$1"; local msg="$2"
     echo "[$(date '+%Y-%m-%d %H:%M:%S')] [${level}] ${msg}" | tee -a "$LOG_FILE"
   }
   log "INFO"  "Rozpoczynam backup: $SOURCE_DIR"
   log "ERROR" "Blad polaczenia FTP: $FTP_HOST"
   log "OK"    "Transfer zakonczony: $ARCHIVE_NAME"
   ```

3. **PID file** — sprawdzenie czy skrypt aktualnie działa (ochrona przed duplicate run):
   ```bash
   PIDFILE="/var/run/logs_template.pid"
   [ -f "$PIDFILE" ] && kill -0 "$(cat $PIDFILE)" 2>/dev/null && { log "WARN" "Skrypt juz dziala"; exit 1; }
   echo $$ > "$PIDFILE"
   trap "rm -f '$PIDFILE'" EXIT
   ```

4. **Last-run marker** — plik z timestampem startu dla dashboardu:
   ```bash
   date '+%s' > "${LOG_DIR}/logs_template.lastrun"
   ```

---

## Kolejność implementacji (dla Claude Code)

1. [ ] Przeczytaj i przeanalizuj `logs_template.sh` → zapisz `SCRIPT_ANALYSIS.md`
2. [ ] Utwórz strukturę katalogów projektu
3. [ ] Napisz `config/scripts.json` (uzupełniony na podstawie analizy skryptu)
4. [ ] Napisz `src/lib/ConfigLoader.js`
5. [ ] Napisz `src/lib/CrontabReader.js`
6. [ ] Napisz `src/lib/LogReader.js`
7. [ ] Napisz `src/lib/StatusResolver.js`
8. [ ] Napisz `src/router.js`
9. [ ] Napisz `src/api/dashboard.js`, `crontabs.js`, `logs.js`, `status.js`
10. [ ] Napisz `src/server.js`
11. [ ] Napisz `src/public/index.html`
12. [ ] Napisz `src/public/assets/style.css` (terminal theme — szczegóły w Kroku 5)
13. [ ] Napisz `src/public/assets/app.js` (vanilla JS SPA — szczegóły w Kroku 5)
14. [ ] Napisz `deploy/cronmanager.conf` (nginx config — Krok 8)
15. [ ] Napisz `deploy/cronmanager.service` (systemd unit — Krok 9)
16. [ ] Napisz `install.sh` (Krok 11)
17. [ ] Napisz `README.md` (instalacja, obsługa, sugestie dla skryptu)
