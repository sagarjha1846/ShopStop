import { io } from 'socket.io-client';
const API = 'http://localhost:4000/api/v1';
const WS = 'http://localhost:4000/rt';
const RUN = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
async function j(method, path, { token, body } = {}) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await res.json(); } catch {}
  return { status: res.status, data: d };
}
const login = async (e, p) => (await j('POST', '/auth/login', { body: { email: e, password: p } })).data.accessToken;
// Each suite sells as its own freshly-registered account. Sharing one seller across
// suites makes them collide: the risk engine holds a seller who posts 10+ listings in
// an hour, and a full pass creates roughly that many, so a second pass would land every
// listing in PENDING_REVIEW instead of ACTIVE.
const seller = (await j('POST', '/auth/register', { body: { email: `real_seller_${RUN}@example.com`, password: 'sellerpassword1', displayName: 'Test Seller' } })).data.accessToken;
const buyer = (await j('POST', '/auth/register', { body: { email: `rtbuyer_${RUN}@example.com`, password: 'rtbuyerpass1' } })).data.accessToken;
const cats = (await j('GET', '/categories')).data;
const catId = cats.find((c) => c.slug === 'electronics').children.find((c) => c.slug === 'mobile-phones').id;
const listing = (await j('POST', '/listings', { token: seller, body: { categoryId: catId, title: `RT Phone ${RUN}`, description: 'realtime test listing here', priceMinor: 500000, attributes: { brand: 'B', model: 'M', storage: '128GB' }, publish: true } })).data;
const thread = (await j('POST', '/threads', { token: buyer, body: { listingId: listing.id } })).data;
const socket = io(WS, { auth: { token: buyer }, transports: ['websocket'] });
const received = new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('timeout')), 6000); socket.on('message:new', (m) => { clearTimeout(t); resolve(m); }); });
await new Promise((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); setTimeout(() => reject(new Error('connect timeout')), 5000); });
ok('socket connected + authenticated', socket.connected);
const joinAck = await socket.emitWithAck('thread:join', thread.id);
ok('joined thread room (participant check)', joinAck?.ok === true);
const badJoin = await socket.emitWithAck('thread:join', 'nonexistent-thread');
ok('join rejected for non-participant', badJoin?.ok === false);
await j('POST', `/threads/${thread.id}/messages`, { token: seller, body: { kind: 'TEXT', body: `live hello ${RUN}` } });
try { const m = await received; ok('received message:new over socket', m?.body === `live hello ${RUN}`); } catch (e) { ok('received message:new over socket', false, e.message); }
const anon = io(WS, { transports: ['websocket'] });
const anonRejected = await new Promise((resolve) => { anon.on('disconnect', () => resolve(true)); setTimeout(() => resolve(!anon.connected), 2000); });
ok('unauthenticated socket rejected', anonRejected === true);
socket.close(); anon.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
