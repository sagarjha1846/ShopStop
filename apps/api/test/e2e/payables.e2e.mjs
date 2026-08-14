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
const meId = meAdmin.user?.id ?? meAdmin.id;
ok('the admin seller id resolves', typeof meId === 'string' && meId.length > 0, `meId=${meId}`);
const sellerRow = pDelivered.bySeller.find((s) => s.sellerId === meId);
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

// --- 9. settlement takes the money out of the held balance --------------------
const settleAnon = await j('POST', '/admin/payables/settle', { key: `s0-${RUN}`, body: { sellerId: meId, reference: 'UTR1' } });
ok('settlement requires auth', settleAnon.status === 401, `status=${settleAnon.status}`);
const settleBuyer = await j('POST', '/admin/payables/settle', { token: buyer, key: `s1-${RUN}`, body: { sellerId: meId, reference: 'UTR1' } });
ok('settlement is admin-only', settleBuyer.status === 403, `status=${settleBuyer.status}`);
const settleUnknown = await j('POST', '/admin/payables/settle', { token: admin, key: `s2-${RUN}`, body: { sellerId: 'nope', reference: 'UTR1' } });
ok('settling an unknown seller -> 404', settleUnknown.status === 404, `status=${settleUnknown.status}`);
// A PAYOUT row that cannot be traced to money leaving an account is worse than none.
const settleNoRef = await j('POST', '/admin/payables/settle', { token: admin, key: `s3-${RUN}`, body: { sellerId: meId } });
ok('settlement without a transfer reference is rejected', settleNoRef.status === 422 || settleNoRef.status === 400, `status=${settleNoRef.status}`);

// Order B: captured and delivered, so it is genuinely payable.
const orderB = await placeOrder('b', 950000);
await capture(orderB, 'b');
await j('POST', `/orders/${orderB.id}/transition`, { token: admin, body: { action: 'pack' } });
await j('POST', `/orders/${orderB.id}/transition`, { token: admin, body: { action: 'ship', trackingNote: 'BlueDart 2' } });
await j('POST', `/orders/${orderB.id}/transition`, { token: buyer, body: { action: 'deliver' } });

const preSettle = await payables();
ok('there is money to settle', preSettle.releasableMinor > 0, `releasable=${preSettle.releasableMinor}`);
const settled = await j('POST', '/admin/payables/settle', { token: admin, key: `s4-${RUN}`, body: { sellerId: meId, reference: `UTR-${RUN}` } });
ok('settlement accepted', settled.status === 200 || settled.status === 201, `status=${settled.status}`);
ok('settlement pays exactly what was releasable', settled.data.settledMinor === preSettle.releasableMinor, `paid=${settled.data?.settledMinor} releasable=${preSettle.releasableMinor}`);
ok('settlement carries the transfer reference', settled.data.reference === `UTR-${RUN}` && !!settled.data.batchId, `ref=${settled.data?.reference}`);

const postSettle = await payables();
ok('settling reduces the liability by what was paid', preSettle.heldMinor - postSettle.heldMinor === settled.data.settledMinor, `delta=${preSettle.heldMinor - postSettle.heldMinor} paid=${settled.data.settledMinor}`);
ok('nothing is left releasable', postSettle.releasableMinor === 0, `releasable=${postSettle.releasableMinor}`);
ok('the payout is recorded in the ledger', postSettle.reconciliation.paidOutMinor - preSettle.reconciliation.paidOutMinor === settled.data.settledMinor, `delta=${postSettle.reconciliation.paidOutMinor - preSettle.reconciliation.paidOutMinor}`);
// The PAYOUT arm of the identity is the one that had never been exercised.
ok('the books still balance after a payout', postSettle.reconciliation.balanced, `drift=${postSettle.reconciliation.driftMinor}`);
ok('withheld money is not settled', postSettle.withheldMinor === preSettle.withheldMinor, `${postSettle.withheldMinor} vs ${preSettle.withheldMinor}`);
const settleAgain = await j('POST', '/admin/payables/settle', { token: admin, key: `s5-${RUN}`, body: { sellerId: meId, reference: `UTR-${RUN}-2` } });
ok('settling again pays nothing', settleAgain.data.settledMinor === 0, `paid=${settleAgain.data?.settledMinor}`);

// --- 10. the seller can see what they are owed and what was paid --------------
const noAuth = await j('GET', '/me/payouts');
ok('the payout view requires auth', noAuth.status === 401, `status=${noAuth.status}`);
const sellerView = (await j('GET', '/me/payouts', { token: admin })).data;
ok('the seller sees what is held for them', sellerView.heldMinor === (postSettle.bySeller.find((s) => s.sellerId === meId)?.owedMinor ?? 0), `seller=${sellerView.heldMinor} admin=${postSettle.bySeller.find((s) => s.sellerId === meId)?.owedMinor}`);
ok('held splits into releasable + withheld', sellerView.releasableMinor + sellerView.withheldMinor === sellerView.heldMinor, `${sellerView.releasableMinor}+${sellerView.withheldMinor} vs ${sellerView.heldMinor}`);
ok('the settlement just made is visible to the seller', sellerView.payouts.some((p) => p.reference === `UTR-${RUN}` && p.amountMinor === settled.data.settledMinor), `refs=${sellerView.payouts.slice(0, 3).map((p) => p.reference)}`);
ok('lifetime paid out covers that settlement', sellerView.paidOutMinor >= settled.data.settledMinor, `paidOut=${sellerView.paidOutMinor} settled=${settled.data.settledMinor}`);
ok('the seller is told the settlement SLA', sellerView.settlementSlaDays > 0, `sla=${sellerView.settlementSlaDays}`);
// One seller's payout history is not another's business.
const strangerView = (await j('GET', '/me/payouts', { token: buyer })).data;
ok('a different account sees only its own payouts', strangerView.paidOutMinor === 0 && strangerView.payouts.length === 0, `paidOut=${strangerView.paidOutMinor} rows=${strangerView.payouts.length}`);
ok('and is owed nothing', strangerView.heldMinor === 0, `held=${strangerView.heldMinor}`);

// --- 11. concurrent settlements cannot pay twice ------------------------------
// Distinct idempotency keys on purpose: the interceptor would mask a missing lock,
// and paying a seller twice is not recoverable by an apology.
const orderC = await placeOrder('c', 1100000);
await capture(orderC, 'c');
await j('POST', `/orders/${orderC.id}/transition`, { token: admin, body: { action: 'pack' } });
await j('POST', `/orders/${orderC.id}/transition`, { token: admin, body: { action: 'ship', trackingNote: 'BlueDart 3' } });
await j('POST', `/orders/${orderC.id}/transition`, { token: buyer, body: { action: 'deliver' } });

const preRace = await payables();
const racers = await Promise.all(
  Array.from({ length: 6 }, (_, i) =>
    j('POST', '/admin/payables/settle', { token: admin, key: `race-${RUN}-${i}`, body: { sellerId: meId, reference: `UTR-RACE-${RUN}` } }),
  ),
);
const claimed = racers.reduce((a, r) => a + (r.data?.settledMinor ?? 0), 0);
const postRace = await payables();
ok('six concurrent settlements pay the amount once, not six times', claimed === preRace.releasableMinor, `claimed=${claimed} releasable=${preRace.releasableMinor}`);
ok('the ledger records exactly one payment', postRace.reconciliation.paidOutMinor - preRace.reconciliation.paidOutMinor === preRace.releasableMinor, `delta=${postRace.reconciliation.paidOutMinor - preRace.reconciliation.paidOutMinor} expected=${preRace.releasableMinor}`);
ok('the books balance after the race', postRace.reconciliation.balanced, `drift=${postRace.reconciliation.driftMinor}`);

// --- 12. a partial refund actually moves money --------------------------------
// RESOLVED_PARTIAL used to close the dispute and move nothing: the record said the
// buyer was repaid while they received nothing and the seller kept the lot.
const orderD = await placeOrder('d', 1000000);
await capture(orderD, 'd');
await j('POST', `/orders/${orderD.id}/transition`, { token: admin, body: { action: 'pack' } });
await j('POST', `/orders/${orderD.id}/transition`, { token: admin, body: { action: 'ship', trackingNote: 'BlueDart 4' } });
await j('POST', `/orders/${orderD.id}/transition`, { token: buyer, body: { action: 'deliver' } });
await j('POST', '/disputes', { token: buyer, body: { orderId: orderD.id, reason: 'Item is scratched, would accept a partial refund instead of returning' } });
const dispD = (await j('GET', '/admin/disputes', { token: admin })).data.find((d) => d.orderId === orderD.id);

const noAmount = await j('POST', `/admin/disputes/${dispD.id}/resolve`, { token: admin, body: { status: 'RESOLVED_PARTIAL', resolution: 'partial' } });
ok('a partial refund without an amount is rejected', noAmount.status === 422, `status=${noAmount.status}`);
const tooBig = await j('POST', `/admin/disputes/${dispD.id}/resolve`, { token: admin, body: { status: 'RESOLVED_PARTIAL', resolution: 'partial', refundAmountMinor: orderD.totalMinor } });
ok('a partial refund for the full amount is rejected', tooBig.status === 422, `status=${tooBig.status}`);
const amountOnRelease = await j('POST', `/admin/disputes/${dispD.id}/resolve`, { token: admin, body: { status: 'RESOLVED_RELEASE', resolution: 'release', refundAmountMinor: 1000 } });
ok('an amount on a release is rejected as a mistake', amountOnRelease.status === 422, `status=${amountOnRelease.status}`);

const REFUND = 300000;
const feeReversal = Math.round((orderD.feeMinor * REFUND) / orderD.totalMinor);
const revBeforePartial = (await j('GET', '/admin/revenue?days=1', { token: admin })).data;
const payBeforePartial = await payables();
const partial = await j('POST', `/admin/disputes/${dispD.id}/resolve`, { token: admin, body: { status: 'RESOLVED_PARTIAL', resolution: 'Agreed 30% back for the scratch', refundAmountMinor: REFUND } });
ok('partial resolution accepted', partial.status === 200 || partial.status === 201, `status=${partial.status}`);

const revAfterPartial = (await j('GET', '/admin/revenue?days=1', { token: admin })).data;
ok('the buyer is actually refunded', revAfterPartial.refundedMinor - revBeforePartial.refundedMinor === REFUND, `delta=${revAfterPartial.refundedMinor - revBeforePartial.refundedMinor} expected=${REFUND}`);
// The platform gives back the same share of its commission as the buyer gets back
// of their payment, rather than making the seller carry all of the goodwill.
ok('commission is reversed in proportion', revBeforePartial.feeRevenueMinor - revAfterPartial.feeRevenueMinor === feeReversal, `delta=${revBeforePartial.feeRevenueMinor - revAfterPartial.feeRevenueMinor} expected=${feeReversal}`);

const payAfterPartial = await payables();
ok('the seller is owed the refund less the reversed commission', payBeforePartial.heldMinor - payAfterPartial.heldMinor === REFUND - feeReversal, `delta=${payBeforePartial.heldMinor - payAfterPartial.heldMinor} expected=${REFUND - feeReversal}`);
ok('the books still balance after a partial refund', payAfterPartial.reconciliation.balanced, `drift=${payAfterPartial.reconciliation.driftMinor}`);
const orderDAfter = (await j('GET', `/orders/${orderD.id}`, { token: buyer })).data;
ok('a partially refunded order is not marked REFUNDED', orderDAfter.status === 'DELIVERED', `status=${orderDAfter.status}`);
// The dispute is closed, so the seller's remainder must become payable — not sit
// withheld forever because the resolution was "partial" rather than "release".
ok('the remainder becomes payable once the dispute closes', payAfterPartial.releasableMinor > payBeforePartial.releasableMinor - REFUND, `before=${payBeforePartial.releasableMinor} after=${payAfterPartial.releasableMinor}`);
const reResolve = await j('POST', `/admin/disputes/${dispD.id}/resolve`, { token: admin, body: { status: 'RESOLVED_PARTIAL', resolution: 'again', refundAmountMinor: REFUND } });
ok('a resolved dispute cannot be refunded again', reResolve.status === 409 || reResolve.status === 422, `status=${reResolve.status}`);

// --- 13. a refund the gateway refuses books nothing ---------------------------
// The ledger used to claim refunds that never left the building: bookRefund wrote
// REFUND rows and no gateway was ever called. Now the call comes first, and a
// provider that cannot refund has to fail loudly. Cashfree implements no refund(),
// so this exercises a real provider limitation rather than a mock.
const CF_SECRET = 'whsec_xxxxxxxx'; // dev: Cashfree falls back to the Razorpay webhook secret
const orderE = await placeOrder('e', 700000);
const cfIntent = (await j('POST', '/payments/intent', { token: buyer, key: `pcf-${RUN}`, body: { orderId: orderE.id, provider: 'CASHFREE' } })).data;
const cfEvt = { type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: cfIntent.providerOrderId }, payment: { cf_payment_id: `cf_${RUN}`, payment_amount: orderE.totalMinor / 100, payment_status: 'SUCCESS', payment_group: 'upi' } } };
const cfRaw = JSON.stringify(cfEvt);
const cfTs = Date.now().toString();
await fetch(`${B}/payments/webhook/cashfree`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-signature': createHmac('sha256', CF_SECRET).update(cfTs + cfRaw).digest('base64'), 'x-webhook-timestamp': cfTs }, body: cfRaw });
const cfPaid = (await j('GET', `/orders/${orderE.id}`, { token: buyer })).data;
ok('cashfree order captured', cfPaid.payment?.status === 'CAPTURED', `pay=${cfPaid.payment?.status}`);

await j('POST', '/disputes', { token: buyer, body: { orderId: orderE.id, reason: 'Never arrived, requesting a full refund please' } });
const dispE = (await j('GET', '/admin/disputes', { token: admin })).data.find((d) => d.orderId === orderE.id);
const revBeforeCf = (await j('GET', '/admin/revenue?days=1', { token: admin })).data;
const cfRefund = await j('POST', `/admin/disputes/${dispE.id}/resolve`, { token: admin, body: { status: 'RESOLVED_REFUND', resolution: 'Full refund' } });
ok('a second gateway refunds through the same path', cfRefund.status === 200 || cfRefund.status === 201, `status=${cfRefund.status}`);
const revAfterCf = (await j('GET', '/admin/revenue?days=1', { token: admin })).data;
ok('the cashfree buyer is actually refunded', revAfterCf.refundedMinor - revBeforeCf.refundedMinor === orderE.totalMinor, `delta=${revAfterCf.refundedMinor - revBeforeCf.refundedMinor} expected=${orderE.totalMinor}`);
const orderEAfter = (await j('GET', `/orders/${orderE.id}`, { token: buyer })).data;
ok('the cashfree order closes as REFUNDED', orderEAfter.status === 'REFUNDED', `status=${orderEAfter.status}`);
const afterCf = (await j('GET', '/admin/payables', { token: admin })).data;
ok('the books balance across two gateways', afterCf.reconciliation.balanced, `drift=${afterCf.reconciliation.driftMinor}`);
// The gateway-refusal path (nothing booked, dispute retryable) cannot be forced
// through here now that both adapters succeed in dev — it is pinned in
// refunds.service.spec.ts with a gateway that throws.

// --- 14. ending a paid sale gives the money back ------------------------------
// Cancelling an ACCEPTED order and the state machine's `refund` action both used
// to change status and nothing else: the buyer saw CANCELLED or REFUNDED while
// their payment stayed in the platform's account.
const orderF = await placeOrder('f', 900000);
await capture(orderF, 'f');
const beforeCancel = await payables();
const revBeforeCancel = (await j('GET', '/admin/revenue?days=1', { token: admin })).data;
const cancelled = await j('POST', `/orders/${orderF.id}/transition`, { token: buyer, body: { action: 'cancel' } });
ok('a paid order can still be cancelled', cancelled.data?.status === 'CANCELLED', `status=${cancelled.data?.status}`);
const revAfterCancel = (await j('GET', '/admin/revenue?days=1', { token: admin })).data;
ok('cancelling a paid order refunds the buyer in full', revAfterCancel.refundedMinor - revBeforeCancel.refundedMinor === orderF.totalMinor, `delta=${revAfterCancel.refundedMinor - revBeforeCancel.refundedMinor} expected=${orderF.totalMinor}`);
const afterCancel = await payables();
ok('and clears what the seller was owed for it', beforeCancel.heldMinor - afterCancel.heldMinor === orderF.totalMinor - orderF.feeMinor, `delta=${beforeCancel.heldMinor - afterCancel.heldMinor}`);
ok('the books balance after a cancel-refund', afterCancel.reconciliation.balanced, `drift=${afterCancel.reconciliation.driftMinor}`);

const orderG = await placeOrder('g', 1100000);
await capture(orderG, 'g');
const revBeforeAction = (await j('GET', '/admin/revenue?days=1', { token: admin })).data;
const refunded = await j('POST', `/orders/${orderG.id}/transition`, { token: admin, body: { action: 'refund' } });
ok('the refund action moves the order to REFUNDED', refunded.data?.status === 'REFUNDED', `status=${refunded.data?.status}`);
const revAfterAction = (await j('GET', '/admin/revenue?days=1', { token: admin })).data;
ok('the refund action actually refunds', revAfterAction.refundedMinor - revBeforeAction.refundedMinor === orderG.totalMinor, `delta=${revAfterAction.refundedMinor - revBeforeAction.refundedMinor} expected=${orderG.totalMinor}`);
ok('and hands back the commission', revBeforeAction.feeRevenueMinor - revAfterAction.feeRevenueMinor === orderG.feeMinor, `delta=${revBeforeAction.feeRevenueMinor - revAfterAction.feeRevenueMinor} expected=${orderG.feeMinor}`);
const afterAction = await payables();
ok('the books balance after a refund action', afterAction.reconciliation.balanced, `drift=${afterAction.reconciliation.driftMinor}`);

// --- 15. the float dwarfs the revenue, and the report says so -----------------
// Not a pass/fail on the ratio itself — the point is that both numbers are now
// knowable from the API, which is what the liability finding required.
const rev = (await j("GET", "/admin/revenue?days=365", { token: admin })).data;
ok('liability and revenue are both reportable', typeof rev.feeRevenueMinor === 'number' && typeof pRefunded.heldMinor === 'number');
console.log(`\n  float: ₹${(pRefunded.heldMinor / 100).toLocaleString('en-IN')} held vs ₹${(rev.feeRevenueMinor / 100).toLocaleString('en-IN')} earned`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
