#!/bin/bash
set -euo pipefail

echo "╔══════════════════════════════════════════╗"
echo "║      CronManager Installer v1.0          ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Weryfikacja systemu ───────────────────────────────
echo "[1/11] Weryfikacja systemu..."
grep -q "Red Hat Enterprise Linux Server release 7" /etc/redhat-release \
  || { echo "[ERROR] Wymaga RHEL 7. Znaleziono: $(cat /etc/redhat-release)"; exit 1; }
[[ $EUID -eq 0 ]] || { echo "[ERROR] Uruchom jako root (sudo $0)"; exit 1; }
echo "  OK: RHEL 7, uruchomiono jako root"

# ── 2. Aktywacja repozytoriów RHSCL ─────────────────────
echo "[2/11] Aktywacja repozytoriów..."
subscription-manager repos \
  --enable=rhel-7-server-extras-rpms \
  --enable=rhel-server-rhscl-7-rpms \
  || { echo "[WARN] subscription-manager nieudane — sprawdź czy repozytoria są dostępne"; }

# ── 3. Instalacja pakietów ───────────────────────────────
echo "[3/11] Instalacja pakietów RPM..."
# Sprawdź czy rh-nodejs12 jest dostępne, fallback na nodejs10
if yum --enablerepo=rhel-server-rhscl-7-rpms info rh-nodejs12 &>/dev/null; then
    NODEJS_PKG="rh-nodejs12"
    NODEJS_PATH="/opt/rh/rh-nodejs12/root/usr/bin/node"
else
    echo "  INFO: rh-nodejs12 niedostępne, używam rh-nodejs10"
    NODEJS_PKG="rh-nodejs10"
    NODEJS_PATH="/opt/rh/rh-nodejs10/root/usr/bin/node"
fi

yum install -y nginx "${NODEJS_PKG}" openssl cronie
echo "  OK: zainstalowano nginx, ${NODEJS_PKG}, openssl, cronie"

# Zaktualizuj ścieżkę w pliku service jeśli używamy nodejs10
if [[ "$NODEJS_PKG" == "rh-nodejs10" ]]; then
    sed -i 's|rh-nodejs12|rh-nodejs10|g' deploy/cronmanager.service
fi

# ── 4. Weryfikacja Node.js ───────────────────────────────
echo "[4/11] Weryfikacja Node.js..."
"${NODEJS_PATH}" --version \
  || { echo "[ERROR] Node.js SCL nie działa: ${NODEJS_PATH}"; exit 1; }
echo "  OK: $("${NODEJS_PATH}" --version)"

# ── 5. Tworzenie użytkownika systemowego ─────────────────
echo "[5/11] Tworzenie użytkownika cronmanager..."
useradd -r -s /sbin/nologin -d /opt/cronmanager cronmanager 2>/dev/null \
  && echo "  OK: użytkownik cronmanager utworzony" \
  || echo "  INFO: użytkownik cronmanager już istnieje"

# ── 6. Deploy plików aplikacji ───────────────────────────
echo "[6/11] Instalacja plików aplikacji..."
mkdir -p /opt/cronmanager
cp -r src config package.json /opt/cronmanager/
mkdir -p /opt/cronmanager/logs
chown -R cronmanager:cronmanager /opt/cronmanager
chmod -R 750 /opt/cronmanager
chmod 640 /opt/cronmanager/config/scripts.json
echo "  OK: pliki zainstalowane w /opt/cronmanager"

# ── 7. SSL self-signed cert ──────────────────────────────
echo "[7/11] Generowanie certyfikatu SSL..."
mkdir -p /etc/nginx/ssl
if [[ ! -f /etc/nginx/ssl/cronmanager.crt ]]; then
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout /etc/nginx/ssl/cronmanager.key \
      -out    /etc/nginx/ssl/cronmanager.crt \
      -subj   "/CN=$(hostname)/O=Internal/C=PL" 2>/dev/null
    chmod 600 /etc/nginx/ssl/cronmanager.key
    echo "  OK: cert wygenerowany dla $(hostname)"
else
    echo "  INFO: cert już istnieje — pomijam generowanie"
fi

# ── 8. htpasswd ──────────────────────────────────────────
echo "[8/11] Konfiguracja HTTP Basic Auth..."
echo ""
read -sp "  Podaj haslo administratora (user: admin): " ADMIN_PASSWD; echo
HASH=$(openssl passwd -apr1 "$ADMIN_PASSWD")
echo "admin:${HASH}" > /etc/nginx/.cronmanager_htpasswd
chmod 640 /etc/nginx/.cronmanager_htpasswd
chown root:nginx /etc/nginx/.cronmanager_htpasswd
echo "  OK: htpasswd skonfigurowane"

# ── 9. Konfiguracja nginx i systemd ─────────────────────
echo "[9/11] Instalacja konfiguracji nginx i systemd..."
cp deploy/cronmanager.conf    /etc/nginx/conf.d/cronmanager.conf
cp deploy/cronmanager.service /etc/systemd/system/cronmanager.service
nginx -t || { echo "[ERROR] Błędna konfiguracja nginx — sprawdź /etc/nginx/conf.d/cronmanager.conf"; exit 1; }
echo "  OK: nginx config sprawdzony"

# ── 10. ACL — dostęp do logów skryptów ──────────────────
echo "[10/11] Konfiguracja ACL dla logów skryptów..."
# Odczytaj ścieżki logów z config/scripts.json (prosta ekstrakcja grep)
LOG_DIRS=$(grep '"log_file"' /opt/cronmanager/config/scripts.json \
           | sed 's/.*"log_file":[[:space:]]*"\(.*\)".*/\1/' \
           | xargs -I{} dirname {} | sort -u)

for dir in $LOG_DIRS; do
    if [[ -d "$dir" ]]; then
        setfacl -R -m u:cronmanager:r-x "$dir" 2>/dev/null \
          && echo "  OK: ACL ustawione na $dir" \
          || echo "  WARN: setfacl nieudane dla $dir — ręcznie nadaj uprawnienia"
    else
        echo "  WARN: katalog logów nie istnieje: $dir — utwórz go i nadaj uprawnienia użytkownikowi cronmanager"
    fi
done

# ── 11. Start usług ──────────────────────────────────────
echo "[11/11] Uruchamianie usług..."
systemctl daemon-reload
systemctl enable --now cronmanager
systemctl enable --now nginx
echo "  OK: usługi uruchomione"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Instalacja zakonczona!                              ║"
printf "║  URL:  https://%-38s║\n" "$(hostname -s)"
echo "║  User: admin                                         ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Status:  systemctl status cronmanager nginx         ║"
echo "║  Logi:    tail -f /opt/cronmanager/logs/app.log      ║"
echo "║  Config:  /opt/cronmanager/config/scripts.json       ║"
echo "╚══════════════════════════════════════════════════════╝"
