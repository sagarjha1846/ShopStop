// Black-box E2E for the browser payment callback — the half of checkout that was
// missing. Razorpay signs HMAC(order_id|payment_id) with the API key secret.
// Run: node apps/api/test/e2e/payment-verify.e2e.mjs   (API on :4000)
import { createHmac } from 'node:crypto';

const B = 'http://localhost:4000/api/v1';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'xxxxxxxx';
const RUN = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
async function j(method, path, { token, body, key } = {}) {
  const res = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { 'idempotency-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await res.json(); } catch {}
  return { status: res.status, data: d };
}
const login = async (e, p) => (await j('POST', '/auth/login', { body: { email: e, password: p } })).data.accessToken;
const sign = (orderId, paymentId) =>
  createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

const seller = await login('admin@shopstop.local', 'AdminPass123!');
const buyer = (await j('POST', '/auth/register', { body: { email: `pv_${RUN}@example.com`, password: 'pvpass1234567' } })).data.accessToken;
const intruder = (await j('POST', '/auth/register', { body: { email: `pv2_${RUN}@example.com`, password: 'pv2pass123456' } })).data.accessToken;

const cats = (await j('GET', '/categories')).data;
const catId = cats.find((c) => c.slug === 'electronics').children.find((c) => c.slug === 'mobile-phones').id;
const PRICE = 600000;
const listing = (await j('POST', '/listings', { token: seller, body: { categoryId: catId, title: `Verify Phone ${RUN}`, description: 'client callback verification test', priceMinor: PRICE, quantity: 5, attributes: { brand: 'B', model: 'M', storage: '128GB' }, publish: true } })).data;
if (listing.status === 'PENDING_REVIEW') {
  await j('POST', `/admin/moderation/LISTING/${listing.id}/action`, { token: seller, body: { decision: 'APPROVE' } });
}

const order = (await j('POST', '/orders', { token: buyer, key: `pv-${RUN}`, body: { listingId: listing.id } })).data;
const intent = (await j('POST', '/payments/intent', { token: buyer, key: `pvpay-${RUN}`, body: { orderId: order.id } })).data;
const payId = `pay_client_${RUN}`;

// --- 1. a forged signature is refused -----------------------------------------
const forged = await j('POST', '/payments/verify', { token: buyer, body: { providerOrderId: intent.providerOrderId, providerPaymentId: payId, signature: 'deadbeef' } });
// 4xx specifically: a signature that doesn't verify is the caller's fault. A 5xx
// here would tell the browser our gateway broke, and invite it to retry.
ok('forged signature rejected as a client error', forged.status >= 400 && forged.status < 500, `status=${forged.status}`);
const stillPending = (await j('GET', `/orders/${order.id}`, { token: buyer })).data;
ok('a rejected callback does not advance the order', stillPending.status === 'PENDING', `status=${stillPending.status}`);

// --- 2. auth + ownership ------------------------------------------------------
const good = sign(intent.providerOrderId, payId);
const anon = await j('POST', '/payments/verify', { body: { providerOrderId: intent.providerOrderId, providerPaymentId: payId, signature: good } });
ok('confirmation requires auth', anon.status === 401, `status=${anon.status}`);
// A valid signature proves the gateway made the payload — not who is replaying it.
const byIntruder = await j('POST', '/payments/verify', { token: intruder, body: { providerOrderId: intent.providerOrderId, providerPaymentId: payId, signature: good } });
ok('another user cannot confirm an order that is not theirs', byIntruder.status === 403, `status=${byIntruder.status}`);

// --- 3. the happy path captures ------------------------------------------------
const revBefore = (await j('GET', '/admin/revenue?days=1', { token: seller })).data;
const verified = await j('POST', '/payments/verify', { token: buyer, body: { providerOrderId: intent.providerOrderId, providerPaymentId: payId, signature: good } });
ok('valid callback accepted', verified.status === 201 || verified.status === 200, `status=${verified.status}`);
ok('payment reported captured', verified.data.status === 'CAPTURED', `status=${verified.data?.status}`);

const paid = (await j('GET', `/orders/${order.id}`, { token: buyer })).data;
ok('order advanced to ACCEPTED', paid.status === 'ACCEPTED', `status=${paid.status}`);
ok('payment is CAPTURED', paid.payment?.status === 'CAPTURED', `status=${paid.payment?.status}`);

const revAfter = (await j('GET', '/admin/revenue?days=1', { token: seller })).data;
ok('GMV booked from the client path', revAfter.gmvMinor - revBefore.gmvMinor === PRICE, `delta=${revAfter.gmvMinor - revBefore.gmvMinor}`);
ok('commission booked from the client path', revAfter.feeRevenueMinor > revBefore.feeRevenueMinor);

// --- 4. it converges with the webhook rather than double-booking ---------------
// The webhook is still the source of truth and will arrive for the same payment.
// Whichever lands first books; the other must be a no-op.
const evt = { event: 'payment.captured', payload: { payment: { entity: { id: payId, order_id: intent.providerOrderId, amount: PRICE, method: 'upi' } } } };
const raw = JSON.stringify(evt);
const wsig = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || 'whsec_xxxxxxxx').update(raw).digest('hex');
const wh = await fetch(`${B}/payments/webhook/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': wsig }, body: raw });
ok('the later webhook is still accepted', wh.status === 200, `status=${wh.status}`);
const revFinal = (await j('GET', '/admin/revenue?days=1', { token: seller })).data;
ok('webhook after client confirm does not double-book GMV', revFinal.gmvMinor === revAfter.gmvMinor, `${revFinal.gmvMinor} vs ${revAfter.gmvMinor}`);
ok('webhook after client confirm does not double-book the fee', revFinal.feeRevenueMinor === revAfter.feeRevenueMinor, `${revFinal.feeRevenueMinor} vs ${revAfter.feeRevenueMinor}`);

// --- 5. replaying the client callback is a no-op ------------------------------
const replay = await j('POST', '/payments/verify', { token: buyer, body: { providerOrderId: intent.providerOrderId, providerPaymentId: payId, signature: good } });
ok('replayed client callback accepted and idempotent', replay.status === 201 || replay.status === 200, `status=${replay.status}`);
const revReplay = (await j('GET', '/admin/revenue?days=1', { token: seller })).data;
ok('replay books nothing extra', revReplay.gmvMinor === revAfter.gmvMinor, `${revReplay.gmvMinor} vs ${revAfter.gmvMinor}`);

// --- 6. unknown order ---------------------------------------------------------
const bogus = await j('POST', '/payments/verify', { token: buyer, body: { providerOrderId: `order_nope_${RUN}`, providerPaymentId: payId, signature: sign(`order_nope_${RUN}`, payId) } });
ok('unknown provider order -> 404', bogus.status === 404, `status=${bogus.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
