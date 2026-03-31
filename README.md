# CronManager

Webowa aplikacja do zarządzania i monitorowania skryptów cron na RHEL 7 / 8 / 9.

## Wymagania

- RHEL 7, 8 lub 9 z aktywną subskrypcją Red Hat
- Dostęp root do instalacji

| RHEL | Node.js | Repozytoria |
|------|---------|-------------|
| 7 | SCL `rh-nodejs12` | `rhel-7-server-extras-rpms`, `rhel-server-rhscl-7-rpms` |
| 8 | AppStream `nodejs:18` | `rhel-8-for-x86_64-appstream-rpms` |
| 9 | AppStream `nodejs:20` | `rhel-9-for-x86_64-appstream-rpms` |

## Szybka instalacja

```bash
git clone <repo> /tmp/cronmanager
cd /tmp/cronmanager
sudo bash install.sh
```

Instalator:
1. Instaluje `nginx`, `rh-nodejs12` (SCL), `openssl`, `cronie`
2. Tworzy użytkownika systemowego `cronmanager`
3. Generuje self-signed certyfikat SSL
4. Konfiguruje HTTP Basic Auth (pyta o hasło)
5. Uruchamia usługi `cronmanager` i `nginx`

## Konfiguracja skryptów

Edytuj `/opt/cronmanager/config/scripts.yaml`.

Minimalna konfiguracja — wystarczą trzy pola:

```yaml
scripts:
  - id: moj_skrypt
    name: Mój skrypt backupu
    script_path: /opt/scripts/moj_skrypt.sh
```

Aplikacja **automatycznie wykrywa** z treści skryptu:
- `log_file` — szuka `LOG_FILE=`, `exec >>`, `LOG=`
- `status_file` — szuka `echo $? >`
- `tags` — wykrywa użycie ftp, rsync, tar, mysql, curl itp.

Możesz nadpisać auto-detekcję podając pola ręcznie:

```yaml
scripts:
  - id: moj_skrypt
    name: Mój skrypt backupu
    script_path: /opt/scripts/moj_skrypt.sh
    description: Opis co robi skrypt   # opcjonalne
    log_file: /var/log/scripts/moj.log # opcjonalne — nadpisuje auto-detekcję
    tags:                              # opcjonalne
      - backup
      - logs
```

Po zmianie config zrestartuj usługę:
```bash
systemctl restart cronmanager
```

## Zarządzanie

```bash
# Status
systemctl status cronmanager nginx

# Logi aplikacji
tail -f /opt/cronmanager/logs/app.log

# Restart
systemctl restart cronmanager

# Zmiana hasła
openssl passwd -apr1 "nowehaslo" | xargs -I{} sh -c 'echo "admin:{}" > /etc/nginx/.cronmanager_htpasswd'
systemctl reload nginx
```

## Architektura

```
Przeglądarka
    │ HTTPS + HTTP Basic Auth
    ▼
nginx (port 443)
    ├── pliki statyczne → /opt/cronmanager/src/public/
    └── /api/* → proxy_pass → Node.js (127.0.0.1:3000)
                                  ├── /api/dashboard
                                  ├── /api/crontabs
                                  ├── /api/logs/:scriptId
                                  └── /api/status/:scriptId
```

Node.js czyta:
- `/var/spool/cron/<user>` — crontaby użytkowników (tylko whitelisted)
- `/etc/cron.d/` — systemowe zadania cron
- pliki logów zdefiniowane w `config/scripts.json` (wyłącznie przez whitelist)

## Bezpieczeństwo

- Node.js działa jako użytkownik `cronmanager` (bez shella, izolowany przez systemd)
- Ścieżki plików logów pochodzą **wyłącznie** z `config/scripts.json` — brak path traversal
- Wszystkie `scriptId` walidowane przez whitelist
- HTTP Basic Auth przez nginx, Node.js weryfikuje nagłówek `X-Authenticated: true`
- HTTPS z TLS 1.2/1.3

## Ulepszenia dla skryptów zarządzanych

Dodaj do zarządzanych skryptów:

```bash
# 1. Plik exit code — jednoznaczny status dla dashboardu
echo $? > /var/log/scripts/moj_skrypt.status

# 2. Ustrukturyzowane logi (dashboard koloruje automatycznie)
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$1] $2"; }
log "INFO"  "Start"
log "ERROR" "Błąd połączenia"
log "OK"    "Zakończono"

# 3. Last-run marker
date '+%s' > /var/log/scripts/moj_skrypt.lastrun
```

Szczegóły: `SCRIPT_ANALYSIS.md`
