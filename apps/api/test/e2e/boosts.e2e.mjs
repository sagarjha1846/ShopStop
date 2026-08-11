// Black-box E2E for paid sponsored placement: a boost is sold, not granted.
// Run: node apps/api/test/e2e/boosts.e2e.mjs   (API on :4000)
import { createHmac } from 'node:crypto';

const B = 'http://localhost:4000/api/v1';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'whsec_xxxxxxxx';
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
const other = (await j('POST', '/auth/register', { body: { email: `boost_${RUN}@example.com`, password: 'boostpass1234' } })).data.accessToken;

const cats = (await j('GET', '/categories')).data;
const catId = cats.find((c) => c.slug === 'electronics').children.find((c) => c.slug === 'mobile-phones').id;
const listing = (await j('POST', '/listings', { token: seller, body: { categoryId: catId, title: `Boost Phone ${RUN}`, description: 'boost purchase test listing', priceMinor: 500000, quantity: 2, attributes: { brand: 'B', model: 'M', storage: '128GB' }, publish: true } })).data;
if (listing.status === 'PENDING_REVIEW') {
  await j('POST', `/admin/moderation/LISTING/${listing.id}/action`, { token: seller, body: { decision: 'APPROVE' } });
}

// --- 1. pricing is published ---------------------------------------------------
const pricing = (await j('GET', '/boosts/pricing', { token: seller })).data;
ok('pricing exposes a per-day rate', pricing.pricePerDayMinor > 0, `perDay=${pricing.pricePerDayMinor}`);
const sevenDay = pricing.examples.find((e) => e.days === 7);
ok('7-day quote = 7 x per-day', sevenDay.amountMinor === pricing.pricePerDayMinor * 7, `quote=${sevenDay.amountMinor}`);

// --- 2. buying a boost does NOT grant placement until payment ------------------
const buy = await j('POST', `/listings/${listing.id}/boost`, { token: seller, body: { days: 7 } });
ok('boost purchase returns a payment intent', buy.status === 201 && !!buy.data.providerOrderId, `status=${buy.status}`);
ok('boost priced at the published rate', buy.data.amountMinor === pricing.pricePerDayMinor * 7, `amount=${buy.data?.amountMinor}`);

const beforePay = (await j('GET', `/listings/${listing.id}`)).data;
ok('listing NOT boosted before payment', !beforePay.boostedUntil, `boostedUntil=${beforePay.boostedUntil}`);
const pendingList = (await j('GET', '/me/boosts', { token: seller })).data;
ok('purchase recorded as PENDING_PAYMENT', pendingList.some((b) => b.id === buy.data.boostId && b.status === 'PENDING_PAYMENT'));

// --- 3. capture activates the boost and books the revenue ---------------------
const revBefore = (await j('GET', '/admin/revenue?days=1', { token: seller })).data;
const evt = { event: 'payment.captured', payload: { payment: { entity: { id: `bpay_${RUN}`, order_id: buy.data.providerOrderId, amount: buy.data.amountMinor, method: 'upi' } } } };
const raw = JSON.stringify(evt);
const sig = createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
const fire = () => fetch(`${B}/payments/webhook/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig }, body: raw });
ok('boost capture webhook accepted', (await fire()).status === 200);

const afterPay = (await j('GET', `/listings/${listing.id}`)).data;
ok('listing boosted after payment', !!afterPay.boostedUntil, `boostedUntil=${afterPay.boostedUntil}`);
const days = afterPay.boostedUntil ? Math.round((new Date(afterPay.boostedUntil) - Date.now()) / 86400000) : 0;
ok('boost window matches the days purchased', days === 7, `days=${days}`);
const activeList = (await j('GET', '/me/boosts', { token: seller })).data;
ok('purchase now ACTIVE', activeList.some((b) => b.id === buy.data.boostId && b.status === 'ACTIVE'));

const revAfter = (await j('GET', '/admin/revenue?days=1', { token: seller })).data;
ok('boost revenue booked', revAfter.boostRevenueMinor - revBefore.boostRevenueMinor === buy.data.amountMinor, `delta=${revAfter.boostRevenueMinor - revBefore.boostRevenueMinor}`);
ok('boost revenue does NOT inflate GMV', revAfter.gmvMinor === revBefore.gmvMinor, `${revAfter.gmvMinor} vs ${revBefore.gmvMinor}`);
ok('commission stream unchanged by a boost', revAfter.commissionRevenueMinor === revBefore.commissionRevenueMinor);

// --- 4. duplicate + concurrent deliveries book once ---------------------------
await fire();
const revReplay = (await j('GET', '/admin/revenue?days=1', { token: seller })).data;
ok('replayed boost webhook does not double-book', revReplay.boostRevenueMinor === revAfter.boostRevenueMinor, `${revReplay.boostRevenueMinor} vs ${revAfter.boostRevenueMinor}`);

const buy2 = (await j('POST', `/listings/${listing.id}/boost`, { token: seller, body: { days: 3 } })).data;
const evt2 = { event: 'payment.captured', payload: { payment: { entity: { id: `bpay2_${RUN}`, order_id: buy2.providerOrderId, amount: buy2.amountMinor, method: 'upi' } } } };
const raw2 = JSON.stringify(evt2);
const sig2 = createHmac('sha256', WEBHOOK_SECRET).update(raw2).digest('hex');
const fire2 = () => fetch(`${B}/payments/webhook/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig2 }, body: raw2 });
const beforeRace = (await j('GET', '/admin/revenue?days=1', { token: seller })).data;
await Promise.all([fire2(), fire2(), fire2(), fire2()]);
const afterRace = (await j('GET', '/admin/revenue?days=1', { token: seller })).data;
ok('4 concurrent boost deliveries book exactly once', afterRace.boostRevenueMinor - beforeRace.boostRevenueMinor === buy2.amountMinor, `delta=${afterRace.boostRevenueMinor - beforeRace.boostRevenueMinor} expected=${buy2.amountMinor}`);

// stacking: the second boost extends the window rather than truncating it
const stacked = (await j('GET', `/listings/${listing.id}`)).data;
const stackedDays = Math.round((new Date(stacked.boostedUntil) - Date.now()) / 86400000);
ok('a second boost extends the window (7 + 3)', stackedDays === 10, `days=${stackedDays}`);

// --- 5. authorization + guards -------------------------------------------------
const notOwner = await j('POST', `/listings/${listing.id}/boost`, { token: other, body: { days: 7 } });
ok('non-owner cannot boost the listing', notOwner.status === 403, `status=${notOwner.status}`);
const anon = await j('POST', `/listings/${listing.id}/boost`, { body: { days: 7 } });
ok('boost requires auth', anon.status === 401, `status=${anon.status}`);
const badDays = await j('POST', `/listings/${listing.id}/boost`, { token: seller, body: { days: 999 } });
ok('days above the cap rejected', badDays.status === 422, `status=${badDays.status}`);
const unknown = await j('POST', `/listings/does-not-exist/boost`, { token: seller, body: { days: 7 } });
ok('boosting an unknown listing -> 404', unknown.status === 404, `status=${unknown.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
