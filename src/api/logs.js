'use strict';

const config    = require('../lib/ConfigLoader');
const logReader = require('../lib/LogReader');
const appLog    = require('../lib/AppLogger');

/**
 * GET /api/logs/:scriptId
 * Zwraca ostatnie 200 linii logu skryptu.
 */
async function handler(req, res, parsedUrl, params) {
    const scriptId = params.scriptId;

    // Whitelist — tylko scriptId z config
    const allowedIds = config.getScriptIds();
    if (!allowedIds.includes(scriptId)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Forbidden' }));
        return;
    }

    const scriptConfig = config.getScript(scriptId);
    // Ścieżka logu pochodzi wyłącznie z config — nie od użytkownika
    const logPath = scriptConfig.log_file;

    try {
        const stat  = await logReader.fileStat(logPath);
        const lines = await logReader.tailLines(logPath, 200);

        if (lines === null) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok:   true,
                data: {
                    scriptId,
                    name:         scriptConfig.name,
                    logFile:      scriptConfig.log_file,
                    exists:       false,
                    lines:        [],
                    lastModified: null,
                    size:         null,
                },
            }));
            return;
        }

        // Klasyfikuj każdą linię
        const classified = lines.map(line => ({
            text:  line,
            level: logReader.classifyLine(line),
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            ok:   true,
            data: {
                scriptId,
                name:         scriptConfig.name,
                logFile:      scriptConfig.log_file,
                exists:       true,
                lines:        classified,
                lastModified: stat ? stat.mtime.toISOString() : null,
                size:         stat ? stat.size : null,
            },
        }));
    } catch (err) {
        appLog.error(`logs handler [${scriptId}]: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Błąd odczytu logu' }));
    }
}

module.exports = { handler };
