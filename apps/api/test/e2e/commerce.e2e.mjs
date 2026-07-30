import { createHmac } from 'node:crypto';

const B = 'http://localhost:4000/api/v1';
const WEBHOOK_SECRET = 'whsec_xxxxxxxx';
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
async function j(method, path, { token, body, headers } = {}) {
  const res = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (email, password) => (await j('POST', '/auth/login', { body: { email, password } })).data.accessToken;

const RUN = Date.now().toString(36);
// Each suite sells as its own freshly-registered account. Sharing one seller across
// suites makes them collide: the risk engine holds a seller who posts 10+ listings in
// an hour, and a full pass creates roughly that many, so a second pass would land every
// listing in PENDING_REVIEW instead of ACTIVE.
const seller = (await j('POST', '/auth/register', { body: { email: `comm_seller_${RUN}@example.com`, password: 'sellerpassword1', displayName: 'Test Seller' } })).data.accessToken;
const buyerEmail = `buyer_${RUN}@example.com`;
const buyer = (await j('POST', '/auth/register', { body: { email: buyerEmail, password: 'buyerpassword1', displayName: 'Test Buyer' } })).data.accessToken;

const cats = (await j('GET', '/categories')).data;
const catId = cats.find((c) => c.slug === 'electronics').children.find((c) => c.slug === 'mobile-phones').id;
const listing = (await j('POST', '/listings', { token: seller, body: {
  categoryId: catId, title: `Pixel 8 Pro ${RUN}`, description: 'Mint condition, warranty till 2026, all accessories.',
  priceMinor: 600000, condition: 'LIKE_NEW', attributes: { brand: 'Google', model: 'Pixel 8 Pro', storage: '256GB' }, publish: true,
} })).data;
ok('listing ACTIVE', listing.status === 'ACTIVE', `status=${listing.status}`);

const thread = (await j('POST', '/threads', { token: buyer, body: { listingId: listing.id } })).data;
ok('thread created', !!thread.id);
const offer = (await j('POST', `/threads/${thread.id}/messages`, { token: buyer, body: { kind: 'OFFER', offerMinor: 550000 } })).data;
ok('offer OPEN', offer.offerStatus === 'OPEN');
const selfAccept = await j('POST', `/threads/messages/${offer.id}/offer`, { token: buyer, body: { action: 'accept' } });
ok('buyer cannot accept own offer (403)', selfAccept.status === 403);
const accepted = await j('POST', `/threads/messages/${offer.id}/offer`, { token: seller, body: { action: 'accept' } });
ok('seller accepts offer', accepted.status === 201 && accepted.data.amountMinor === 550000);

const idemKey = `order-${RUN}`;
const order1 = await j('POST', '/orders', { token: buyer, headers: { 'idempotency-key': idemKey }, body: { listingId: listing.id, offerMessageId: offer.id } });
ok('order PENDING at offer price', order1.status === 201 && order1.data.status === 'PENDING' && order1.data.totalMinor === 550000, `total=${order1.data?.totalMinor}`);
const orderId = order1.data.id;
const order2 = await j('POST', '/orders', { token: buyer, headers: { 'idempotency-key': idemKey }, body: { listingId: listing.id, offerMessageId: offer.id } });
ok('idempotent create returns same order', order2.data.id === orderId);
const order3 = await j('POST', '/orders', { token: buyer, headers: { 'idempotency-key': idemKey }, body: { listingId: listing.id, quantity: 2 } });
ok('idempotency reuse w/ different body -> 409', order3.status === 409, `status=${order3.status}`);

const intent = await j('POST', '/payments/intent', { token: buyer, headers: { 'idempotency-key': `pay-${RUN}` }, body: { orderId } });
ok('payment intent created', intent.status === 200 && !!intent.data.providerOrderId);
const providerOrderId = intent.data.providerOrderId;

const evt = { event: 'payment.captured', payload: { payment: { entity: { id: `pay_${RUN}`, order_id: providerOrderId, amount: 550000, method: 'upi' } } } };
const rawBody = JSON.stringify(evt);
const sig = createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
const wh = await fetch(`${B}/payments/webhook/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig }, body: rawBody });
ok('valid webhook accepted (200)', wh.status === 200, `status=${wh.status}`);
const afterPay = (await j('GET', `/orders/${orderId}`, { token: buyer })).data;
ok('order ACCEPTED after capture', afterPay.status === 'ACCEPTED');
ok('payment CAPTURED', afterPay.payment?.status === 'CAPTURED');
const wh2 = await fetch(`${B}/payments/webhook/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig }, body: rawBody });
ok('webhook replay idempotent (200)', wh2.status === 200);
const whBad = await fetch(`${B}/payments/webhook/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'deadbeef' }, body: rawBody });
ok('invalid webhook signature rejected', whBad.status >= 400, `status=${whBad.status}`);

const pack = await j('POST', `/orders/${orderId}/transition`, { token: seller, body: { action: 'pack' } });
ok('seller pack -> PACKED', pack.data.status === 'PACKED');
const ship = await j('POST', `/orders/${orderId}/transition`, { token: seller, body: { action: 'ship', trackingNote: 'BlueDart 12345' } });
ok('seller ship -> SHIPPED', ship.data.status === 'SHIPPED');
const buyerShip = await j('POST', `/orders/${orderId}/transition`, { token: buyer, body: { action: 'ship' } });
ok('buyer cannot ship (403)', buyerShip.status >= 400);
const deliver = await j('POST', `/orders/${orderId}/transition`, { token: buyer, body: { action: 'deliver' } });
ok('buyer deliver -> DELIVERED', deliver.data.status === 'DELIVERED');

const soldListing = (await j('GET', `/listings/${listing.id}`, { token: seller })).data;
ok('listing SOLD after order (inventory)', soldListing.status === 'SOLD', `status=${soldListing.status}`);

const review = await j('POST', '/reviews', { token: buyer, body: { orderId, rating: 5, body: 'Great seller!' } });
ok('buyer review created', review.status === 201);
const dupReview = await j('POST', '/reviews', { token: buyer, body: { orderId, rating: 4 } });
ok('duplicate review -> 409', dupReview.status === 409);
const reviewsForSeller = (await j('GET', `/reviews/user/${afterPay.sellerId}`));
ok('review appears on seller', Array.isArray(reviewsForSeller.data) && reviewsForSeller.data.length >= 1);

const listing2 = (await j('POST', '/listings', { token: seller, body: {
  categoryId: catId, title: `Galaxy S24 ${RUN}`, description: 'Brand new sealed, multiple units available.',
  priceMinor: 400000, condition: 'NEW', quantity: 5, attributes: { brand: 'Samsung', model: 'S24', storage: '256GB' }, publish: true,
} })).data;
const freshOrder = await j('POST', '/orders', { token: buyer, headers: { 'idempotency-key': `fresh-${RUN}` }, body: { listingId: listing2.id } });
ok('fresh order on in-stock listing', freshOrder.status === 201);
const earlyReview = await j('POST', '/reviews', { token: buyer, body: { orderId: freshOrder.data.id, rating: 3 } });
ok('cannot review non-completed order (409)', earlyReview.status === 409);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
