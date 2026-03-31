'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * Analizuje skrypt bash i wykrywa log_file, status_file oraz tagi.
 *
 * Zwraca: { log_file: string|null, status_file: string|null, tags: string[] }
 */
function analyze(scriptPath) {
    let content;
    try {
        content = fs.readFileSync(scriptPath, 'utf8');
    } catch (_) {
        return { log_file: null, status_file: null, tags: [] };
    }

    const scriptDir  = path.dirname(scriptPath);
    const scriptName = path.basename(scriptPath, path.extname(scriptPath));

    // Podstawianie typowych zmiennych bashowych
    function sub(val) {
        return val
            .replace(/\$\{?SCRIPT_DIR\}?/g,  scriptDir)
            .replace(/\$\{?SCRIPT_NAME\}?/g, scriptName)
            .replace(/\$\{?0:-([^}]+)\}?/g,  scriptName) // ${0:-name}
            .replace(/\$\{LOG_DIR\}/g,        path.join(scriptDir, 'out'))
            .replace(/\$\{?LOG_DIR\}?/g,      path.join(scriptDir, 'out'))
            .replace(/["']/g, '')
            .trim();
    }

    // ── Wykrywanie log_file ─────────────────────────────────────────────

    let logFile = null;

    // LOG_FILE="..." lub LOG_FILE=...
    const m1 = content.match(/^[ \t]*LOG_FILE\s*=\s*["']?([^\n"']+)["']?/m);
    if (m1) logFile = sub(m1[1]);

    // exec >> "..." 2>&1
    if (!logFile) {
        const m2 = content.match(/exec\s+>>\s+["']([^"'\n]+)["']\s+2>&1/);
        if (m2) logFile = sub(m2[1]);
    }

    // Zmienne LOG= lub LOGFILE=
    if (!logFile) {
        const m3 = content.match(/^[ \t]*(?:LOG|LOGFILE)\s*=\s*["']?([^\n"']+)["']?/m);
        if (m3) logFile = sub(m3[1]);
    }

    // Fallback: typowa konwencja <script_dir>/out/<script_name>.log
    if (!logFile) {
        const candidate = path.join(scriptDir, 'out', `${scriptName}.log`);
        logFile = candidate; // proponujemy, nawet jeśli nie istnieje
    }

    // ── Wykrywanie status_file ──────────────────────────────────────────

    let statusFile = null;

    // echo $? > "..." lub echo "$?" > ...
    const ms = content.match(/echo\s+["']?\$\??["']?\s*>\s*["']?([^\s"'\n]+)["']?/);
    if (ms) statusFile = sub(ms[1]);

    // Fallback: zamień rozszerzenie logu na .status
    if (!statusFile && logFile) {
        statusFile = logFile.replace(/\.[^.]+$/, '.status');
    }

    // ── Wykrywanie tagów ────────────────────────────────────────────────

    const tags = new Set();

    if (/\blftp\b|\bncftp\b|\bftp\b/i.test(content))              tags.add('ftp');
    if (/\brsync\b/i.test(content))                                tags.add('sync');
    if (/\btar\b.*czf|\.tar\.gz|\.tgz/i.test(content))            tags.add('archive');
    if (/\bzip\b|\bgzip\b|\bbzip2\b|\bxz\b/i.test(content))       tags.add('compress');
    if (/\bmysqldump\b|\bpg_dump\b|\bmongodump\b/i.test(content)) tags.add('database');
    if (/\bcurl\b|\bwget\b/i.test(content))                        tags.add('http');
    if (/\bssh\b|\bscp\b|\bsftp\b/i.test(content))                tags.add('ssh');
    if (/LOG_FILE|\.log\b|exec\s+>>/i.test(content))               tags.add('logs');
    if (/\bfind\b.*-mtime|-mmin/i.test(content))                   tags.add('cleanup');
    if (/\bcp\b|\brsync\b|\bbackup/i.test(content))                tags.add('backup');
    if (/\bsystemctl\b|\bservice\b/i.test(content))                tags.add('service');
    if (/\bsendmail\b|\bmail\b|\bmutt\b/i.test(content))           tags.add('mail');

    return {
        log_file:    logFile,
        status_file: statusFile,
        tags:        [...tags],
    };
}

module.exports = { analyze };
