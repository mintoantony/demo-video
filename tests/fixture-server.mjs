// The fixture app's tiny server. Serves tests/fixture-app and a cookie-protected portal under /app/.
// Binds 127.0.0.1, not localhost (::1 trouble on some PCs). State lives in memory only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture-app');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const people = { Ada: { name: 'Ada Fixture', role: 'manager' }, Ben: { name: 'Ben Sample', role: 'staff' } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PUBLIC_APP = new Set(['/app/signin.html', '/app/app.js', '/app/portal.css']);
const COOKIE = /(?:^|;\s*)fixture_session=([a-f0-9]+)/;

export async function startFixtureServer({ slowApiMs = 2500 } = {}) {
  const state = { sessions: new Map(), submissions: [], signIns: 0, signOuts: 0 };
  const json = (res, code, body, extra = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...extra }); res.end(JSON.stringify(body)); };
  const sessionOf = (req) => {
    const m = COOKIE.exec(req.headers.cookie || '');
    return m ? state.sessions.get(m[1]) || null : null;
  };
  const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });

  function sendFile(res, p) {
    const f = path.join(appDir, path.normalize(p));
    if (!f.startsWith(appDir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'text/plain' });
    res.end(fs.readFileSync(f));
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname === '/' ? '/index.html' : u.pathname;
    if (p.startsWith('/api/')) {
      const me = sessionOf(req);
      if (p === '/api/signin' && req.method === 'POST') {
        const who = people[u.searchParams.get('name')];
        if (!who) return json(res, 400, { error: 'unknown person' });
        const id = Math.random().toString(16).slice(2) + Date.now().toString(16);
        state.sessions.set(id, who); state.signIns += 1;
        return json(res, 200, who, { 'set-cookie': `fixture_session=${id}; HttpOnly; Path=/; SameSite=Lax` });
      }
      if (p === '/api/signout' && req.method === 'POST') {
        const m = COOKIE.exec(req.headers.cookie || '');
        if (m) state.sessions.delete(m[1]);
        state.signOuts += 1;
        return json(res, 200, { ok: true }, { 'set-cookie': 'fixture_session=; HttpOnly; Path=/; Max-Age=0' });
      }
      if (!me) return json(res, 401, { error: 'not signed in' });
      if (p === '/api/me') return json(res, 200, me);
      if (p === '/api/caps') { await sleep(800); return json(res, 200, { views: me.role === 'manager' ? ['home', 'reports', 'team'] : ['home', 'reports'] }); }
      if (p === '/api/report') { await sleep(slowApiMs); return json(res, 200, { text: 'The monthly report is ready: 4 requests this month.' }); }
      if (p === '/api/request' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        const rec = { id: state.submissions.length + 1, plant: String(body.plant || ''), note: String(body.note || ''), by: me.name };
        state.submissions.push(rec);
        return json(res, 200, rec);
      }
      if (p === '/api/request/last') return json(res, 200, state.submissions[state.submissions.length - 1] || null);
      if (p === '/api/request/count') return json(res, 200, { count: state.submissions.length });
      return json(res, 404, { error: 'no such api' });
    }
    if (p === '/slow.html') await sleep(7000); // the deliberately slow page
    if (p === '/app' || p.startsWith('/app/')) {
      let file = p;
      if (p === '/app' || p === '/app/') file = '/app/index.html';
      else if (!path.extname(p)) file = '/app/index.html'; // client-side routes: /app/reports, /app/team
      if (!PUBLIC_APP.has(file) && !sessionOf(req)) { res.writeHead(302, { location: '/app/signin.html' }); res.end(); return; }
      return sendFile(res, file);
    }
    return sendFile(res, p);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, state, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
