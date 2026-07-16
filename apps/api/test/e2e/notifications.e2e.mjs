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
const buyer = (await j('POST', '/auth/register', { body: { email: `notif_${RUN}@example.com`, password: 'notifpass1234' } })).data.accessToken;

const cats = (await j('GET', '/categories')).data;
const catId = cats.find((c) => c.slug === 'electronics').children.find((c) => c.slug === 'mobile-phones').id;
const listing = (await j('POST', '/listings', { token: seller, body: { categoryId: catId, title: `Notif Phone ${RUN}`, description: 'notification test listing', priceMinor: 300000, attributes: { brand: 'B', model: 'M', storage: '128GB' }, publish: true } })).data;

// Buyer messages seller with an offer → seller should get an offer.received notification.
const thread = (await j('POST', '/threads', { token: buyer, body: { listingId: listing.id } })).data;
await j('POST', `/threads/${thread.id}/messages`, { token: buyer, body: { kind: 'OFFER', offerMinor: 250000 } });
const sellerNotifs = (await j('GET', '/notifications?unread=true', { token: seller })).data;
ok('seller notified of offer', Array.isArray(sellerNotifs) && sellerNotifs.some((n) => n.type === 'offer.received'), `types=${sellerNotifs?.map((n) => n.type).slice(0, 3)}`);

// Order flow: buyer orders, seller accepts → buyer should get order.update notification.
const order = (await j('POST', '/orders', { token: buyer, headers: {}, body: { listingId: listing.id } }));
// order create needs idempotency key
const order2 = (await j('POST', '/orders', { token: buyer, body: { listingId: listing.id } }));
let orderId = order.data?.id;
if (!orderId) {
  const withKey = await fetch(B + '/orders', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${buyer}`, 'idempotency-key': `notif-${RUN}` }, body: JSON.stringify({ listingId: listing.id }) });
  orderId = (await withKey.json()).id;
}
await fetch(B + `/orders/${orderId}/transition`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${seller}` }, body: JSON.stringify({ action: 'accept' }) });
const buyerNotifs = (await j('GET', '/notifications', { token: buyer })).data;
ok('buyer notified of order update', Array.isArray(buyerNotifs) && buyerNotifs.some((n) => n.type === 'order.update'), `types=${buyerNotifs?.map((n) => n.type).slice(0, 3)}`);

// unread count + mark all read
const before = (await j('GET', '/notifications/unread-count', { token: buyer })).data;
ok('unread count > 0', before.count > 0, `count=${before.count}`);
await j('POST', '/notifications/read-all', { token: buyer });
const after = (await j('GET', '/notifications/unread-count', { token: buyer })).data;
ok('mark-all-read clears unread', after.count === 0, `count=${after.count}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
