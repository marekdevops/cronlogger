#!/bin/bash
set -euo pipefail

echo "╔══════════════════════════════════════════╗"
echo "║      CronManager Installer v1.1          ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Weryfikacja systemu ───────────────────────────────
echo "[1/11] Weryfikacja systemu..."
[[ $EUID -eq 0 ]] || { echo "[ERROR] Uruchom jako root (sudo $0)"; exit 1; }

RHEL_VERSION=$(grep -oP '(?<=release )\d+' /etc/redhat-release 2>/dev/null | head -1)
case "$RHEL_VERSION" in
    7|8|9) echo "  OK: RHEL ${RHEL_VERSION} wykryty" ;;
    *) echo "[ERROR] Nieobsługiwany system. Wymagany RHEL 7, 8 lub 9."; echo "  Znaleziono: $(cat /etc/redhat-release)"; exit 1 ;;
esac

# ── 2. Aktywacja repozytoriów ────────────────────────────
echo "[2/11] Aktywacja repozytoriów..."
case "$RHEL_VERSION" in
    7)
        subscription-manager repos \
          --enable=rhel-7-server-rpms \
          --enable=rhel-7-server-extras-rpms \
          --enable=rhel-server-rhscl-7-rpms \
          2>/dev/null || echo "  WARN: subscription-manager nieudane — sprawdź subskrypcję"
        PKG_MGR="yum"
        ;;
    8)
        subscription-manager repos \
          --enable=rhel-8-for-x86_64-baseos-rpms \
          --enable=rhel-8-for-x86_64-appstream-rpms \
          2>/dev/null || echo "  WARN: subscription-manager nieudane — sprawdź subskrypcję"
        PKG_MGR="dnf"
        ;;
    9)
        subscription-manager repos \
          --enable=rhel-9-for-x86_64-baseos-rpms \
          --enable=rhel-9-for-x86_64-appstream-rpms \
          2>/dev/null || echo "  WARN: subscription-manager nieudane — sprawdź subskrypcję"
        PKG_MGR="dnf"
        ;;
esac
echo "  OK: repozytoria skonfigurowane (pkg manager: ${PKG_MGR})"

# ── 3. Instalacja pakietów + konfiguracja Node.js ────────
echo "[3/11] Instalacja pakietów RPM..."
case "$RHEL_VERSION" in
    7)
        # Node.js przez SCL (Red Hat Software Collections)
        if yum --enablerepo=rhel-server-rhscl-7-rpms info rh-nodejs12 &>/dev/null; then
            NODEJS_SCL="rh-nodejs12"
        else
            echo "  INFO: rh-nodejs12 niedostępne, próbuję rh-nodejs10"
            NODEJS_SCL="rh-nodejs10"
        fi
        yum install -y nginx "${NODEJS_SCL}" openssl cronie acl
        NODE_BIN="/opt/rh/${NODEJS_SCL}/root/usr/bin/node"
        SCL_PREFIX="${NODEJS_SCL%nodejs*}${NODEJS_SCL##*rh-}"  # np. rh-nodejs12
        echo "  OK: zainstalowano nginx, ${NODEJS_SCL}, openssl, cronie"
        ;;
    8)
        # Node.js przez AppStream module — preferuj nowszy
        dnf module enable -y nodejs:18 2>/dev/null || dnf module enable -y nodejs:16 2>/dev/null || true
        dnf install -y nginx nodejs openssl cronie acl
        NODE_BIN="/usr/bin/node"
        echo "  OK: zainstalowano nginx, nodejs (AppStream), openssl, cronie"
        ;;
    9)
        dnf module enable -y nodejs:20 2>/dev/null || dnf module enable -y nodejs:18 2>/dev/null || true
        dnf install -y nginx nodejs openssl cronie acl
        NODE_BIN="/usr/bin/node"
        echo "  OK: zainstalowano nginx, nodejs (AppStream), openssl, cronie"
        ;;
esac

# ── 4. Weryfikacja Node.js ───────────────────────────────
echo "[4/11] Weryfikacja Node.js..."
"${NODE_BIN}" --version \
  || { echo "[ERROR] Node.js nie działa: ${NODE_BIN}"; exit 1; }
echo "  OK: $("${NODE_BIN}" --version) (${NODE_BIN})"

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
cp deploy/cronmanager.conf /etc/nginx/conf.d/cronmanager.conf

# Generuj plik service dostosowany do wykrytej wersji RHEL
if [[ "$RHEL_VERSION" == "7" ]]; then
    # RHEL 7 — wymaga zmiennych środowiskowych SCL
    SCL_LIB_DIR="/opt/rh/${NODEJS_SCL}/root/usr/lib64"
    SCL_MOD_DIR="/opt/rh/${NODEJS_SCL}/root/usr/lib/node_modules"
    SCL_BIN_DIR="/opt/rh/${NODEJS_SCL}/root/usr/bin"
    cat > /etc/systemd/system/cronmanager.service <<EOF
[Unit]
Description=CronManager Web Application (Node.js — RHEL 7 SCL)
Documentation=file:///opt/cronmanager/README.md
After=network.target
Requires=network.target

[Service]
Type=simple
User=cronmanager
Group=cronmanager
WorkingDirectory=/opt/cronmanager

# SCL ${NODEJS_SCL} — zmienne środowiskowe wymagane na RHEL 7
Environment="PATH=${SCL_BIN_DIR}:/usr/local/bin:/usr/bin:/bin"
Environment="LD_LIBRARY_PATH=${SCL_LIB_DIR}"
Environment="NODE_ENV=production"
Environment="NODE_PATH=${SCL_MOD_DIR}"

ExecStart=${NODE_BIN} src/server.js
Restart=always
RestartSec=5
TimeoutStopSec=10

StandardOutput=append:/opt/cronmanager/logs/app.log
StandardError=append:/opt/cronmanager/logs/app.log

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadOnlyPaths=/
ReadWritePaths=/opt/cronmanager/logs

[Install]
WantedBy=multi-user.target
EOF
    echo "  OK: service wygenerowany (RHEL 7, SCL ${NODEJS_SCL})"
else
    # RHEL 8/9 — standardowy /usr/bin/node
    cp deploy/cronmanager.service /etc/systemd/system/cronmanager.service
    echo "  OK: service zainstalowany (RHEL ${RHEL_VERSION}, ${NODE_BIN})"
fi

nginx -t || { echo "[ERROR] Błędna konfiguracja nginx"; exit 1; }
echo "  OK: nginx config sprawdzony"

# ── 10. ACL — dostęp do logów skryptów ──────────────────
echo "[10/11] Konfiguracja ACL dla logów skryptów..."
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
echo "║  Instalacja zakonczona! (RHEL ${RHEL_VERSION})                       ║"
printf "║  URL:  https://%-38s║\n" "$(hostname -s)"
echo "║  User: admin                                         ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Status:  systemctl status cronmanager nginx         ║"
echo "║  Logi:    tail -f /opt/cronmanager/logs/app.log      ║"
echo "║  Config:  /opt/cronmanager/config/scripts.json       ║"
echo "╚══════════════════════════════════════════════════════╝"
