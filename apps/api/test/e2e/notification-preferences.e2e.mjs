// Black-box E2E for the notification preference centre (docs/03 §7).
// Proves the preferences actually gate delivery — not just that they persist.
// Run: node apps/api/test/e2e/notification-preferences.e2e.mjs   (API on :4000)
const B = 'http://localhost:4000/api/v1';
const RUN = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
async function j(method, path, { token, body } = {}) {
  const res = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await res.json(); } catch {}
  return { status: res.status, data: d };
}
const login = async (e, p) => (await j('POST', '/auth/login', { body: { email: e, password: p } })).data.accessToken;

const seller = await login('admin@shopstop.local', 'AdminPass123!');
const buyer = (await j('POST', '/auth/register', { body: { email: `prefs_${RUN}@example.com`, password: 'prefspass1234' } })).data.accessToken;

// --- 1. defaults -------------------------------------------------------------
const initial = (await j('GET', '/me/notification-preferences', { token: seller })).data;
ok('returns the full taxonomy', Array.isArray(initial) && initial.length === 6, `n=${initial?.length}`);
const messages = initial?.find((p) => p.category === 'messages');
ok('messages defaults: in-app on, email off', messages?.inApp === true && messages?.email === false, JSON.stringify(messages));
const marketing = initial?.find((p) => p.category === 'marketing');
ok('marketing is opt-in on both channels', marketing?.inApp === false && marketing?.email === false, JSON.stringify(marketing));
const security = initial?.find((p) => p.category === 'security');
ok('security is reported as locked', security?.locked === true && security?.inApp === true, JSON.stringify(security));

// --- 2. muting a category actually suppresses delivery -----------------------
const cats = (await j('GET', '/categories')).data;
const catId = cats.find((c) => c.slug === 'electronics').children.find((c) => c.slug === 'mobile-phones').id;
const listing = (await j('POST', '/listings', { token: seller, body: { categoryId: catId, title: `Prefs Phone ${RUN}`, description: 'preference gating test listing', priceMinor: 300000, attributes: { brand: 'B', model: 'M', storage: '128GB' }, publish: true } })).data;
const thread = (await j('POST', '/threads', { token: buyer, body: { listingId: listing.id } })).data;

await j('PATCH', '/me/notification-preferences', { token: seller, body: { preferences: [{ category: 'messages', inApp: false, email: false }] } });
await j('POST', `/threads/${thread.id}/messages`, { token: buyer, body: { kind: 'TEXT', body: `muted ${RUN}` } });
let notifs = (await j('GET', '/notifications', { token: seller })).data;
const mutedSeen = notifs.some((n) => n.type === 'message.new' && n.body?.includes(`muted ${RUN}`));
ok('muted category is not delivered in-app', mutedSeen === false);

// --- 3. re-enabling restores delivery ----------------------------------------
await j('PATCH', '/me/notification-preferences', { token: seller, body: { preferences: [{ category: 'messages', inApp: true, email: false }] } });
await j('POST', `/threads/${thread.id}/messages`, { token: buyer, body: { kind: 'TEXT', body: `unmuted ${RUN}` } });
notifs = (await j('GET', '/notifications', { token: seller })).data;
ok('re-enabled category is delivered again', notifs.some((n) => n.type === 'message.new' && n.body?.includes(`unmuted ${RUN}`)));

// --- 4. muting one category leaves the others alone --------------------------
await j('PATCH', '/me/notification-preferences', { token: seller, body: { preferences: [{ category: 'messages', inApp: false, email: false }] } });
await j('POST', `/threads/${thread.id}/messages`, { token: buyer, body: { kind: 'OFFER', offerMinor: 250000 } });
notifs = (await j('GET', '/notifications', { token: seller })).data;
ok('offers still delivered while messages are muted', notifs.some((n) => n.type === 'offer.received'));

// --- 5. persistence + locked/unknown rejection --------------------------------
const after = (await j('GET', '/me/notification-preferences', { token: seller })).data;
ok('override persists across reads', after.find((p) => p.category === 'messages')?.inApp === false);

const locked = await j('PATCH', '/me/notification-preferences', { token: seller, body: { preferences: [{ category: 'security', inApp: false, email: false }] } });
ok('cannot disable locked security notices', locked.status === 422, `status=${locked.status}`);

const unknown = await j('PATCH', '/me/notification-preferences', { token: seller, body: { preferences: [{ category: 'nope', inApp: false }] } });
ok('unknown category rejected', unknown.status === 422, `status=${unknown.status}`);

const anon = await j('GET', '/me/notification-preferences');
ok('preferences require auth', anon.status === 401, `status=${anon.status}`);

// --- 6. preferences are per-user ---------------------------------------------
const buyerPrefs = (await j('GET', '/me/notification-preferences', { token: buyer })).data;
ok("seller's override does not leak to the buyer", buyerPrefs.find((p) => p.category === 'messages')?.inApp === true);

// --- 7. DSAR export carries the preferences ----------------------------------
const exported = (await j('GET', '/me/export', { token: seller })).data;
ok('DSAR export includes notification preferences', Array.isArray(exported?.notificationPreferences) && exported.notificationPreferences.some((p) => p.category === 'messages'));

// restore defaults so reruns start clean
await j('PATCH', '/me/notification-preferences', { token: seller, body: { preferences: [{ category: 'messages', inApp: true, email: false }] } });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
