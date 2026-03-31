'use strict';

const os             = require('os');
const config         = require('../lib/ConfigLoader');
const statusResolver = require('../lib/StatusResolver');
const appLog         = require('../lib/AppLogger');

/**
 * GET /api/dashboard
 * Zwraca podsumowanie statusów wszystkich zarządzanych skryptów.
 */
async function handler(req, res) {
    try {
        const scripts = config.getScripts();

        const results = await Promise.all(scripts.map(async (s) => {
            let statusInfo;
            try {
                statusInfo = await statusResolver.resolve(s);
            } catch (err) {
                appLog.error(`dashboard: błąd resolve dla ${s.id}: ${err.message}`);
                statusInfo = { status: 'UNKNOWN', lastRun: null, message: 'Błąd wewnętrzny' };
            }
            return {
                id:          s.id,
                name:        s.name,
                description: s.description,
                tags:        s.tags || [],
                schedule:    null, // wypełniane przez crontab match jeśli dostępny
                status:      statusInfo.status,
                lastRun:     statusInfo.lastRun ? statusInfo.lastRun.toISOString() : null,
                message:     statusInfo.message,
            };
        }));

        const counts = { OK: 0, FAILED: 0, UNKNOWN: 0 };
        for (const r of results) {
            counts[r.status] = (counts[r.status] || 0) + 1;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            ok:   true,
            data: {
                hostname: os.hostname(),
                uptime:   Math.floor(os.uptime()),
                counts,
                scripts:  results,
            },
        }));
    } catch (err) {
        appLog.error(`dashboard handler: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Błąd serwera' }));
    }
}

module.exports = { handler };
