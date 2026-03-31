'use strict';

const http      = require('http');
const router    = require('./router');
const config    = require('./lib/ConfigLoader');
const appLog    = require('./lib/AppLogger');

// Rejestracja endpointów API
const dashboard = require('./api/dashboard');
const crontabs  = require('./api/crontabs');
const logs      = require('./api/logs');
const status    = require('./api/status');

router.register('GET', '/api/dashboard',         dashboard.handler);
router.register('GET', '/api/crontabs',          crontabs.handler);
router.register('GET', '/api/logs/:scriptId',    logs.handler);
router.register('GET', '/api/status/:scriptId',  status.handler);

const PORT = config.get('app.port', 3000);
const HOST = '127.0.0.1'; // nginx proxuje — Node słucha tylko lokalnie

const server = http.createServer((req, res) => {
    // nginx ustawia ten nagłówek po pomyślnej autentykacji HTTP Basic Auth
    if (req.headers['x-authenticated'] !== 'true') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
    }

    // Loguj każde żądanie
    const user = req.headers['x-remote-user'] || 'unknown';
    appLog.info(`${req.method} ${req.url} (user: ${user}, ip: ${req.headers['x-real-ip'] || req.socket.remoteAddress})`);

    router.dispatch(req, res);
});

server.on('error', (err) => {
    appLog.error(`Server error: ${err.message}`);
    process.exit(1);
});

server.listen(PORT, HOST, () => {
    appLog.info(`CronManager listening on ${HOST}:${PORT}`);
    console.log(`[${new Date().toISOString()}] CronManager listening on ${HOST}:${PORT}`);
});

// Graceful shutdown
function shutdown(signal) {
    appLog.info(`Otrzymano ${signal} — zamykanie serwera`);
    server.close(() => {
        appLog.info('Serwer zamknięty');
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
