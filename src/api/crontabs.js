'use strict';

const crontabReader = require('../lib/CrontabReader');
const appLog        = require('../lib/AppLogger');

/**
 * GET /api/crontabs
 * Zwraca wszystkie wpisy cron z /var/spool/cron i /etc/cron.d/
 */
async function handler(req, res) {
    try {
        const { userEntries, cronDEntries } = await crontabReader.readAll();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            ok:   true,
            data: {
                userEntries,
                cronDEntries,
            },
        }));
    } catch (err) {
        appLog.error(`crontabs handler: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Błąd odczytu crontabów' }));
    }
}

module.exports = { handler };
