/** Local synthetic auth/REST fixture; read-only by default, optional in-memory writes. Never reaches Supabase. */
const http = require('http');
const crypto = require('crypto');
/** Minimal PostgREST semantics for the filters the app sends (eq, lt, in, order, limit). */
const timeColumns = new Set(['occurred_at', 'created_at']);
function cell(row, column) { return timeColumns.has(column) ? Date.parse(row[column]) : row[column]; }
function operand(row, column, raw) {
    if (timeColumns.has(column)) return Date.parse(raw);
    return typeof row[column] === 'number' ? Number(raw) : raw;
}
function applyQuery(rows, params) {
    let data = rows;
    for (const [column, expression] of params) {
        if (['select', 'order', 'limit', 'offset', 'columns'].includes(column)) continue;
        const dot = expression.indexOf('.');
        const op = expression.slice(0, dot), raw = expression.slice(dot + 1);
        if (op === 'eq') data = data.filter(r => (timeColumns.has(column) ? cell(r, column) === Date.parse(raw) : String(r[column]) === raw));
        else if (op === 'lt') data = data.filter(r => cell(r, column) < operand(r, column, raw));
        else if (op === 'in') { const values = raw.replace(/^\(|\)$/g, '').split(',').map(v => v.replace(/^"|"$/g, '')); data = data.filter(r => values.includes(String(r[column]))); }
    }
    const order = params.get('order');
    if (order) {
        const keys = order.split(',').map(part => { const [column, direction] = part.split('.'); return [column, direction !== 'desc']; });
        data = [...data].sort((a, b) => {
            for (const [column, ascending] of keys) {
                const x = cell(a, column), y = cell(b, column);
                if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1);
            }
            return 0;
        });
    }
    if (params.get('limit')) data = data.slice(0, Number(params.get('limit')));
    return data;
}
exports.createFixture = function createFixture(options = {}) {
    const uid = '00000000-0000-4000-8000-000000000001', sid = '00000000-0000-4000-8000-000000000002';
    const enc = v => Buffer.from(JSON.stringify(v)).toString('base64url');
    const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'fixture@example.test', app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: {}, identities: [], created_at: '2026-01-01T00:00:00Z' };
    const LIFETIME = 36000, MIN_REMAINING = 3600;
    const mint = () => {
        const exp = Math.floor(Date.now() / 1000) + LIFETIME;
        return { exp, jwt: enc({ alg: 'HS256', typ: 'JWT' }) + '.' + enc({ sub: uid, role: 'authenticated', aud: 'authenticated', session_id: sid, exp }) + '.' + Buffer.from('fixture-signature').toString('base64url') };
    };
    const first = mint();
    const session = { access_token: first.jwt, refresh_token: 'fixture-refresh-token', expires_in: LIFETIME, expires_at: first.exp, token_type: 'bearer', user };
    /** Like real Supabase, never hand out an expired access token: a long-running fixture re-mints the JWT in place
     *  (same object, so callers holding `fixture.session` see it) once less than an hour of lifetime remains. */
    const freshSession = () => {
        const remaining = session.expires_at - Math.floor(Date.now() / 1000);
        if (remaining < MIN_REMAINING) {
            const next = mint();
            session.access_token = next.jwt;
            session.expires_at = next.exp;
        }
        session.expires_in = Math.max(1, session.expires_at - Math.floor(Date.now() / 1000));
        return session;
    };
    const id = '00000000-0000-4000-8000-000000000010';
    let items = [{ id, user_id: uid, title: 'Моё масло двигателя', interval_km: 10000, interval_days: null, notify_before_days: 30, notify_before_km: null, measurement_mode: 'km', note: 'Моя заметка — не переводить', is_active: true, created_at: '2026-01-01T00:00:00Z' }, { id: '00000000-0000-4000-8000-000000000011', user_id: uid, title: 'Brake fluid', interval_km: null, interval_days: 365, notify_before_days: 30, notify_before_km: null, measurement_mode: 'calendar', note: null, is_active: true, created_at: '2026-01-01T00:00:00Z' }];
    let odometer = Array.from({ length: 10 }, (_, i) => ({ id: `reading-${i}`, user_id: uid, mileage_km: 120000 - i * 500, occurred_at: new Date(Date.now() - i * 7 * 86400000).toISOString(), note: i === 0 ? 'Личная запись' : null, created_at: new Date(Date.now() - i * 7 * 86400000).toISOString() }));
    let events = [{ id: '00000000-0000-4000-8000-0000000000e1', user_id: uid, service_item_id: id, mileage_km: 112000, occurred_at: '2026-07-01T09:00:00Z', created_at: '2026-07-01T09:00:00Z', note: 'Пользовательский комментарий', kind: 'replacement', amount_liters: null }];
    const original = { items, odometer, events };
    /** 23 records of all kinds, with equal dates and mileages, for paging and intervals. */
    const mixedEvents = () => Array.from({ length: 23 }, (_, i) => {
        const kind = i % 5 === 0 ? 'replacement' : i % 2 ? 'check' : 'top_up';
        const day = 1 + Math.floor(i / 2);
        return { id: `00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`, user_id: uid, service_item_id: id, kind,
            amount_liters: kind === 'top_up' ? 0.25 * (1 + (i % 3)) : null, mileage_km: 100000 + day * 400,
            occurred_at: new Date(Date.UTC(2026, 0, day * 7, 9)).toISOString(), created_at: '2026-01-01T00:00:00Z',
            note: kind === 'check' && i % 3 === 0 ? 'Уровень в норме' : null };
    });
    let authScenario = 'ok', generation = 0;
    let failedTable = null;
    function setScenario(name) {
        failedTable = name.startsWith('error-') ? name.slice(6) : null;
        odometer = name === 'empty' ? [] : name === 'ready' || name.startsWith('error-') ? original.odometer : original.odometer.slice(0, 1);
        items = ['empty', 'odometer'].includes(name) ? [] : name === 'calendar' ? [original.items[1]] : original.items.slice(0, 1);
        events = ['empty', 'odometer', 'item'].includes(name) ? [] : name === 'calendar'
            ? [{ ...original.events[0], service_item_id: original.items[1].id }] : name === 'mixed' ? mixedEvents() : [...original.events];
        if (name === 'mixed') odometer = [...original.odometer];
    }
    const server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3101');
        res.setHeader('Access-Control-Allow-Headers', 'authorization,apikey,content-type,x-client-info,x-supabase-api-version');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        let data;
        const url = new URL(req.url, 'http://localhost:54329');
        if (url.pathname === '/auth/v1/user')
            data = user;
        else if (url.pathname === '/auth/v1/token') {
            if (authScenario !== 'ok') {
                res.writeHead(authScenario === 'invalid' ? 400 : 503);
                res.end(JSON.stringify({ code: authScenario === 'invalid' ? 'refresh_token_not_found' : 'unexpected_failure' }));
                return;
            }
            if (options.rotateAuth) session.refresh_token = 'fixture-refresh-' + (++generation);
            data = freshSession();
        }
        else if (url.pathname === '/auth/v1/authorize') {
            const callback = new URL('http://localhost:3101/auth/callback');
            const fresh = freshSession();
            callback.hash = new URLSearchParams({ access_token: fresh.access_token, refresh_token: fresh.refresh_token, expires_in: String(fresh.expires_in), token_type: 'bearer' }).toString();
            res.writeHead(302, { Location: callback.href });
            res.end();
            return;
        }
        else if (url.pathname === '/auth/v1/logout') {
            res.writeHead(204);
            res.end();
            return;
        }
        else if (url.pathname.startsWith('/rest/v1/')) {
            const table = url.pathname.split('/').pop();
            if (table === failedTable) {
                res.writeHead(500); res.end(JSON.stringify({ message: 'Injected local load failure', code: 'FIXTURE' })); return;
            }
            const rows = table === 'odometer_entries' ? odometer : table === 'service_items' ? items : table === 'service_events' ? events : [];
            if (options.mutable && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                    const values = [].concat(JSON.parse(body));
                    // Column defaults of the real schema.
                    const defaults = table === 'service_events' ? { kind: 'replacement', amount_liters: null, note: null } : {};
                    const created = values.map(value => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...defaults, ...value }));
                    rows.unshift(...created);
                    res.writeHead(201); res.end(JSON.stringify(req.headers.accept?.includes('vnd.pgrst.object') ? created[0] : created));
                });
                return;
            }
            if (options.mutable && req.method === 'DELETE') {
                const removed = applyQuery(rows, url.searchParams);
                for (const row of removed) rows.splice(rows.indexOf(row), 1);
                res.writeHead(200); res.end(JSON.stringify(removed));
                return;
            }
            if (req.method !== 'GET') {
                res.writeHead(405);
                res.end(JSON.stringify({ message: 'Fixture is read-only' }));
                return;
            }
            data = applyQuery(rows, url.searchParams);
            if (req.headers.accept?.includes('vnd.pgrst.object'))
                data = data[0] ?? null;
        }
        else {
            res.writeHead(404);
            data = { error: 'Fixture endpoint not found' };
        }
        res.end(JSON.stringify(data));
    });
    return { server, session, freshSession, id, items, get events() { return events; }, get odometer() { return odometer; }, setAuthScenario(name) { authScenario = name; }, ...(options.mutable ? { setScenario } : {}) };
};
