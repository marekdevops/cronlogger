'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * Zwróć ostatnie N linii pliku bez wczytywania całości do pamięci.
 * Czyta plik od końca w kawałkach (chunk-based reverse read).
 */
async function tailLines(filePath, n = 200) {
    let stat;
    try {
        stat = await fs.promises.stat(filePath);
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }

    if (stat.size === 0) return [];

    const CHUNK_SIZE = 64 * 1024; // 64 KB
    const lines = [];
    let remaining = '';
    let position = stat.size;

    const fd = await fs.promises.open(filePath, 'r');
    try {
        while (position > 0 && lines.length < n) {
            const readSize = Math.min(CHUNK_SIZE, position);
            position -= readSize;

            const buf = Buffer.alloc(readSize);
            await fd.read(buf, 0, readSize, position);
            const chunk = buf.toString('utf8');

            // Dołącz pozostałość z poprzedniej iteracji na koniec chunka
            const combined = chunk + remaining;
            const parts = combined.split('\n');

            // Ostatni element może być niepełną linią — zachowaj na następną iterację
            remaining = parts[0];

            // Dodaj linie od końca (pomijając pierwszy niepełny element)
            for (let i = parts.length - 1; i >= 1; i--) {
                lines.unshift(parts[i]);
                if (lines.length >= n) break;
            }
        }

        // Dodaj ostatnią pozostałość (początek pliku)
        if (lines.length < n && remaining) {
            lines.unshift(remaining);
        }
    } finally {
        await fd.close();
    }

    // Zwróć dokładnie N ostatnich linii (bez pustej ostatniej linii jeśli plik kończy się \n)
    const result = lines.filter((l, i) => {
        if (i === lines.length - 1 && l === '') return false;
        return true;
    });
    return result.slice(-n);
}

/**
 * Zwróć stat pliku { mtime: Date, size: number } lub null jeśli nie istnieje.
 */
async function fileStat(filePath) {
    try {
        const stat = await fs.promises.stat(filePath);
        return { mtime: stat.mtime, size: stat.size };
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
}

/**
 * Klasyfikacja linii logu do poziomu.
 * Zwraca: 'ok' | 'fail' | 'warn' | 'info' | 'plain'
 */
function classifyLine(line) {
    if (!line || line.trim() === '') return 'plain';

    const upper = line.toUpperCase();

    if (/\b(ERROR|FAILED|FAILURE|CRITICAL|BLAD|BŁĄD)\b/.test(upper)) return 'fail';
    if (/\[ERROR\]|\[FAIL\]|\[CRITICAL\]/.test(upper))               return 'fail';

    if (/\b(SUCCESS|COMPLETED|OK|DONE|SUKCES|ZAKONCZONO|ZAKOŃCZONO)\b/.test(upper)) return 'ok';
    if (/\[OK\]|\[SUCCESS\]|\[DONE\]/.test(upper))                   return 'ok';
    if (/Transfer FTP zakończony sukcesem|Archiwum utworzone pomyślnie/.test(line)) return 'ok';

    if (/\b(WARN|WARNING|OSTRZEZENIE|OSTRZEŻENIE)\b/.test(upper)) return 'warn';
    if (/\[WARN\]|\[WARNING\]/.test(upper))                       return 'warn';

    if (/\[INFO\]|\[DEBUG\]/.test(upper)) return 'info';
    if (/^={10,}/.test(line.trim()))      return 'info'; // separator ====
    if (/^Start skryptu:|^Zakończenie skryptu:|^PID procesu:/.test(line)) return 'info';

    return 'plain';
}

module.exports = { tailLines, fileStat, classifyLine };
