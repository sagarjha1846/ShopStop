// Black-box E2E for platform monetization: commission booked to the ledger,
// seller earnings, and the admin revenue summary.
// Run: node apps/api/test/e2e/revenue.e2e.mjs   (API on :4000)
import { createHmac } from 'node:crypto';

const B = 'http://localhost:4000/api/v1';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'whsec_xxxxxxxx';
const FEE_BPS = Number(process.env.PLATFORM_FEE_BPS || 200);
const RUN = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
async function j(method, path, { token, body, headers } = {}) {
  const res = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers ?? {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await res.json(); } catch {}
  return { status: res.status, data: d };
}
const login = async (e, p) => (await j('POST', '/auth/login', { body: { email: e, password: p } })).data.accessToken;

const seller = await login('admin@shopstop.local', 'AdminPass123!');
const buyer = (await j('POST', '/auth/register', { body: { email: `rev_${RUN}@example.com`, password: 'revpass123456' } })).data.accessToken;

const cats = (await j('GET', '/categories')).data;
const catId = cats.find((c) => c.slug === 'electronics').children.find((c) => c.slug === 'mobile-phones').id;

const PRICE = 1_000_000; // ₹10,000.00
// quantity > 1: the first capture marks a single-quantity listing SOLD, which
// would block the second order this suite needs for the concurrency check.
const listing = (await j('POST', '/listings', { token: seller, body: { categoryId: catId, title: `Revenue Phone ${RUN}`, description: 'revenue booking test listing', priceMinor: PRICE, quantity: 5, attributes: { brand: 'B', model: 'M', storage: '128GB' }, publish: true } })).data;
// The risk engine holds listings when the seller's recent listing velocity is
// high — which repeated E2E runs on the shared demo seller will trigger. Approve
// it so this suite tests monetization rather than the risk engine.
if (listing.status === 'PENDING_REVIEW') {
  await j('POST', `/admin/moderation/LISTING/${listing.id}/action`, { token: seller, body: { decision: 'APPROVE' } });
}

// --- 1. the fee is priced onto the order ------------------------------------
const expectedFee = Math.round((PRICE * FEE_BPS) / 10_000);
const order = (await j('POST', '/orders', { token: buyer, headers: { 'idempotency-key': `rev-${RUN}` }, body: { listingId: listing.id } })).data;
ok('order carries the platform fee', order.feeMinor === expectedFee, `fee=${order.feeMinor} expected=${expectedFee}`);
ok('buyer total excludes the fee (seller-side commission)', order.totalMinor === PRICE, `total=${order.totalMinor}`);

// --- 2. baseline before capture ----------------------------------------------
const before = (await j('GET', '/admin/revenue?days=1', { token: seller })).data;
const beforeEarnings = (await j('GET', '/me/earnings', { token: seller })).data;

// --- 3. capture books CHARGE + FEE -------------------------------------------
const intent = (await j('POST', '/payments/intent', { token: buyer, headers: { 'idempotency-key': `revpay-${RUN}` }, body: { orderId: order.id } })).data;
const evt = { event: 'payment.captured', payload: { payment: { entity: { id: `pay_${RUN}`, order_id: intent.providerOrderId, amount: PRICE, method: 'upi' } } } };
const rawBody = JSON.stringify(evt);
const sig = createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
const post = () => fetch(`${B}/payments/webhook/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig }, body: rawBody });
ok('capture webhook accepted', (await post()).status === 200);

const after = (await j('GET', '/admin/revenue?days=1', { token: seller })).data;
ok('GMV increased by the order total', after.gmvMinor - before.gmvMinor === PRICE, `delta=${after.gmvMinor - before.gmvMinor}`);
ok('fee revenue booked to the ledger', after.feeRevenueMinor - before.feeRevenueMinor === expectedFee, `delta=${after.feeRevenueMinor - before.feeRevenueMinor} expected=${expectedFee}`);
ok('paid order counted', after.paidOrders - before.paidOrders === 1);
ok('take rate reported', after.takeRatePct > 0, `takeRate=${after.takeRatePct}%`);
ok('daily breakdown present', Array.isArray(after.byDay) && after.byDay.length > 0);

// --- 4. duplicate webhook must not double-book revenue ------------------------
ok('replayed webhook accepted', (await post()).status === 200);
const afterReplay = (await j('GET', '/admin/revenue?days=1', { token: seller })).data;
ok('replay does not double-count GMV', afterReplay.gmvMinor === after.gmvMinor, `${afterReplay.gmvMinor} vs ${after.gmvMinor}`);
ok('replay does not double-book the fee', afterReplay.feeRevenueMinor === after.feeRevenueMinor, `${afterReplay.feeRevenueMinor} vs ${after.feeRevenueMinor}`);

// --- 5. concurrent duplicate deliveries (the race a gateway actually causes) ---
const order2 = (await j('POST', '/orders', { token: buyer, headers: { 'idempotency-key': `rev2-${RUN}` }, body: { listingId: listing.id } })).data;
const intent2 = (await j('POST', '/payments/intent', { token: buyer, headers: { 'idempotency-key': `revpay2-${RUN}` }, body: { orderId: order2.id } })).data;
const evt2 = { event: 'payment.captured', payload: { payment: { entity: { id: `pay2_${RUN}`, order_id: intent2.providerOrderId, amount: PRICE, method: 'upi' } } } };
const raw2 = JSON.stringify(evt2);
const sig2 = createHmac('sha256', WEBHOOK_SECRET).update(raw2).digest('hex');
const fire = () => fetch(`${B}/payments/webhook/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig2 }, body: raw2 });
const beforeRace = (await j('GET', '/admin/revenue?days=1', { token: seller })).data;
await Promise.all([fire(), fire(), fire(), fire()]);
const afterRace = (await j('GET', '/admin/revenue?days=1', { token: seller })).data;
ok('4 concurrent deliveries book GMV exactly once', afterRace.gmvMinor - beforeRace.gmvMinor === PRICE, `delta=${afterRace.gmvMinor - beforeRace.gmvMinor} expected=${PRICE}`);
ok('4 concurrent deliveries book the fee exactly once', afterRace.feeRevenueMinor - beforeRace.feeRevenueMinor === expectedFee, `delta=${afterRace.feeRevenueMinor - beforeRace.feeRevenueMinor} expected=${expectedFee}`);

// --- 6. seller earnings -------------------------------------------------------
const earnings = (await j('GET', '/me/earnings', { token: seller })).data;
ok('settled gross grew by both captured orders', earnings.settled.grossMinor - beforeEarnings.settled.grossMinor === PRICE * 2, `delta=${earnings.settled.grossMinor - beforeEarnings.settled.grossMinor}`);
ok('settled fee grew by both commissions', earnings.settled.feeMinor - beforeEarnings.settled.feeMinor === expectedFee * 2, `delta=${earnings.settled.feeMinor - beforeEarnings.settled.feeMinor}`);
ok('net = gross - fee', earnings.settled.netMinor === earnings.settled.grossMinor - earnings.settled.feeMinor);
ok('earnings report the configured take rate', earnings.feeBps === FEE_BPS, `bps=${earnings.feeBps}`);

// --- 6b. commission margin by payment method ----------------------------------
// Fund one order by card. Commission is priced at ~card MDR, so this is the case
// that decides whether the take rate earns anything — it must show ~zero net.
const cardOrder = (await j('POST', '/orders', { token: buyer, headers: { 'idempotency-key': `rev3-${RUN}` }, body: { listingId: listing.id } })).data;
const cardIntent = (await j('POST', '/payments/intent', { token: buyer, headers: { 'idempotency-key': `revpay3-${RUN}` }, body: { orderId: cardOrder.id } })).data;
const cardEvt = { event: 'payment.captured', payload: { payment: { entity: { id: `cardpay_${RUN}`, order_id: cardIntent.providerOrderId, amount: PRICE, method: 'card' } } } };
const cardRaw = JSON.stringify(cardEvt);
const cardSig = createHmac('sha256', WEBHOOK_SECRET).update(cardRaw).digest('hex');
await fetch(`${B}/payments/webhook/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': cardSig }, body: cardRaw });

const mixed = (await j('GET', '/admin/revenue?days=1', { token: seller })).data;
const card = mixed.byMethod.find((m) => m.method === 'card');
ok('card volume reported separately', !!card, `methods=${mixed.byMethod.map((m) => m.method)}`);
ok('card gateway cost ≈ the commission charged', card.estGatewayCostMinor === card.commissionMinor, `cost=${card?.estGatewayCostMinor} commission=${card?.commissionMinor}`);
ok('card commission nets ~zero (the F2 finding, measured)', card.estNetMinor === 0, `net=${card?.estNetMinor}`);
const upi = mixed.byMethod.find((m) => m.method === 'upi');
ok('revenue splits by payment method', !!upi, `methods=${mixed.byMethod.map((m) => m.method)}`);
ok('UPI is costed at zero MDR', upi.estGatewayCostMinor === 0, `cost=${upi.estGatewayCostMinor}`);
ok('UPI net = full commission', upi.estNetMinor === upi.commissionMinor, `net=${upi.estNetMinor} commission=${upi.commissionMinor}`);
ok('net commission totals the per-method rows', mixed.estNetCommissionMinor === mixed.byMethod.reduce((a, m) => a + m.estNetMinor, 0));
ok('method GMV never exceeds total GMV', mixed.byMethod.reduce((a, m) => a + m.gmvMinor, 0) <= mixed.gmvMinor, `sum=${mixed.byMethod.reduce((a, m) => a + m.gmvMinor, 0)} total=${mixed.gmvMinor}`);
ok('boost revenue excluded from per-method commission', mixed.byMethod.reduce((a, m) => a + m.commissionMinor, 0) === mixed.commissionRevenueMinor, `byMethod=${mixed.byMethod.reduce((a, m) => a + m.commissionMinor, 0)} commission=${mixed.commissionRevenueMinor}`);

// --- 7. a refunded sale gives back the commission ------------------------------
// Move the second order to a disputable state, then refund it via dispute resolution.
await j('POST', `/orders/${order2.id}/transition`, { token: seller, body: { action: 'pack' } });
await j('POST', '/disputes', { token: buyer, body: { orderId: order2.id, reason: 'Item never arrived, seller unreachable' } });
const disputes = (await j('GET', '/admin/disputes', { token: seller })).data;
const mine = disputes.find((d) => d.orderId === order2.id);
const beforeRefund = (await j('GET', '/admin/revenue?days=1', { token: seller })).data;
const earnBeforeRefund = (await j('GET', '/me/earnings', { token: seller })).data;

const resolved = await j('POST', `/admin/disputes/${mine.id}/resolve`, { token: seller, body: { status: 'RESOLVED_REFUND', resolution: 'Refunded to buyer' } });
ok('admin resolves dispute as refund', resolved.status === 200 || resolved.status === 201, `status=${resolved.status}`);

const afterRefund = (await j('GET', '/admin/revenue?days=1', { token: seller })).data;
ok('refund recorded in the ledger', afterRefund.refundedMinor - beforeRefund.refundedMinor === PRICE, `delta=${afterRefund.refundedMinor - beforeRefund.refundedMinor}`);
ok('commission reversed on refund', beforeRefund.feeRevenueMinor - afterRefund.feeRevenueMinor === expectedFee, `delta=${beforeRefund.feeRevenueMinor - afterRefund.feeRevenueMinor} expected=${expectedFee}`);

const earnAfterRefund = (await j('GET', '/me/earnings', { token: seller })).data;
ok('refunded sale drops out of seller settled earnings', earnBeforeRefund.settled.grossMinor - earnAfterRefund.settled.grossMinor === PRICE, `delta=${earnBeforeRefund.settled.grossMinor - earnAfterRefund.settled.grossMinor}`);

// resolving again must not double-book the reversal
await j('POST', `/admin/disputes/${mine.id}/resolve`, { token: seller, body: { status: 'RESOLVED_REFUND', resolution: 'again' } });
const afterTwice = (await j('GET', '/admin/revenue?days=1', { token: seller })).data;
ok('re-resolving does not double-book the refund', afterTwice.refundedMinor === afterRefund.refundedMinor, `${afterTwice.refundedMinor} vs ${afterRefund.refundedMinor}`);

// --- 8. authorization ---------------------------------------------------------
const asBuyer = await j('GET', '/admin/revenue', { token: buyer });
ok('non-admin cannot read platform revenue', asBuyer.status === 403, `status=${asBuyer.status}`);
const anon = await j('GET', '/me/earnings');
ok('earnings require auth', anon.status === 401, `status=${anon.status}`);
const buyerEarnings = (await j('GET', '/me/earnings', { token: buyer })).data;
ok('a buyer sees zero seller earnings', buyerEarnings.settled.grossMinor === 0, `gross=${buyerEarnings.settled.grossMinor}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
