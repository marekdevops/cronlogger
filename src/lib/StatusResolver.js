'use strict';

const fs        = require('fs');
const logReader = require('./LogReader');
const config    = require('./ConfigLoader');
const appLog    = require('./AppLogger');

/**
 * Zdeterminuj status skryptu.
 * Kolejność priorytetu:
 *   1. Plik .status (exit code file) — "0" → OK, inne → FAILED
 *   2. Keyword scan ostatnich 20 linii logu
 *   3. mtime logu starszy niż STALE_THRESHOLD → UNKNOWN
 *   4. Plik logu nie istnieje → UNKNOWN
 *
 * Zwraca: { status: 'OK'|'FAILED'|'UNKNOWN', lastRun: Date|null, message: String }
 */
async function resolve(scriptConfig) {
    const staleHours = config.get('app.status_stale_hours', 48);
    const STALE_THRESHOLD_MS = staleHours * 60 * 60 * 1000;

    // --- 1. Plik .status (opcjonalny) ---
    if (scriptConfig.status_file) {
        try {
            const raw = fs.readFileSync(scriptConfig.status_file, 'utf8').trim();
            const stat = await logReader.fileStat(scriptConfig.status_file);
            const lastRun = stat ? stat.mtime : null;

            if (raw === '0') {
                return { status: 'OK', lastRun, message: 'Exit code: 0' };
            } else {
                return { status: 'FAILED', lastRun, message: `Exit code: ${raw}` };
            }
        } catch (err) {
            if (err.code !== 'ENOENT') {
                // Nieoczekiwany błąd — loguj ale kontynuuj fallback
                appLog.warn(`StatusResolver: błąd odczytu status_file dla ${scriptConfig.id}: ${err.message}`);
            }
            // ENOENT — plik statusu nie istnieje, przejdź do fallbacku
        }
    }

    // --- 2 & 3 & 4. Analiza pliku logu ---
    const logStat = await logReader.fileStat(scriptConfig.log_file);

    if (!logStat) {
        return { status: 'UNKNOWN', lastRun: null, message: 'Plik logu nie istnieje' };
    }

    const lastRun = logStat.mtime;
    const ageMs   = Date.now() - lastRun.getTime();

    if (ageMs > STALE_THRESHOLD_MS) {
        const hours = Math.round(ageMs / 3600000);
        return {
            status:  'UNKNOWN',
            lastRun,
            message: `Log nie był modyfikowany od ${hours}h (próg: ${staleHours}h)`,
        };
    }

    // Keyword scan
    const lines = await logReader.tailLines(scriptConfig.log_file, 20);
    if (!lines || lines.length === 0) {
        return { status: 'UNKNOWN', lastRun, message: 'Log jest pusty' };
    }

    // Skanuj od końca — ostatnie informacje są ważniejsze
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].toUpperCase();
        if (/\b(ERROR|FAILED|FAILURE|CRITICAL|BLAD)\b/.test(line)) {
            return { status: 'FAILED', lastRun, message: 'Znaleziono błąd w logu' };
        }
        if (/\b(SUCCESS|COMPLETED|OK|DONE|ZAKOŃCZONO|ZAKONCZONO|SUKCES)\b/.test(line)) {
            return { status: 'OK', lastRun, message: 'Wykonanie zakończone sukcesem' };
        }
        // Specyficzne dla logs_template.sh
        if (/Transfer FTP zakończony sukcesem/i.test(lines[i])) {
            return { status: 'OK', lastRun, message: 'Transfer FTP zakończony sukcesem' };
        }
        if (/Zakończenie skryptu:/i.test(lines[i])) {
            return { status: 'OK', lastRun, message: 'Skrypt zakończył się normalnie' };
        }
    }

    return { status: 'UNKNOWN', lastRun, message: 'Nie można określić statusu z logu' };
}

module.exports = { resolve };
