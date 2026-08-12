// Black-box E2E for the funnel report — the PRD's success metrics (docs/01 §7)
// computed from live operational data.
// Run: node apps/api/test/e2e/funnel.e2e.mjs   (API on :4000)
const B = 'http://localhost:4000/api/v1';
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
const buyer = (await j('POST', '/auth/register', { body: { email: `funnel_${RUN}@example.com`, password: 'funnelpass123' } })).data.accessToken;

// --- 1. authorization ---------------------------------------------------------
const anon = await j('GET', '/admin/funnel');
ok('funnel requires auth', anon.status === 401, `status=${anon.status}`);
const asUser = await j('GET', '/admin/funnel', { token: buyer });
ok('non-admin cannot read the funnel', asUser.status === 403, `status=${asUser.status}`);

// --- 2. shape and the PRD targets --------------------------------------------
const r = (await j('GET', '/admin/funnel?days=30', { token: admin })).data;
ok('reports the window', r.windowDays === 30 && !!r.since, `days=${r.windowDays}`);
const byKey = Object.fromEntries(r.metrics.map((m) => [m.key, m]));
for (const k of ['acquisition', 'activation', 'liquidity', 'conversion', 'disputeRate', 'verifiedParty', 'retention']) {
  ok(`reports ${k}`, !!byKey[k], Object.keys(byKey).join(','));
}
ok('liquidity carries the docs/01 target (>=15%)', byKey.liquidity.target === 15 && byKey.liquidity.targetDirection === 'gte');
ok('conversion carries the docs/01 target (>=8%)', byKey.conversion.target === 8);
ok('dispute rate is a lower-is-better target (<=2)', byKey.disputeRate.target === 2 && byKey.disputeRate.targetDirection === 'lte');
ok('states what is not measurable yet', Array.isArray(r.notMeasurable) && r.notMeasurable.length > 0 && !!r.notMeasurable[0].reason);

// --- 3. invariants ------------------------------------------------------------
// A reported percentage must follow from its own counts, or the number is decorative.
const pctOk = r.metrics
  .filter((m) => m.unit === 'pct' && m.value !== null)
  .every((m) => Math.abs(m.value - (m.numerator / m.denominator) * 100) < 0.11);
ok('percentages match their numerator/denominator', pctOk, JSON.stringify(r.metrics.filter((m) => m.unit === 'pct').map((m) => [m.key, m.value, m.numerator, m.denominator])));
ok('no numerator exceeds its denominator', r.metrics.every((m) => m.numerator <= m.denominator || m.unit === 'count'));
ok('empty denominators report null, not a fake zero', r.metrics.every((m) => m.denominator > 0 || m.value === null || m.unit === 'count'));

// --- 4. the report tracks real activity ---------------------------------------
const before = (await j('GET', '/admin/funnel?days=30', { token: admin })).data;
const beforeLiquidity = before.metrics.find((m) => m.key === 'liquidity');

const cats = (await j('GET', '/categories')).data;
const catId = cats.find((c) => c.slug === 'electronics').children.find((c) => c.slug === 'mobile-phones').id;
const listing = (await j('POST', '/listings', { token: admin, body: { categoryId: catId, title: `Funnel Phone ${RUN}`, description: 'funnel metric test listing', priceMinor: 250000, attributes: { brand: 'B', model: 'M', storage: '128GB' }, publish: true } })).data;
if (listing.status === 'PENDING_REVIEW') {
  await j('POST', `/admin/moderation/LISTING/${listing.id}/action`, { token: admin, body: { decision: 'APPROVE' } });
}

const afterListing = (await j('GET', '/admin/funnel?days=30', { token: admin })).data;
const midLiquidity = afterListing.metrics.find((m) => m.key === 'liquidity');
ok('publishing a listing widens the liquidity denominator', midLiquidity.denominator === beforeLiquidity.denominator + 1, `${beforeLiquidity.denominator} -> ${midLiquidity.denominator}`);
ok('an unmessaged listing does not move the numerator', midLiquidity.numerator === beforeLiquidity.numerator, `${beforeLiquidity.numerator} -> ${midLiquidity.numerator}`);

await j('POST', '/threads', { token: buyer, body: { listingId: listing.id } });
const afterThread = (await j('GET', '/admin/funnel?days=30', { token: admin })).data;
const endLiquidity = afterThread.metrics.find((m) => m.key === 'liquidity');
ok('a first message moves the liquidity numerator', endLiquidity.numerator === midLiquidity.numerator + 1, `${midLiquidity.numerator} -> ${endLiquidity.numerator}`);
const endConversion = afterThread.metrics.find((m) => m.key === 'conversion');
ok('an unpaid thread counts in conversion denominator only', endConversion.denominator > 0);

// --- 5. window is honoured ----------------------------------------------------
const narrow = (await j('GET', '/admin/funnel?days=1', { token: admin })).data;
ok('a shorter window never reports more than a longer one', narrow.metrics.find((m) => m.key === 'liquidity').denominator <= endLiquidity.denominator);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
