// Black-box E2E for the settlement liability report. A marketplace that collects
// the buyer's full payment owes the seller everything but its commission, from
// capture until settlement — the largest number on the balance sheet.
// Run: node apps/api/test/e2e/payables.e2e.mjs   (API on :4000)
import { createHmac } from 'node:crypto';

const B = 'http://localhost:4000/api/v1';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'whsec_xxxxxxxx';
const RUN = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
async function j(method, path, { token, body, key } = {}) {
  const res = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { 'idempotency-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await res.json(); } catch {}
  return { status: res.status, data: d };
}

const login = async (e, p) => (await j('POST', '/auth/login', { body: { email: e, password: p } })).data.accessToken;

const admin = await login('admin@shopstop.local', 'AdminPass123!');
const buyer = (await j('POST', '/auth/register', { body: { email: `pay_${RUN}@example.com`, password: 'paypass123456' } })).data.accessToken;
const payables = async () => (await j('GET', '/admin/payables', { token: admin })).data;

const cats = (await j('GET', '/categories')).data;
const catId = cats.find((c) => c.slug === 'electronics').children.find((c) => c.slug === 'mobile-phones').id;

/** Publish a listing and buy it, leaving the order PENDING payment. */
async function placeOrder(tag, priceMinor) {
  const listing = (await j('POST', '/listings', { token: admin, body: { categoryId: catId, title: `Payable ${tag} ${RUN}`, description: 'settlement liability test', priceMinor, quantity: 5, attributes: { brand: 'B', model: 'M', storage: '128GB' }, publish: true } })).data;
  if (listing.status === 'PENDING_REVIEW') {
    await j('POST', `/admin/moderation/LISTING/${listing.id}/action`, { token: admin, body: { decision: 'APPROVE' } });
  }
  const order = (await j('POST', '/orders', { token: buyer, key: `pay-${tag}-${RUN}`, body: { listingId: listing.id } })).data;
  return order;
}

async function capture(order, tag) {
  const intent = (await j('POST', '/payments/intent', { token: buyer, key: `payi-${tag}-${RUN}`, body: { orderId: order.id } })).data;
  const evt = { event: 'payment.captured', payload: { payment: { entity: { id: `pay_${tag}_${RUN}`, order_id: intent.providerOrderId, amount: order.totalMinor, method: 'upi' } } } };
  const raw = JSON.stringify(evt);
  const sig = createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
  await fetch(`${B}/payments/webhook/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig }, body: raw });
}

// --- 1. it is admin-only ------------------------------------------------------
const anon = await j('GET', '/admin/payables');
ok('payables requires auth', anon.status === 401, `status=${anon.status}`);
const asBuyer = await j('GET', '/admin/payables', { token: buyer });
ok('payables is admin-only', asBuyer.status === 403, `status=${asBuyer.status}`);

// --- 2. the report holds together internally ----------------------------------
const p0 = await payables();
ok('report returns the liability', typeof p0.heldMinor === 'number', `held=${p0.heldMinor}`);
ok('releasable + withheld = held', p0.releasableMinor + p0.withheldMinor === p0.heldMinor, `${p0.releasableMinor}+${p0.withheldMinor} vs ${p0.heldMinor}`);
ok('aging covers every bucket, including empty ones', p0.aging.length === 4 && p0.aging.every((b) => typeof b.minor === 'number'), `buckets=${p0.aging.map((b) => b.bucket)}`);
ok('aging sums to the held total', p0.aging.reduce((a, b) => a + b.minor, 0) === p0.heldMinor, `${p0.aging.reduce((a, b) => a + b.minor, 0)} vs ${p0.heldMinor}`);
ok('overdue never exceeds releasable', p0.overdueMinor <= p0.releasableMinor, `${p0.overdueMinor} vs ${p0.releasableMinor}`);

// The self-check that matters: the liability is computed twice, once by walking
// orders and once by summing the immutable ledger. They are different tables and
// different arithmetic, so agreement is evidence the books are consistent.
ok('order-derived and ledger-derived liability agree', p0.reconciliation.balanced && p0.reconciliation.driftMinor === 0, `drift=${p0.reconciliation.driftMinor}`);
const rc = p0.reconciliation;
ok('the reconciliation identity holds', rc.collectedMinor - rc.commissionMinor - rc.refundedMinor - rc.paidOutMinor === rc.ledgerHeldMinor, `${rc.collectedMinor}-${rc.commissionMinor}-${rc.refundedMinor}-${rc.paidOutMinor} vs ${rc.ledgerHeldMinor}`);

// --- 3. an unpaid order is not a debt -----------------------------------------
const PRICE_A = 800000;
const orderA = await placeOrder('a', PRICE_A);
const pUnpaid = await payables();
ok('an unpaid order creates no liability', pUnpaid.heldMinor === p0.heldMinor, `${pUnpaid.heldMinor} vs ${p0.heldMinor}`);

// --- 4. capture creates the debt, net of commission ---------------------------
await capture(orderA, 'a');
const netA = orderA.totalMinor - orderA.feeMinor;
const pA = await payables();
ok('capture adds exactly (total − commission) to the liability', pA.heldMinor - p0.heldMinor === netA, `delta=${pA.heldMinor - p0.heldMinor} expected=${netA}`);
ok('the ledger-derived figure moves by the same amount', pA.reconciliation.ledgerHeldMinor - p0.reconciliation.ledgerHeldMinor === netA, `delta=${pA.reconciliation.ledgerHeldMinor - p0.reconciliation.ledgerHeldMinor}`);
ok('still balanced after a capture', pA.reconciliation.balanced, `drift=${pA.reconciliation.driftMinor}`);
// The buyer has paid but has nothing in hand yet, so the money must not be payable.
ok('money for an undelivered order is withheld', pA.withheldMinor - p0.withheldMinor === netA, `delta=${pA.withheldMinor - p0.withheldMinor}`);
ok('and is not releasable', pA.releasableMinor === p0.releasableMinor, `${pA.releasableMinor} vs ${p0.releasableMinor}`);

// --- 5. delivery makes it payable ---------------------------------------------
await j('POST', `/orders/${orderA.id}/transition`, { token: admin, body: { action: 'pack' } });
await j('POST', `/orders/${orderA.id}/transition`, { token: admin, body: { action: 'ship', trackingNote: 'BlueDart 1' } });
const delivered = await j('POST', `/orders/${orderA.id}/transition`, { token: buyer, body: { action: 'deliver' } });
ok('order delivered', delivered.data.status === 'DELIVERED', `status=${delivered.data?.status}`);

const pDelivered = await payables();
ok('delivery does not change the total owed', pDelivered.heldMinor === pA.heldMinor, `${pDelivered.heldMinor} vs ${pA.heldMinor}`);
ok('delivery moves the money into releasable', pDelivered.releasableMinor - pA.releasableMinor === netA, `delta=${pDelivered.releasableMinor - pA.releasableMinor} expected=${netA}`);
ok('and out of withheld', pA.withheldMinor - pDelivered.withheldMinor === netA, `delta=${pA.withheldMinor - pDelivered.withheldMinor}`);

// --- 6. the seller appears in the per-seller breakdown ------------------------
const meAdmin = (await j('GET', '/auth/me', { token: admin })).data;
const sellerRow = pDelivered.bySeller.find((s) => s.sellerId === (meAdmin.id ?? meAdmin.user?.id));
ok('the seller owed money is listed', !!sellerRow, `sellers=${pDelivered.bySeller.length}`);
ok('per-seller owed never exceeds the total', pDelivered.bySeller.reduce((a, s) => a + s.owedMinor, 0) <= pDelivered.heldMinor, `sum=${pDelivered.bySeller.reduce((a, s) => a + s.owedMinor, 0)} total=${pDelivered.heldMinor}`);
ok('per-seller releasable never exceeds that seller owed', pDelivered.bySeller.every((s) => s.releasableMinor <= s.owedMinor));

// --- 7. an open dispute pulls the money back out of payable -------------------
// Delivered is not enough: while the buyer is contesting the sale, the platform
// may still have to refund, so paying the seller would be paying money it owes.
await j('POST', '/disputes', { token: buyer, body: { orderId: orderA.id, reason: 'Item arrived damaged and seller is unresponsive' } });
const pDisputed = await payables();
ok('an open dispute withholds the money again', pDisputed.releasableMinor === pA.releasableMinor, `${pDisputed.releasableMinor} vs ${pA.releasableMinor}`);
ok('a disputed order is still a liability', pDisputed.heldMinor === pA.heldMinor, `${pDisputed.heldMinor} vs ${pA.heldMinor}`);

// --- 8. a refund extinguishes the debt ----------------------------------------
const disputes = (await j('GET', '/admin/disputes', { token: admin })).data;
const mine = disputes.find((d) => d.orderId === orderA.id);
ok('the dispute is queued for admin', !!mine, `count=${disputes?.length}`);
await j('POST', `/admin/disputes/${mine.id}/resolve`, { token: admin, body: { status: 'RESOLVED_REFUND', resolution: 'Refunded to buyer' } });

const pRefunded = await payables();
ok('a refunded order is no longer owed to the seller', pRefunded.heldMinor === p0.heldMinor, `${pRefunded.heldMinor} vs ${p0.heldMinor}`);
// The refund books a REFUND row and reverses the commission, so both sides of the
// identity have to move together or the drift check catches it.
ok('the two derivations still agree after a refund', pRefunded.reconciliation.balanced, `drift=${pRefunded.reconciliation.driftMinor}`);
ok('the refund is reflected in the ledger totals', pRefunded.reconciliation.refundedMinor - rc.refundedMinor === orderA.totalMinor, `delta=${pRefunded.reconciliation.refundedMinor - rc.refundedMinor} expected=${orderA.totalMinor}`);

// --- 9. the float dwarfs the revenue, and the report says so ------------------
// Not a pass/fail on the ratio itself — the point is that both numbers are now
// knowable from the API, which is what the liability finding required.
const rev = (await j('GET', '/admin/revenue?days=365', { token: admin })).data;
ok('liability and revenue are both reportable', typeof rev.feeRevenueMinor === 'number' && typeof pRefunded.heldMinor === 'number');
console.log(`\n  float: ₹${(pRefunded.heldMinor / 100).toLocaleString('en-IN')} held vs ₹${(rev.feeRevenueMinor / 100).toLocaleString('en-IN')} earned`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
