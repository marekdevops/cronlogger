'use strict';

const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../config/scripts.json');

let _config = null;

function load() {
    if (_config) return _config;

    let raw;
    try {
        raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    } catch (err) {
        throw new Error(`Nie można odczytać config/scripts.json: ${err.message}`);
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error(`Błędny JSON w config/scripts.json: ${err.message}`);
    }

    // Podstawowa walidacja
    if (!parsed.app || !Array.isArray(parsed.scripts)) {
        throw new Error('config/scripts.json: brak sekcji "app" lub "scripts"');
    }
    for (const s of parsed.scripts) {
        if (!s.id || !s.log_file) {
            throw new Error(`config/scripts.json: wpis bez "id" lub "log_file": ${JSON.stringify(s)}`);
        }
    }

    _config = parsed;
    return _config;
}

/**
 * Pobierz wartość konfiguracji przez dot-notation.
 * Przykład: get('app.port', 3000)
 */
function get(key, defaultValue) {
    const cfg = load();
    const parts = key.split('.');
    let val = cfg;
    for (const p of parts) {
        if (val == null || typeof val !== 'object') return defaultValue;
        val = val[p];
    }
    return val !== undefined ? val : defaultValue;
}

/** Zwróć tablicę wszystkich dozwolonych scriptId */
function getScriptIds() {
    return load().scripts.map(s => s.id);
}

/** Zwróć config jednego skryptu lub null */
function getScript(id) {
    return load().scripts.find(s => s.id === id) || null;
}

/** Zwróć wszystkie skrypty */
function getScripts() {
    return load().scripts;
}

/** Przeładuj config (przydatne w testach) */
function reload() {
    _config = null;
    return load();
}

module.exports = { get, getScriptIds, getScript, getScripts, reload };
