'use strict';

/* ═══════════════════════════════════════════════════════
   CronManager — vanilla JS SPA
   Wymaga: ES6, Fetch API, brak zewnętrznych zależności
   ═══════════════════════════════════════════════════════ */

const REFRESH_INTERVAL = 60; // sekundy

const App = {
    currentView:   'dashboard',
    currentScript: null,
    refreshTimer:  null,
    refreshRemaining: REFRESH_INTERVAL,
    hostnameCache: null,

    // ── Inicjalizacja ────────────────────────────────────
    async init() {
        this.startClock();
        this.navigate(location.hash || '#dashboard');
    },

    // ── Routing (hash-based) ─────────────────────────────
    async navigate(hash) {
        const parts = (hash || '#dashboard').replace('#', '').split('/');
        const view  = parts[0] || 'dashboard';

        // Dezaktywuj stare nav-linki
        document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));
        const activeLink = document.querySelector(`.nav-link[data-view="${view}"]`);
        if (activeLink) activeLink.classList.add('active');

        // Ukryj wszystkie widoki, pokaż właściwy
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const viewEl = document.getElementById(`view-${view}`);
        if (viewEl) viewEl.classList.add('active');

        this.currentView = view;
        this.stopRefreshCountdown();

        if (view === 'dashboard') {
            await this.loadDashboard();
            this.startRefreshCountdown();
        } else if (view === 'crontabs') {
            await this.loadCrontabs();
        } else if (view === 'logs') {
            const scriptId = parts[1] || null;
            this.currentScript = scriptId;
            await this.loadLogs(scriptId);
        }
    },

    // ── Dashboard ────────────────────────────────────────
    async loadDashboard() {
        const container = document.getElementById('dash-scripts');
        container.innerHTML = '<div class="loading">Ładowanie danych</div>';

        let data;
        try {
            data = await this.apiFetch('/api/dashboard');
        } catch (err) {
            container.innerHTML = `<div class="log-no-file">[ BŁĄD POŁĄCZENIA: ${this.esc(err.message)} ]</div>`;
            this.setConnectionStatus(false);
            return;
        }

        this.setConnectionStatus(true);
        this.hostnameCache = data.hostname;

        // Nagłówek
        document.getElementById('hdr-hostname').textContent = data.hostname;
        document.getElementById('hdr-uptime').textContent   = this.formatUptime(data.uptime);

        // Liczniki
        document.getElementById('cnt-total').textContent   = data.scripts.length;
        document.getElementById('cnt-ok').textContent      = data.counts.OK      || 0;
        document.getElementById('cnt-fail').textContent    = data.counts.FAILED  || 0;
        document.getElementById('cnt-unknown').textContent = data.counts.UNKNOWN || 0;

        // Tablica skryptów
        if (data.scripts.length === 0) {
            container.innerHTML = '<div class="empty-msg">Brak zarządzanych skryptów w config/scripts.json</div>';
            return;
        }

        container.innerHTML = '';
        for (const script of data.scripts) {
            container.appendChild(this.renderScriptRow(script));
        }
    },

    renderScriptRow(script) {
        const row = document.createElement('div');
        row.className  = 'script-row';
        row.dataset.id = script.id;

        const scheduleText = script.schedule ? this.parseCronHuman(script.schedule) : '—';
        const lastRunText  = script.lastRun   ? this.formatRelativeTime(new Date(script.lastRun)) : '—';

        row.innerHTML = `
          <span class="col-name">${this.esc(script.name)}</span>
          <span class="col-schedule" title="${this.esc(script.schedule || '')}">
            ${this.esc(script.schedule || '—')}
          </span>
          <span class="col-lastrun">${lastRunText}</span>
          <span class="col-status">${this.renderBadge(script.status)}</span>
        `;

        // Rozwijany panel szczegółów
        const detail = document.createElement('div');
        detail.className = 'script-detail';
        detail.style.display = 'none';
        detail.innerHTML = `
          <div class="detail-row">
            <span class="detail-label">ID:</span>
            <span class="detail-value">${this.esc(script.id)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Opis:</span>
            <span class="detail-value">${this.esc(script.description || '—')}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Harmonogram:</span>
            <span class="detail-value">${this.esc(script.schedule || '—')}
              ${script.schedule ? `<span style="color:var(--text-dim)"> (${this.parseCronHuman(script.schedule)})</span>` : ''}
            </span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Status:</span>
            <span class="detail-value">${this.renderBadge(script.status)} ${this.esc(script.message || '')}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Ostatni run:</span>
            <span class="detail-value">${script.lastRun ? new Date(script.lastRun).toLocaleString('pl-PL') : '—'}</span>
          </div>
          <div class="tags">
            ${(script.tags || []).map(t => `<span class="tag">[${this.esc(t)}]</span>`).join('')}
          </div>
          <div>
            <a href="#logs/${this.esc(script.id)}" class="detail-btn">[VIEW LOGS]</a>
          </div>
        `;

        row.addEventListener('click', () => {
            // Zwiń inne
            document.querySelectorAll('.script-detail').forEach(d => {
                if (d !== detail) d.style.display = 'none';
            });
            detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
        });

        const wrapper = document.createElement('div');
        wrapper.style.borderBottom = '1px solid var(--text-muted)';
        wrapper.appendChild(row);
        wrapper.appendChild(detail);
        return wrapper;
    },

    renderBadge(status) {
        if (status === 'OK')      return '<span class="badge badge-ok">[  OK  ]</span>';
        if (status === 'FAILED')  return '<span class="badge badge-fail">[ FAIL ]</span>';
        return '<span class="badge badge-unknown">[  ??  ]</span>';
    },

    // ── Auto-refresh countdown ───────────────────────────
    startRefreshCountdown() {
        this.refreshRemaining = REFRESH_INTERVAL;
        this.updateRefreshBar();

        this.refreshTimer = setInterval(async () => {
            this.refreshRemaining--;
            this.updateRefreshBar();
            if (this.refreshRemaining <= 0) {
                this.refreshRemaining = REFRESH_INTERVAL;
                await this.loadDashboard();
            }
        }, 1000);
    },

    stopRefreshCountdown() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    },

    updateRefreshBar() {
        const countdown = document.getElementById('refresh-countdown');
        const bar       = document.getElementById('refresh-bar');
        if (countdown) countdown.textContent = `${this.refreshRemaining}s`;
        if (bar) {
            const pct = (this.refreshRemaining / REFRESH_INTERVAL) * 100;
            bar.style.setProperty('--progress', `${pct}%`);
        }
    },

    // ── Crontabs ─────────────────────────────────────────
    async loadCrontabs() {
        const userSection  = document.getElementById('ct-user-section');
        const crondSection = document.getElementById('ct-crond-section');
        if (this.hostnameCache) {
            document.getElementById('ct-hostname').textContent = this.hostnameCache;
        }

        userSection.innerHTML  = '<div class="loading">Ładowanie crontabów</div>';
        crondSection.innerHTML = '<div class="loading">Ładowanie /etc/cron.d/</div>';

        let data;
        try {
            data = await this.apiFetch('/api/crontabs');
        } catch (err) {
            userSection.innerHTML  = `<div class="log-no-file">[ BŁĄD: ${this.esc(err.message)} ]</div>`;
            crondSection.innerHTML = '';
            this.setConnectionStatus(false);
            return;
        }

        this.setConnectionStatus(true);
        this.renderCrontabSection(userSection,  data.userEntries,  'Brak wpisów w crontabach użytkowników');
        this.renderCrontabSection(crondSection, data.cronDEntries, 'Brak plików w /etc/cron.d/');
    },

    renderCrontabSection(container, entries, emptyMsg) {
        if (!entries || entries.length === 0) {
            container.innerHTML = `<div class="empty-msg">${emptyMsg}</div>`;
            return;
        }

        container.innerHTML = `
          <div class="cron-table-header">
            <span>USER</span>
            <span>SCHEDULE</span>
            <span>HUMAN READABLE</span>
            <span>COMMAND</span>
            <span>MANAGED</span>
          </div>
          <div class="box-divider"></div>
        `;

        for (const entry of entries) {
            const row = document.createElement('div');
            row.className = 'cron-row';

            const humanSchedule = this.parseCronHuman(entry.schedule || '');
            const managedBadge  = entry.isManaged
                ? `<span class="badge-managed">[MANAGED]</span>`
                : '';

            row.innerHTML = `
              <span class="cron-user">${this.esc(entry.user || '—')}</span>
              <span class="cron-schedule">${this.esc(entry.schedule || '—')}</span>
              <span class="cron-human">${this.esc(humanSchedule)}</span>
              <span class="cron-command">${this.esc(entry.command || '—')}</span>
              <span>${managedBadge}</span>
            `;

            // Klik na managed → przejdź do logów
            if (entry.isManaged && entry.managedId) {
                row.style.cursor = 'pointer';
                row.addEventListener('click', () => {
                    location.hash = `#logs/${entry.managedId}`;
                });
            }

            container.appendChild(row);
        }
    },

    // ── Logs ─────────────────────────────────────────────
    async loadLogs(scriptId) {
        const content = document.getElementById('log-content');
        if (this.hostnameCache) {
            document.getElementById('log-hostname').textContent = this.hostnameCache;
        }

        if (!scriptId) {
            content.innerHTML = '<div class="log-placeholder">Wybierz skrypt z dashboardu aby zobaczyć logi.</div>';
            document.getElementById('log-filepath').textContent = '—';
            document.getElementById('log-title').textContent    = '▌LOGS';
            return;
        }

        content.innerHTML = '<div class="loading">Ładowanie logu</div>';

        let data;
        try {
            data = await this.apiFetch(`/api/logs/${encodeURIComponent(scriptId)}`);
        } catch (err) {
            content.innerHTML = `<div class="log-no-file">[ BŁĄD POŁĄCZENIA: ${this.esc(err.message)} ]</div>`;
            this.setConnectionStatus(false);
            return;
        }

        this.setConnectionStatus(true);
        document.getElementById('log-title').textContent    = `▌LOGS — ${data.name}`;
        document.getElementById('log-filepath').textContent = data.logFile || '—';

        if (data.lastModified) {
            const modified = new Date(data.lastModified);
            document.getElementById('log-modified').textContent =
                `Last modified: ${modified.toLocaleTimeString('pl-PL')} (${this.formatRelativeTime(modified)})`;
        } else {
            document.getElementById('log-modified').textContent = '';
        }

        if (!data.exists) {
            content.innerHTML = `<div class="log-no-file">[ NO LOG FILE FOUND — check config/scripts.json ]<br>Oczekiwana ścieżka: ${this.esc(data.logFile)}</div>`;
            return;
        }

        if (data.lines.length === 0) {
            content.innerHTML = '<div class="log-placeholder">Plik logu jest pusty.</div>';
            return;
        }

        const pre = document.createElement('pre');
        pre.className = 'log-output';

        for (const { text, level } of data.lines) {
            const span = document.createElement('span');
            span.className = `log-line log-${level}`;
            span.textContent = text;
            pre.appendChild(span);
        }

        content.innerHTML = '';
        content.appendChild(pre);

        // Scroll do dołu przy pierwszym załadowaniu
        content.scrollTop = content.scrollHeight;
    },

    async refreshCurrentLog() {
        if (this.currentScript) {
            await this.loadLogs(this.currentScript);
        }
    },

    // ── API fetch ────────────────────────────────────────
    async apiFetch(url) {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        if (!json.ok) {
            throw new Error(json.error || 'Nieznany błąd API');
        }
        return json.data;
    },

    // ── Clock ────────────────────────────────────────────
    startClock() {
        const update = () => {
            const now = new Date();
            const timeStr = now.toLocaleString('pl-PL', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false,
            });
            const clockEl  = document.getElementById('hdr-clock');
            const footerEl = document.getElementById('footer-time');
            if (clockEl)  clockEl.textContent  = timeStr;
            if (footerEl) footerEl.textContent  = timeStr;
        };
        update();
        setInterval(update, 1000);
    },

    // ── Helpers ──────────────────────────────────────────
    setConnectionStatus(ok) {
        const el = document.getElementById('footer-status');
        if (!el) return;
        if (ok) {
            el.textContent  = '● CONNECTED';
            el.style.color  = 'var(--accent-ok)';
        } else {
            el.textContent  = '● DISCONNECTED';
            el.style.color  = 'var(--accent-fail)';
        }
    },

    formatUptime(seconds) {
        const d = Math.floor(seconds / 86400);
        const h = Math.floor((seconds % 86400) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (d > 0) return `${d}d ${h}h ${m}m`;
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    },

    formatRelativeTime(date) {
        if (!date) return '—';
        const diff = Date.now() - date.getTime();
        const mins  = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days  = Math.floor(diff / 86400000);

        if (mins < 1)   return 'przed chwilą';
        if (mins < 60)  return `${mins} min temu`;
        if (hours < 24) return `${hours}h temu`;
        if (days === 1) {
            return `wczoraj o ${date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`;
        }
        return `${days} dni temu`;
    },

    /**
     * Przetłumacz wyrażenie cron na opis po polsku.
     * Obsługuje typowe wzorce.
     */
    parseCronHuman(expr) {
        if (!expr) return '—';

        // Specjalne aliasy
        const aliases = {
            '@reboot':  'przy starcie systemu',
            '@yearly':  'raz w roku',
            '@annually':'raz w roku',
            '@monthly': 'raz w miesiącu',
            '@weekly':  'raz w tygodniu',
            '@daily':   'codziennie',
            '@midnight': 'codziennie o północy',
            '@hourly':  'co godzinę',
        };
        if (aliases[expr]) return aliases[expr];

        const parts = expr.trim().split(/\s+/);
        if (parts.length !== 5) return expr;

        const [min, hour, dom, mon, dow] = parts;

        // co N minut
        if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
            const n = min.slice(2);
            return n === '1' ? 'co minutę' : `co ${n} minut`;
        }

        // co N godzin, o pełnej godzinie
        if (min === '0' && hour.startsWith('*/') && dom === '*' && mon === '*' && dow === '*') {
            const n = hour.slice(2);
            return `co ${n} godzin`;
        }

        // codziennie o HH:MM
        if (dom === '*' && mon === '*' && dow === '*' && !hour.includes('*/') && !min.includes('*/')) {
            const h = hour.padStart(2, '0');
            const m = min.padStart(2, '0');
            return `codziennie o ${h}:${m}`;
        }

        // co godzinę o :MM
        if (hour === '*' && dom === '*' && mon === '*' && dow === '*' && !min.includes('*/')) {
            return `co godzinę o :${min.padStart(2, '0')}`;
        }

        // dni tygodnia
        const dowNames = ['niedz', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'];
        if (dow !== '*' && dom === '*' && mon === '*') {
            const h = hour.padStart(2, '0');
            const m = min.padStart(2, '0');
            const dayName = dowNames[parseInt(dow)] || `dzień ${dow}`;
            return `w ${dayName} o ${h}:${m}`;
        }

        return expr; // fallback — pokaż raw
    },

    /** Escape HTML */
    esc(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    },
};

document.addEventListener('DOMContentLoaded', () => App.init());
window.addEventListener('hashchange', () => App.navigate(location.hash));
