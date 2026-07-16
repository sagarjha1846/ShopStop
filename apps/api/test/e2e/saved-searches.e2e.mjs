// Saved searches: create → list → run (re-executes stored query) → delete → 404.
const B = 'http://localhost:4000/api/v1';
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
async function j(m, p, { token, body } = {}) {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
}
const AT = (await j('POST', '/auth/register', { body: { email: `ss_${Date.now()}@example.com`, password: 'sspass123456' } })).data.accessToken;
const ss = await j('POST', '/saved-searches', { token: AT, body: { name: 'Cheap phones', q: 'phone', maxPrice: 9000000 } });
ok('create', ss.status === 201 && ss.data.params.q === 'phone');
const id = ss.data.id;
ok('list', (await j('GET', '/saved-searches', { token: AT })).data.length >= 1);
const run = await j('GET', `/saved-searches/${id}/run`, { token: AT });
ok('run returns results', Array.isArray(run.data.items));
ok('delete', (await j('DELETE', `/saved-searches/${id}`, { token: AT })).status === 204);
ok('run after delete -> 404', (await j('GET', `/saved-searches/${id}/run`, { token: AT })).status === 404);
ok('unauth -> 401', (await j('GET', '/saved-searches')).status === 401);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
