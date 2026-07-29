import { createHmac } from 'node:crypto';
const B = 'http://localhost:4000/api/v1';
const SECRET = 'whsec_xxxxxxxx'; // dev: Cashfree provider falls back to RAZORPAY_WEBHOOK_SECRET
const RUN = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
async function j(m, p, { token, body, key } = {}) {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { 'idempotency-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
}
const login = async (e, p) => (await j('POST', '/auth/login', { body: { email: e, password: p } })).data.accessToken;

const seller = await login('admin@shopstop.local', 'AdminPass123!');
const buyer = (await j('POST', '/auth/register', { body: { email: `cf_${RUN}@example.com`, password: 'cfpass123456' } })).data.accessToken;
const cats = (await j('GET', '/categories')).data;
const catId = cats.find((c) => c.slug === 'electronics').children.find((c) => c.slug === 'mobile-phones').id;
const listing = (await j('POST', '/listings', { token: seller, body: { categoryId: catId, title: `CF Phone ${RUN}`, description: 'cashfree test listing', priceMinor: 700000, quantity: 3, attributes: { brand: 'B', model: 'M', storage: '128GB' }, publish: true } })).data;
const order = (await j('POST', '/orders', { token: buyer, key: `o-${RUN}`, body: { listingId: listing.id } })).data;

// Create a CASHFREE intent (proves provider selection through the same service).
const intent = await j('POST', '/payments/intent', { token: buyer, key: `p-${RUN}`, body: { orderId: order.id, provider: 'CASHFREE' } });
ok('cashfree intent created', intent.status === 200 && intent.data.provider === 'CASHFREE' && intent.data.providerOrderId.startsWith('cf_order_dev_'), `pid=${intent.data?.providerOrderId}`);

// Cashfree-signed webhook: base64(HMAC-SHA256(secret, timestamp + rawBody)).
const evt = { type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: intent.data.providerOrderId }, payment: { cf_payment_id: `cf_${RUN}`, payment_amount: 7000, payment_status: 'SUCCESS', payment_group: 'upi' } } };
const raw = JSON.stringify(evt);
const ts = Date.now().toString();
const sig = createHmac('sha256', SECRET).update(ts + raw).digest('base64');
const wh = await fetch(`${B}/payments/webhook/cashfree`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-signature': sig, 'x-webhook-timestamp': ts }, body: raw });
ok('valid cashfree webhook accepted', wh.status === 200, `status=${wh.status}`);
const after = (await j('GET', `/orders/${order.id}`, { token: buyer })).data;
ok('order ACCEPTED via cashfree', after.status === 'ACCEPTED' && after.payment?.status === 'CAPTURED', `status=${after.status} pay=${after.payment?.status}`);

// Bad signature rejected.
const bad = await fetch(`${B}/payments/webhook/cashfree`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-signature': 'nope', 'x-webhook-timestamp': ts }, body: raw });
ok('invalid cashfree signature rejected', bad.status >= 400, `status=${bad.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
