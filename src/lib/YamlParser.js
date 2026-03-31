'use strict';

/**
 * Minimalny parser YAML dla prostego schematu konfiguracji.
 *
 * Obsługuje:
 *   - obiekty zagnieżdżone (wcięcia 2-spacje)
 *   - listy wartości skalarnych (- value)
 *   - listy obiektów (- key: value / dalsze klucze z wcięciem)
 *   - skalary: string, number, boolean, null
 *   - wartości w cudzysłowach (pojedynczych i podwójnych)
 *   - komentarze (#)
 *
 * NIE obsługuje: multiline strings, anchors (&/*), flow style ({}/[])
 */

function parseScalar(val) {
    if (val === 'true')              return true;
    if (val === 'false')             return false;
    if (val === 'null' || val === '~') return null;
    if (/^-?\d+$/.test(val))         return parseInt(val, 10);
    if (/^-?\d+\.\d+$/.test(val))    return parseFloat(val);
    // Usuń cudzysłowy
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
        return val.slice(1, -1);
    }
    return val;
}

function getIndent(line) {
    return line.match(/^(\s*)/)[1].length;
}

function parse(text) {
    // Usuń komentarze inline, puste linie i pełne komentarze
    const lines = text.split('\n')
        .map(l => l.replace(/\s+#.*$/, '').trimEnd())
        .filter(l => l.trim() !== '' && !l.trim().startsWith('#'));

    let i = 0;

    function peek()    { return i < lines.length ? lines[i] : null; }
    function consume() { return lines[i++]; }

    function parseObject(baseIndent) {
        const obj = {};
        while (i < lines.length) {
            const line = peek();
            if (!line) break;
            const indent = getIndent(line);
            if (indent < baseIndent) break;
            if (indent > baseIndent) break;
            const trimmed = line.trim();
            if (trimmed.startsWith('- ') || trimmed === '-') break;

            consume();

            // Znajdź ': ' (nie mylić z ':' w ścieżkach bez spacji)
            const colonIdx = trimmed.indexOf(': ');
            const colonEnd  = trimmed.endsWith(':') && !trimmed.slice(0, -1).includes(': ');

            if (colonIdx < 0 && !colonEnd) continue; // pomiń złe linie

            let key, restVal;
            if (colonIdx >= 0) {
                key     = trimmed.slice(0, colonIdx);
                restVal = trimmed.slice(colonIdx + 2).trim();
            } else {
                key     = trimmed.slice(0, -1);
                restVal = '';
            }

            if (restVal === '') {
                const nextLine = peek();
                if (!nextLine) { obj[key] = null; continue; }
                const nextIndent = getIndent(nextLine);
                if (nextIndent <= baseIndent) { obj[key] = null; continue; }
                obj[key] = nextLine.trim().startsWith('- ')
                    ? parseList(nextIndent)
                    : parseObject(nextIndent);
            } else {
                obj[key] = parseScalar(restVal);
            }
        }
        return obj;
    }

    function parseList(baseIndent) {
        const arr = [];
        while (i < lines.length) {
            const line = peek();
            if (!line) break;
            const indent = getIndent(line);
            if (indent < baseIndent) break;
            const trimmed = line.trim();
            if (!trimmed.startsWith('- ') && trimmed !== '-') break;

            consume();
            const content = trimmed.startsWith('- ') ? trimmed.slice(2).trim() : '';

            if (content === '') {
                // Obiekt na kolejnych liniach
                const nextLine = peek();
                arr.push(nextLine ? parseObject(getIndent(nextLine)) : {});
                continue;
            }

            const colonIdx = content.indexOf(': ');
            const colonEnd  = content.endsWith(':') && !content.slice(0, -1).includes(': ');

            if (colonIdx >= 0 || colonEnd) {
                // Pierwszy klucz obiektu wewnątrz listy
                let key, val;
                if (colonIdx >= 0) {
                    key = content.slice(0, colonIdx);
                    val = content.slice(colonIdx + 2).trim();
                    val = val !== '' ? parseScalar(val) : null;
                } else {
                    key = content.slice(0, -1);
                    val = null;
                }

                const obj       = { [key]: val };
                const propIndent = baseIndent + 2;

                // Parsuj pozostałe właściwości obiektu
                while (i < lines.length) {
                    const nextLine = peek();
                    if (!nextLine) break;
                    if (getIndent(nextLine) < propIndent) break;
                    if (nextLine.trim().startsWith('- '))  break;

                    consume();
                    const pt       = nextLine.trim();
                    const pColonIdx = pt.indexOf(': ');
                    const pColonEnd = pt.endsWith(':') && !pt.slice(0, -1).includes(': ');

                    if (pColonIdx >= 0) {
                        const pKey   = pt.slice(0, pColonIdx);
                        const pRest  = pt.slice(pColonIdx + 2).trim();
                        if (pRest === '') {
                            const nn = peek();
                            if (nn) {
                                const ni = getIndent(nn);
                                obj[pKey] = nn.trim().startsWith('- ')
                                    ? parseList(ni) : parseObject(ni);
                            } else { obj[pKey] = null; }
                        } else {
                            obj[pKey] = parseScalar(pRest);
                        }
                    } else if (pColonEnd) {
                        const pKey = pt.slice(0, -1);
                        const nn   = peek();
                        if (nn) {
                            const ni = getIndent(nn);
                            obj[pKey] = nn.trim().startsWith('- ')
                                ? parseList(ni) : parseObject(ni);
                        } else { obj[pKey] = null; }
                    }
                }

                // Jeśli pierwszy val był null i następne linie to kontynuacja — już obsłużone
                if (val === null && obj[key] === null) {
                    const nn = peek();
                    if (nn && getIndent(nn) === propIndent && !nn.trim().startsWith('- ')) {
                        obj[key] = parseObject(propIndent);
                    }
                }

                arr.push(obj);
            } else {
                arr.push(parseScalar(content));
            }
        }
        return arr;
    }

    return parseObject(0);
}

module.exports = { parse };
