'use strict';

const { URL } = require('url');

const routes = new Map();

function register(method, pattern, handler) {
    routes.set(`${method}:${pattern}`, handler);
}

/**
 * Prosta dopasowanie wzorca — obsługuje statyczne ścieżki i segmenty z ':param'.
 * Zwraca { matched: bool, params: {} }
 */
function matchRoute(pattern, pathname) {
    const patternParts  = pattern.split('/');
    const pathnameParts = pathname.split('/');

    if (patternParts.length !== pathnameParts.length) return { matched: false, params: {} };

    const params = {};
    for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].startsWith(':')) {
            params[patternParts[i].slice(1)] = decodeURIComponent(pathnameParts[i]);
        } else if (patternParts[i] !== pathnameParts[i]) {
            return { matched: false, params: {} };
        }
    }
    return { matched: true, params };
}

function notFound(req, res) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
}

function dispatch(req, res) {
    let parsedUrl;
    try {
        parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (_) {
        notFound(req, res);
        return;
    }

    const pathname = parsedUrl.pathname;

    // Szukaj najpierw dokładnego dopasowania
    const exactKey = `${req.method}:${pathname}`;
    if (routes.has(exactKey)) {
        return routes.get(exactKey)(req, res, parsedUrl, {});
    }

    // Szukaj wzorców z parametrami
    for (const [key, handler] of routes) {
        const [routeMethod, pattern] = key.split(/:(.+)/);
        if (routeMethod !== req.method) continue;
        const { matched, params } = matchRoute(pattern, pathname);
        if (matched) {
            return handler(req, res, parsedUrl, params);
        }
    }

    notFound(req, res);
}

module.exports = { register, dispatch };
