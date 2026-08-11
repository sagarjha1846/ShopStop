// Black-box E2E for paid seller plans (ShopStop Pro).
// Also asserts the plan sells capability and NOT trust — the verification badge
// must remain unobtainable by paying.
// Run: node apps/api/test/e2e/subscriptions.e2e.mjs   (API on :4000)
import { createHmac } from 'node:crypto';

const B = 'http://localhost:4000/api/v1';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'whsec_xxxxxxxx';
const RUN = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
async function j(method, path, { token, body } = {}) {
  const res = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await res.json(); } catch {}
  return { status: res.status, data: d };
}
const login = async (e, p) => (await j('POST', '/auth/login', { body: { email: e, password: p } })).data.accessToken;

const admin = await login('admin@shopstop.local', 'AdminPass123!');
const seller = (await j('POST', '/auth/register', { body: { email: `pro_${RUN}@example.com`, password: 'propass123456', displayName: 'Pro Seller' } })).data.accessToken;

// --- 1. plans are public and honest about what money does not buy -------------
const anonPlans = await j('GET', '/subscriptions/plans');
ok('plans are public (pricing before sign-up)', anonPlans.status === 200, `status=${anonPlans.status}`);
const pro = anonPlans.data.plans.find((p) => p.plan === 'PRO');
ok('Pro is priced', pro.priceMinor > 0, `price=${pro.priceMinor}`);
ok('Pro raises the listing allowance', pro.listingsPerHour > anonPlans.data.plans.find((p) => p.plan === 'FREE').listingsPerHour);
ok('Pro includes boost credit', pro.includedBoostDays > 0, `days=${pro.includedBoostDays}`);
ok('plan states badges are not for sale', pro.notIncluded.some((s) => /badge/i.test(s)), JSON.stringify(pro.notIncluded));

// --- 2. sellers start on FREE -------------------------------------------------
const before = (await j('GET', '/me/subscription', { token: seller })).data;
ok('new seller is on the free plan', before.plan === 'FREE', `plan=${before.plan}`);
ok('free allowance applies', before.listingsPerHour === anonPlans.data.plans.find((p) => p.plan === 'FREE').listingsPerHour);

// --- 3. subscribing does not grant benefits until payment ---------------------
const buy = await j('POST', '/subscriptions', { token: seller });
ok('subscribe returns a payment intent', buy.status === 201 && !!buy.data.providerOrderId, `status=${buy.status}`);
ok('priced at the published rate', buy.data.amountMinor === pro.priceMinor, `amount=${buy.data?.amountMinor}`);
const midway = (await j('GET', '/me/subscription', { token: seller })).data;
ok('still FREE before the payment lands', midway.plan === 'FREE', `plan=${midway.plan}`);

// --- 4. capture activates the plan and books its own revenue stream -----------
const revBefore = (await j('GET', '/admin/revenue?days=1', { token: admin })).data;
const evt = { event: 'payment.captured', payload: { payment: { entity: { id: `subpay_${RUN}`, order_id: buy.data.providerOrderId, amount: buy.data.amountMinor, method: 'upi' } } } };
const raw = JSON.stringify(evt);
const sig = createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
const fire = () => fetch(`${B}/payments/webhook/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig }, body: raw });
ok('subscription capture accepted', (await fire()).status === 200);

const after = (await j('GET', '/me/subscription', { token: seller })).data;
ok('plan is now PRO', after.plan === 'PRO', `plan=${after.plan}`);
ok('Pro listing allowance applies', after.listingsPerHour === pro.listingsPerHour, `allowance=${after.listingsPerHour}`);
ok('period end is set', !!after.currentPeriodEnd);

const revAfter = (await j('GET', '/admin/revenue?days=1', { token: admin })).data;
ok('subscription revenue booked', revAfter.subscriptionRevenueMinor - revBefore.subscriptionRevenueMinor === pro.priceMinor, `delta=${revAfter.subscriptionRevenueMinor - revBefore.subscriptionRevenueMinor}`);
ok('subscription revenue is not GMV', revAfter.gmvMinor === revBefore.gmvMinor, `${revAfter.gmvMinor} vs ${revBefore.gmvMinor}`);
ok('subscription revenue is not commission', revAfter.commissionRevenueMinor === revBefore.commissionRevenueMinor);
ok('take rate unaffected by subscription income', revAfter.takeRatePct === revBefore.takeRatePct, `${revAfter.takeRatePct} vs ${revBefore.takeRatePct}`);

// --- 5. paying never buys a trust badge --------------------------------------
const me = (await j('GET', '/me/profile', { token: seller })).data;
const publicProfile = (await j('GET', `/users/${me.profile.handle}`)).data;
ok('paying does NOT grant the BUSINESS badge', !publicProfile.badges.includes('BUSINESS'), `badges=${publicProfile.badges}`);
ok('paying does NOT grant the IDENTITY badge', !publicProfile.badges.includes('IDENTITY'), `badges=${publicProfile.badges}`);

// --- 6. duplicate + concurrent deliveries book once ---------------------------
await fire();
const revReplay = (await j('GET', '/admin/revenue?days=1', { token: admin })).data;
ok('replayed capture does not double-book', revReplay.subscriptionRevenueMinor === revAfter.subscriptionRevenueMinor, `${revReplay.subscriptionRevenueMinor} vs ${revAfter.subscriptionRevenueMinor}`);

// --- 7. guards ----------------------------------------------------------------
const dupe = await j('POST', '/subscriptions', { token: seller });
ok('cannot subscribe twice while active', dupe.status === 409, `status=${dupe.status}`);
const anonSub = await j('POST', '/subscriptions');
ok('subscribing requires auth', anonSub.status === 401, `status=${anonSub.status}`);

// --- 7b. the raised allowance is actually enforced by the risk engine ---------
// Not just reported by the endpoint: publish past the free limit as each seller
// and compare what the risk engine does.
const cats = (await j('GET', '/categories')).data;
const catId = cats.find((c) => c.slug === 'electronics').children.find((c) => c.slug === 'mobile-phones').id;
const freeSeller = (await j('POST', '/auth/register', { body: { email: `free_${RUN}@example.com`, password: 'freepass123456' } })).data.accessToken;

const publish = async (token, i) =>
  (await j('POST', '/listings', { token, body: { categoryId: catId, title: `Velocity ${RUN} ${i}`, description: 'listing velocity allowance test', priceMinor: 100000, attributes: { brand: 'B', model: 'M', storage: '128GB' }, publish: true } })).data.status;

const freeStatuses = [];
for (let i = 0; i < 12; i++) freeStatuses.push(await publish(freeSeller, i));
ok('free seller is held once past the free allowance', freeStatuses.includes('PENDING_REVIEW'), `statuses=${freeStatuses.slice(-3)}`);

const proStatuses = [];
for (let i = 0; i < 12; i++) proStatuses.push(await publish(seller, i));
ok('Pro seller publishes straight through at the same volume', proStatuses.every((s) => s === 'ACTIVE'), `statuses=${proStatuses.slice(-3)}`);

// --- 8. cancelling keeps the period already paid for --------------------------
const cancelled = await j('DELETE', '/me/subscription', { token: seller });
ok('cancel succeeds', cancelled.status === 200, `status=${cancelled.status}`);
const afterCancel = (await j('GET', '/me/subscription', { token: seller })).data;
ok('benefits survive until the period ends', afterCancel.plan === 'PRO' && afterCancel.listingsPerHour === pro.listingsPerHour, `plan=${afterCancel.plan} allowance=${afterCancel.listingsPerHour}`);
ok('status reflects the cancellation', afterCancel.status === 'CANCELLED', `status=${afterCancel.status}`);
const cancelTwice = await j('DELETE', '/me/subscription', { token: seller });
ok('cancelling twice is not an error', cancelTwice.status === 200, `status=${cancelTwice.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
