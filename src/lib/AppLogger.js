'use strict';

const fs   = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '../../logs/app.log');

function write(level, message) {
    const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
    try {
        fs.appendFileSync(LOG_PATH, line);
    } catch (_) {
        // Nie możemy logować błędu logowania — wypisz na stderr
        process.stderr.write(line);
    }
}

function info(msg)  { write('INFO',  msg); }
function warn(msg)  { write('WARN',  msg); }
function error(msg) { write('ERROR', msg); }

module.exports = { info, warn, error };
