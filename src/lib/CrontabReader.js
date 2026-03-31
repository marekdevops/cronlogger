'use strict';

const fs      = require('fs');
const path    = require('path');
const config  = require('./ConfigLoader');

const CRON_SPOOL_DIR = '/var/spool/cron';
const CRON_D_DIR     = '/etc/cron.d';

/**
 * Parsuj pojedynczą linię crontab użytkownika (5 pól schedule + command).
 * Zwraca obiekt lub null dla komentarzy / pustych linii.
 */
function parseLine(line, user) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return null;

    // Obsługa zmiennych środowiskowych (np. MAILTO=...)
    if (/^\s*\w+=/.test(trimmed)) return null;

    // Obsługa @reboot, @daily itp.
    const atMatch = trimmed.match(/^(@\w+)\s+(.+)$/);
    if (atMatch) {
        return {
            user,
            schedule: atMatch[1],
            command:  atMatch[2].trim(),
            raw:      trimmed,
        };
    }

    // Standardowy format: minuta godzina dzień miesiąc tydzień komenda
    const parts = trimmed.split(/\s+/);
    if (parts.length < 6) return null;

    return {
        user,
        schedule: parts.slice(0, 5).join(' '),
        command:  parts.slice(5).join(' '),
        raw:      trimmed,
    };
}

/**
 * Parsuj linię z /etc/cron.d/ — dodatkowe pole username między schedule a command.
 * Format: minuta godzina dzień miesiąc tydzień username komenda
 */
function parseCronDLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return null;
    if (/^\s*\w+=/.test(trimmed)) return null;

    const atMatch = trimmed.match(/^(@\w+)\s+(\S+)\s+(.+)$/);
    if (atMatch) {
        return {
            user:     atMatch[2],
            schedule: atMatch[1],
            command:  atMatch[3].trim(),
            raw:      trimmed,
        };
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length < 7) return null;

    return {
        user:     parts[5],
        schedule: parts.slice(0, 5).join(' '),
        command:  parts.slice(6).join(' '),
        raw:      trimmed,
    };
}

/**
 * Odczytaj crontab konkretnego użytkownika z /var/spool/cron/<username>.
 * Zwraca tablicę wpisów.
 */
function readUserCrontab(username) {
    // Sanitacja: tylko litery, cyfry, myślnik, podkreślenie, kropka
    if (!/^[\w.\-]+$/.test(username)) {
        throw new Error(`Niedozwolona nazwa użytkownika: ${username}`);
    }

    const filePath = path.join(CRON_SPOOL_DIR, username);
    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }

    const entries = [];
    for (const line of content.split('\n')) {
        const entry = parseLine(line, username);
        if (entry) entries.push(entry);
    }
    return entries;
}

/**
 * Przeszukaj /etc/cron.d/ i zwróć wpisy ze wszystkich plików.
 */
function readCronD() {
    let files;
    try {
        files = fs.readdirSync(CRON_D_DIR);
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }

    const entries = [];
    for (const filename of files) {
        // Pomiń pliki z niedozwolonymi znakami (np. pliki z '.')
        if (!/^[\w\-]+$/.test(filename)) continue;

        const filePath = path.join(CRON_D_DIR, filename);
        let content;
        try {
            const stat = fs.statSync(filePath);
            if (!stat.isFile()) continue;
            content = fs.readFileSync(filePath, 'utf8');
        } catch (_) {
            continue;
        }

        for (const line of content.split('\n')) {
            const entry = parseCronDLine(line);
            if (entry) {
                entries.push({ ...entry, source: filename });
            }
        }
    }
    return entries;
}

/**
 * Oznacz wpisy należące do zarządzanych skryptów.
 * Porównuje ścieżki komend z script_path z config.
 */
function markManagedEntries(entries, managedScripts) {
    return entries.map(entry => {
        const matched = managedScripts.find(s => {
            // Komenda może zawierać argumenty — sprawdzamy czy zawiera ścieżkę skryptu
            return entry.command.includes(s.script_path);
        });
        return {
            ...entry,
            isManaged:  !!matched,
            managedId:  matched ? matched.id : null,
            managedName: matched ? matched.name : null,
        };
    });
}

/**
 * Główna funkcja — zwraca wszystkie wpisy cron z obu źródeł.
 */
async function readAll() {
    const allowedUsers = config.get('app.cron_users', ['root']);
    const managedScripts = config.getScripts();

    // Wpisy użytkowników z /var/spool/cron/
    const userEntries = [];
    for (const user of allowedUsers) {
        const entries = readUserCrontab(user);
        userEntries.push(...entries.map(e => ({ ...e, source: `crontab:${user}` })));
    }

    // Wpisy z /etc/cron.d/
    const cronDEntries = readCronD().map(e => ({
        ...e,
        source: e.source ? `cron.d:${e.source}` : 'cron.d',
    }));

    const all = markManagedEntries([...userEntries, ...cronDEntries], managedScripts);
    return {
        userEntries:  all.filter(e => e.source.startsWith('crontab:')),
        cronDEntries: all.filter(e => e.source.startsWith('cron.d')),
    };
}

module.exports = { readAll, parseLine, parseCronDLine, markManagedEntries };
