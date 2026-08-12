// Black-box E2E for feature flags (docs/03 §13) — proving they change behaviour,
// not just that they persist.
// Run: node apps/api/test/e2e/feature-flags.e2e.mjs   (API on :4000)
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
// No wait needed: set() clears this instance's cache, and the API under test is a
// single process. The 30s TTL only governs propagation to *other* instances,
// which a single-node test cannot exercise either way.

const admin = await login('admin@shopstop.local', 'AdminPass123!');
const buyer = (await j('POST', '/auth/register', { body: { email: `flag_${RUN}@example.com`, password: 'flagpass12345' } })).data.accessToken;

// --- 1. listing + authorization ----------------------------------------------
const anon = await j('GET', '/admin/feature-flags');
ok('flags require auth', anon.status === 401, `status=${anon.status}`);
const asUser = await j('GET', '/admin/feature-flags', { token: buyer });
ok('non-admin cannot read flags', asUser.status === 403, `status=${asUser.status}`);

const flags = (await j('GET', '/admin/feature-flags', { token: admin })).data;
ok('lists declared flags even when never set', Array.isArray(flags) && flags.length >= 2, `n=${flags?.length}`);
const commission = flags.find((f) => f.key === 'monetization.commission');
ok('commission flag declared with a label + description', !!commission?.label && !!commission?.description);
ok('commission defaults on', commission.enabled === true);
const unknown = await j('PUT', '/admin/feature-flags/not.a.real.flag', { token: admin, body: { enabled: false } });
ok('unknown flag keys rejected as bad input (422, not 500)', unknown.status === 422, `status=${unknown.status}`);

// --- 2. the commission flag actually changes pricing --------------------------
const cats = (await j('GET', '/categories')).data;
const catId = cats.find((c) => c.slug === 'electronics').children.find((c) => c.slug === 'mobile-phones').id;
const listing = (await j('POST', '/listings', { token: admin, body: { categoryId: catId, title: `Flag Phone ${RUN}`, description: 'feature flag pricing test', priceMinor: 1000000, quantity: 5, attributes: { brand: 'B', model: 'M', storage: '128GB' }, publish: true } })).data;
if (listing.status === 'PENDING_REVIEW') {
  await j('POST', `/admin/moderation/LISTING/${listing.id}/action`, { token: admin, body: { decision: 'APPROVE' } });
}

const withFee = (await j('POST', '/orders', { token: buyer, key: `flag-on-${RUN}`, body: { listingId: listing.id } })).data;
ok('commission charged while the flag is on', withFee.feeMinor > 0, `fee=${withFee.feeMinor}`);

await j('PUT', '/admin/feature-flags/monetization.commission', { token: admin, body: { enabled: false } });
const noFee = (await j('POST', '/orders', { token: buyer, key: `flag-off-${RUN}`, body: { listingId: listing.id } })).data;
ok('commission drops to zero with the flag off', noFee.feeMinor === 0, `fee=${noFee.feeMinor}`);
ok('the buyer still pays the same total', noFee.totalMinor === withFee.totalMinor, `${noFee.totalMinor} vs ${withFee.totalMinor}`);

// Flipping back must not re-price the order that was placed while it was off.
await j('PUT', '/admin/feature-flags/monetization.commission', { token: admin, body: { enabled: true } });
const reread = (await j('GET', `/orders/${noFee.id}`, { token: buyer })).data;
ok('a fee-free order stays fee-free after re-enabling', reread.feeMinor === 0, `fee=${reread.feeMinor}`);
const afterOn = (await j('POST', '/orders', { token: buyer, key: `flag-back-${RUN}`, body: { listingId: listing.id } })).data;
ok('new orders are charged again', afterOn.feeMinor > 0, `fee=${afterOn.feeMinor}`);

// --- 3. the Q&A kill switch actually closes the surface -----------------------
const asked = await j('POST', `/listings/${listing.id}/questions`, { token: buyer, body: { body: 'Is this still available to buy?' } });
ok('questions open while the flag is on', asked.status === 201, `status=${asked.status}`);

await j('PUT', '/admin/feature-flags/listings.questions', { token: admin, body: { enabled: false } });
const blocked = await j('POST', `/listings/${listing.id}/questions`, { token: buyer, body: { body: 'Another question while closed' } });
ok('asking is refused with the flag off', blocked.status === 409, `status=${blocked.status}`);
const stillReadable = await j('GET', `/listings/${listing.id}/questions`);
ok('existing answers stay readable when closed', stillReadable.status === 200 && stillReadable.data.length >= 1, `n=${stillReadable.data?.length}`);

await j('PUT', '/admin/feature-flags/listings.questions', { token: admin, body: { enabled: true } });
const reopened = await j('POST', `/listings/${listing.id}/questions`, { token: buyer, body: { body: 'Reopened and asking again' } });
ok('asking works once reopened', reopened.status === 201, `status=${reopened.status}`);

// Audit of flag changes has no read endpoint to assert against over HTTP; it is
// verified directly against the audit table instead (see the commit message).

// Flags are global state: leaving one off would silently change how every other
// suite prices orders. Restore unconditionally, including after a failure.
for (const key of ['monetization.commission', 'listings.questions']) {
  await j('PUT', `/admin/feature-flags/${key}`, { token: admin, body: { enabled: true } });
}
const restored = (await j('GET', '/admin/feature-flags', { token: admin })).data;
ok('flags restored to on before exit', restored.every((f) => f.enabled), JSON.stringify(restored.map((f) => [f.key, f.enabled])));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
