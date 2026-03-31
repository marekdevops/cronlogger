'use strict';

const config         = require('../lib/ConfigLoader');
const statusResolver = require('../lib/StatusResolver');
const appLog         = require('../lib/AppLogger');

/**
 * GET /api/status/:scriptId
 * Zwraca status wykonania jednego skryptu.
 */
async function handler(req, res, parsedUrl, params) {
    const scriptId = params.scriptId;

    const allowedIds = config.getScriptIds();
    if (!allowedIds.includes(scriptId)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Forbidden' }));
        return;
    }

    const scriptConfig = config.getScript(scriptId);

    try {
        const statusInfo = await statusResolver.resolve(scriptConfig);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            ok:   true,
            data: {
                scriptId,
                name:    scriptConfig.name,
                status:  statusInfo.status,
                lastRun: statusInfo.lastRun ? statusInfo.lastRun.toISOString() : null,
                message: statusInfo.message,
            },
        }));
    } catch (err) {
        appLog.error(`status handler [${scriptId}]: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Błąd serwera' }));
    }
}

module.exports = { handler };
