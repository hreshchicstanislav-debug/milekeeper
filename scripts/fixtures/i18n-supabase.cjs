/** Local auth/REST fixture. Service data is read-only and never reaches Supabase. */
const http = require('http');
exports.createFixture = function createFixture() {
    const uid = '00000000-0000-4000-8000-000000000001', sid = '00000000-0000-4000-8000-000000000002';
    const enc = v => Buffer.from(JSON.stringify(v)).toString('base64url');
    const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'fixture@example.test', app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: {}, identities: [], created_at: '2026-01-01T00:00:00Z' };
    const token = enc({ alg: 'HS256', typ: 'JWT' }) + '.' + enc({ sub: uid, role: 'authenticated', aud: 'authenticated', session_id: sid, exp: Math.floor(Date.now() / 1000) + 36000 }) + '.' + Buffer.from('fixture-signature').toString('base64url');
    const session = { access_token: token, refresh_token: 'fixture-refresh-token', expires_in: 36000, expires_at: Math.floor(Date.now() / 1000) + 36000, token_type: 'bearer', user };
    const id = '00000000-0000-4000-8000-000000000010';
    const items = [{ id, user_id: uid, title: 'Моё масло двигателя', interval_km: 10000, interval_days: null, notify_before_days: 30, notify_before_km: null, measurement_mode: 'km', note: 'Моя заметка — не переводить', is_active: true, created_at: '2026-01-01T00:00:00Z' }, { id: '00000000-0000-4000-8000-000000000011', user_id: uid, title: 'Brake fluid', interval_km: null, interval_days: 365, notify_before_days: 30, notify_before_km: null, measurement_mode: 'calendar', note: null, is_active: true, created_at: '2026-01-01T00:00:00Z' }];
    const odometer = Array.from({ length: 10 }, (_, i) => ({ id: `reading-${i}`, user_id: uid, mileage_km: 120000 - i * 500, occurred_at: new Date(Date.now() - i * 7 * 86400000).toISOString(), note: i === 0 ? 'Личная запись' : null, created_at: new Date(Date.now() - i * 7 * 86400000).toISOString() }));
    const events = [{ id: 'event-1', user_id: uid, service_item_id: id, mileage_km: 112000, occurred_at: '2026-07-01T09:00:00Z', created_at: '2026-07-01T09:00:00Z', note: 'Пользовательский комментарий' }];
    const server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3101');
        res.setHeader('Access-Control-Allow-Headers', 'authorization,apikey,content-type,x-client-info,x-supabase-api-version');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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
        else if (url.pathname === '/auth/v1/token')
            data = session;
        else if (url.pathname === '/auth/v1/authorize') {
            const callback = new URL('http://localhost:3101/auth/callback');
            callback.hash = new URLSearchParams({ access_token: token, refresh_token: session.refresh_token, expires_in: String(session.expires_in), token_type: 'bearer' }).toString();
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
            const rows = table === 'odometer_entries' ? odometer : table === 'service_items' ? items : table === 'service_events' ? events : [];
            if (req.method !== 'GET') {
                res.writeHead(405);
                res.end(JSON.stringify({ message: 'Fixture is read-only' }));
                return;
            }
            data = rows;
            if (url.searchParams.get('service_item_id')?.startsWith('eq.'))
                data = data.filter(r => r.service_item_id === url.searchParams.get('service_item_id').slice(3));
            if (url.searchParams.get('limit'))
                data = data.slice(0, Number(url.searchParams.get('limit')));
            if (req.headers.accept?.includes('vnd.pgrst.object'))
                data = data[0] ?? null;
        }
        else {
            res.writeHead(404);
            data = { error: 'Fixture endpoint not found' };
        }
        res.end(JSON.stringify(data));
    });
    return { server, session, id, items };
};
