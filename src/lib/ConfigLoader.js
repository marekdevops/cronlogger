'use strict';

const fs       = require('fs');
const path     = require('path');
const yaml     = require('./YamlParser');
const analyzer = require('./ScriptAnalyzer');

const YAML_PATH = path.join(__dirname, '../../config/scripts.yaml');

let _config = null;

// ── Ładowanie i walidacja ────────────────────────────────────────────────────

function load() {
    if (_config) return _config;

    let raw;
    try {
        raw = fs.readFileSync(YAML_PATH, 'utf8');
    } catch (err) {
        throw new Error(`Nie można odczytać config/scripts.yaml: ${err.message}`);
    }

    let parsed;
    try {
        parsed = yaml.parse(raw);
    } catch (err) {
        throw new Error(`Błędny YAML w config/scripts.yaml: ${err.message}`);
    }

    if (!parsed || !parsed.app || !Array.isArray(parsed.scripts)) {
        throw new Error('config/scripts.yaml: brak sekcji "app" lub "scripts"');
    }

    // Wzbogać każdy wpis o auto-wykryte dane ze skryptu
    parsed.scripts = parsed.scripts.map(enrich);

    // Walidacja po wzbogaceniu
    for (const s of parsed.scripts) {
        if (!s.id)       throw new Error(`scripts.yaml: wpis bez "id": ${JSON.stringify(s)}`);
        if (!s.log_file) throw new Error(`scripts.yaml [${s.id}]: brak "log_file" i auto-detekcja nieudana`);
    }

    _config = parsed;
    return _config;
}

/**
 * Uzupełnij brakujące pola wpisu skryptu przez analizę pliku .sh.
 * Pola podane ręcznie w YAML mają zawsze pierwszeństwo.
 */
function enrich(script) {
    const detected = script.script_path ? analyzer.analyze(script.script_path) : {};

    return {
        // Wymagane
        id:          script.id,
        name:        script.name        || script.id,
        script_path: script.script_path || null,
        // Auto-wykrywane — ręczny override ma pierwszeństwo
        log_file:    script.log_file    || detected.log_file    || null,
        status_file: script.status_file || detected.status_file || null,
        tags:        script.tags        || detected.tags         || [],
        // Opcjonalne
        description: script.description || '',
        cron_user:   script.cron_user   || null,
    };
}

// ── Publiczne API ────────────────────────────────────────────────────────────

function get(key, defaultValue) {
    const cfg    = load();
    const parts  = key.split('.');
    let val      = cfg;
    for (const p of parts) {
        if (val == null || typeof val !== 'object') return defaultValue;
        val = val[p];
    }
    return val !== undefined ? val : defaultValue;
}

function getScriptIds()  { return load().scripts.map(s => s.id); }
function getScript(id)   { return load().scripts.find(s => s.id === id) || null; }
function getScripts()    { return load().scripts; }
function reload()        { _config = null; return load(); }

module.exports = { get, getScriptIds, getScript, getScripts, reload };
