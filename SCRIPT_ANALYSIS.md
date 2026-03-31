# SCRIPT_ANALYSIS.md — Analiza skryptu `logs_template.sh`

## Opis skryptu (1–3 zdania)

Skrypt wyszukuje pliki logów zmodyfikowane w ciągu ostatnich 14 dni w skonfigurowanym katalogu źródłowym,
kopiuje je do katalogu tymczasowego, pakuje do archiwum `tar.gz` z timestampem w nazwie, a następnie
przesyła archiwum przez FTP z szyfrowaniem TLS na zdalny serwer. Po udanej wysyłce archiwum jest usuwane
lokalnie; skrypt używa blokady plikowej aby zapobiec równoległemu uruchomieniu.

---

## Zmienne konfiguracyjne

| Zmienna | Przykładowa wartość | Opis |
|---|---|---|
| `FTP_HOST` | `ftp.chujumuju.pl` | Adres hosta serwera FTP |
| `FTP_USER` | `LOG` | Nazwa użytkownika FTP |
| `FTP_PASS` | `******` | Hasło FTP (ukryte w szablonie) |
| `FTP_REMOTE_DIR` | `/ZDALNY/` | Katalog docelowy na serwerze FTP |
| `FTP_PARALLEL` | `5` | Liczba równoległych transferów (zdefiniowana, ale nieużywana) |
| `search_dir` | `/logi/` | Katalog źródłowy do przeszukiwania plików logów |
| `local_mirror_dir` | `/ścieżka/do/lokalnego/katalogu` | Katalog do trybu pełnego mirrora (zakomentowany) |
| `LOCK_FILE` | `${SCRIPT_DIR}/tmp/${SCRIPT_NAME}.lock` | Plik blokady zapobiegający duplikatom |
| `LOG_FILE` | `${SCRIPT_DIR}/out/${SCRIPT_NAME}.out` | Plik wyjściowy logów skryptu (stdout+stderr) |
| `TMP_LOGS_DIR` | `${SCRIPT_DIR}/tmp/${SCRIPT_NAME}_tmp.XXXXXX` | Tymczasowy katalog na znalezione pliki (mktemp) |
| `CLEANUP_SAFE` | `false` | Flaga — czy bezpiecznie usunąć katalog tymczasowy w cleanup() |

---

## Przepływ wykonania

1. `cleanup_old_lock()` — usuwa plik blokady starszy niż 1440 minut (1 dzień)
2. Sprawdzenie blokady — exit 1 jeśli `$LOCK_FILE` istnieje
3. Przekierowanie stdout+stderr do `$LOG_FILE` (`exec >> ... 2>&1`)
4. Rejestracja `trap cleanup EXIT TERM INT`
5. `main()`:
   - Tworzy `$LOCK_FILE`
   - `find_recent_files()` — `find ${search_dir} -type f -mtime -14`
   - `cp` znalezionych plików do `$TMP_LOGS_DIR`
   - `pack_logs()` — `tar -czf` do `${SCRIPT_DIR}/tmp/logs_YYYY-MM-DD_HH-MM.tar.gz`
     - Ścieżka archiwum zwracana przez deskryptor fd3
   - `send_file_to_ftp()` — `lftp` z TLS force, `put` pojedynczego pliku
   - Usunięcie archiwum po udanej wysyłce
   - Ustawienie `CLEANUP_SAFE=true`, usunięcie `$LOCK_FILE`

---

## Gdzie skrypt zapisuje logi

- **Plik logu**: `${SCRIPT_DIR}/out/${SCRIPT_NAME}.out`
  - Wszystkie stdout i stderr przekierowane przez `exec >> "${LOG_FILE}" 2>&1` na początku
  - Format wpisów: plain text z `echo`, brak ustrukturyzowanego formatu
  - Separator sekcji: linia `==============================================`
  - Nagłówek z datą startu, PID, katalogiem tymczasowym
  - Stopka z datą zakończenia

- **Brak pliku statusu exit code** — skrypt nie zapisuje exit code do pliku
- **Brak pliku `.lastrun`** z timestampem startu

Dla dashboardu: `StatusResolver` musi używać keyword-scan ostatnich linii logu.

---

## Sugestie ulepszeń (dokumentacja — nie implementować automatycznie)

### 1. Exit code file — jednoznaczny status dla dashboardu

```bash
# Na końcu main() lub w trap cleanup:
SCRIPT_EXIT=$?
echo "$SCRIPT_EXIT" > "${SCRIPT_DIR}/out/${SCRIPT_NAME}.status"
exit $SCRIPT_EXIT
```

Zamiast keyword-scanningu dashboard może po prostu sprawdzić: `"0"` → OK, inne → FAIL.

### 2. Ustrukturyzowane logi z poziomem i timestampem

```bash
log() {
    local level="$1"; local msg="$2"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [${level}] ${msg}" | tee -a "$LOG_FILE"
}
log "INFO"  "Rozpoczynam backup: $search_dir"
log "ERROR" "Blad polaczenia FTP: $FTP_HOST"
log "OK"    "Transfer zakonczony: $archive_name"
```

Dashboard może automatycznie kolorować linie `[ERROR]` na czerwono, `[OK]` na zielono, `[WARN]` na żółto.

### 3. PID file — ochrona przed duplicate run (alternatywa dla prostego lock file)

```bash
PIDFILE="${SCRIPT_DIR}/tmp/${SCRIPT_NAME}.pid"
[ -f "$PIDFILE" ] && kill -0 "$(cat $PIDFILE)" 2>/dev/null && {
    log "WARN" "Skrypt juz dziala (PID: $(cat $PIDFILE))"
    exit 1
}
echo $$ > "$PIDFILE"
trap "rm -f '$PIDFILE'" EXIT
```

Pozwala dashboardowi sprawdzić czy skrypt aktualnie działa (`kill -0 <pid>`).

### 4. Last-run marker z timestampem

```bash
# Na początku main():
date '+%s' > "${SCRIPT_DIR}/out/${SCRIPT_NAME}.lastrun"
```

Dashboard może pokazać dokładny czas ostatniego startu niezależnie od treści logu.

### 5. Poprawki w istniejącym kodzie (błędy)

- **`pack_logs()` wywoływana dwukrotnie** (linie 191–193): raz przez `pack_logs "${TMP_LOGS_DIR}"`
  (wynik do /dev/null przez exec 3>&1) i drugi raz przez podstawienie procesu. Powoduje podwójne
  tworzenie archiwum. Należy użyć jednego wywołania z fd3 od początku.
- **`FTP_PARALLEL=5`** — zdefiniowana ale nieużywana w `lftp` komendach.
- **`set -eo pipefail`** zakomentowane — błędy w potokach nie przerywają skryptu.
- **`cp ... ${RECENT_FILES}`** bez cudzysłowów — problemy gdy ścieżki zawierają spacje.

---

## Konfiguracja w `config/scripts.json`

Na podstawie analizy, proponowane wartości dla pierwszego wpisu:

```json
{
  "id": "logs_template",
  "name": "Backup i transfer logów",
  "description": "Wyszukuje pliki logów zmodyfikowane w ciągu ostatnich 14 dni, pakuje je do archiwum tar.gz i przesyła przez FTP z szyfrowaniem TLS na zdalny serwer.",
  "script_path": "/opt/scripts/logs_template.sh",
  "log_file": "/opt/scripts/out/logs_template.out",
  "status_file": "/opt/scripts/out/logs_template.status",
  "cron_user": "root",
  "tags": ["backup", "ftp", "logs", "tar"]
}
```

> **Uwaga**: `log_file` wskazuje na `${SCRIPT_DIR}/out/logs_template.out` gdzie `SCRIPT_DIR`
> to katalog skryptu. Jeśli skrypt jest w `/opt/scripts/`, log będzie w `/opt/scripts/out/logs_template.out`.
