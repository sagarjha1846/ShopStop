const B = 'http://localhost:4000/api/v1';
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
// Each suite sells as its own freshly-registered account. Sharing one seller across
// suites makes them collide: the risk engine holds a seller who posts 10+ listings in
// an hour, and a full pass creates roughly that many, so a second pass would land every
// listing in PENDING_REVIEW instead of ACTIVE.
const seller = (await j('POST', '/auth/register', { body: { email: `coup_seller_${RUN}@example.com`, password: 'sellerpassword1', displayName: 'Test Seller' } })).data.accessToken;
const buyer = (await j('POST', '/auth/register', { body: { email: `coup_${RUN}@example.com`, password: 'couppass12345' } })).data.accessToken;

// Admin lists a cheap item and creates a platform-wide 20% coupon, max 1 redemption.
const cats = (await j('GET', '/categories')).data;
const catId = cats.find((c) => c.slug === 'electronics').children.find((c) => c.slug === 'mobile-phones').id;
const listing = (await j('POST', '/listings', { token: seller, body: { categoryId: catId, title: `Coupon Phone ${RUN}`, description: 'coupon test listing here', priceMinor: 1000000, quantity: 5, attributes: { brand: 'B', model: 'M', storage: '128GB' }, publish: true } })).data;
const code = `SAVE20_${RUN}`.toUpperCase();
const coupon = await j('POST', '/coupons', { token: admin, body: { code, type: 'PERCENT', value: 20, maxRedemptions: 1, platformWide: true } });
ok('admin creates coupon', coupon.status === 201, `status=${coupon.status}`);

// non-admin cannot create a platform-wide coupon (it becomes seller-scoped) — sanity: seller coupon created
const sellerCoupon = await j('POST', '/coupons', { token: buyer, body: { code: `MY_${RUN}`.toUpperCase(), type: 'FLAT', value: 5000 } });
ok('user creates seller-scoped coupon', sellerCoupon.status === 201);

// Order with the 20% coupon → total = 1000000 - 200000 = 800000.
const order = await j('POST', '/orders', { token: buyer, key: `c1-${RUN}`, body: { listingId: listing.id, couponCode: code } });
ok('order applies 20% discount', order.data?.discountMinor === 200000 && order.data?.totalMinor === 800000, `discount=${order.data?.discountMinor} total=${order.data?.totalMinor}`);

// Second order with same (max 1) coupon → limit reached (409).
const buyer2 = (await j('POST', '/auth/register', { body: { email: `coup2_${RUN}@example.com`, password: 'couppass12345' } })).data.accessToken;
const order2 = await j('POST', '/orders', { token: buyer2, key: `c2-${RUN}`, body: { listingId: listing.id, couponCode: code } });
ok('coupon limit enforced (409)', order2.status === 409, `status=${order2.status}`);

// Cancel the first order → redemption released → a new order can use it again.
await j('POST', `/orders/${order.data.id}/transition`, { token: buyer, body: { action: 'cancel' } });
const order3 = await j('POST', '/orders', { token: buyer2, key: `c3-${RUN}`, body: { listingId: listing.id, couponCode: code } });
ok('redemption released on cancel (reusable)', order3.status === 201 && order3.data.discountMinor === 200000, `status=${order3.status}`);

// Invalid + expired coupons.
const bad = await j('POST', '/orders', { token: buyer, key: `c4-${RUN}`, body: { listingId: listing.id, couponCode: 'NOPE' } });
ok('invalid coupon rejected (422)', bad.status === 422, `status=${bad.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
