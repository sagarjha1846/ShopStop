/**
 * Inventory / oversell E2E.
 *
 * Flash-sale scenario: one listing with limited stock, many buyers checking out at
 * the same instant. The invariant under test is that the platform never sells more
 * units than exist — no matter how the concurrent requests interleave.
 *
 * Run against a live API:  node apps/api/test/e2e/inventory.e2e.mjs
 */
const B = 'http://localhost:4000/api/v1';
let pass = 0,
  fail = 0;
const ok = (n, c, e = '') => {
  console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? ' — ' + e : ''}`);
  c ? pass++ : fail++;
};

async function j(method, path, { token, body, headers } = {}) {
  const res = await fetch(B + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

const login = async (email, password) =>
  (await j('POST', '/auth/login', { body: { email, password } })).data.accessToken;

const RUN = Date.now().toString(36);
const STOCK = 5;
const BUYERS = 14;

// Each suite sells as its own freshly-registered account. Sharing one seller across
// suites makes them collide: the risk engine holds a seller who posts 10+ listings in
// an hour, and a full pass creates roughly that many, so a second pass would land every
// listing in PENDING_REVIEW instead of ACTIVE.
const seller = (await j('POST', '/auth/register', { body: { email: `inve_seller_${RUN}@example.com`, password: 'sellerpassword1', displayName: 'Test Seller' } })).data.accessToken;
const cats = (await j('GET', '/categories')).data;
const catId = cats
  .find((c) => c.slug === 'electronics')
  .children.find((c) => c.slug === 'mobile-phones').id;

const listing = (
  await j('POST', '/listings', {
    token: seller,
    body: {
      categoryId: catId,
      title: `Flash Sale Handset ${RUN}`,
      description: 'Limited stock drop for the concurrency test. Sealed box, full warranty.',
      priceMinor: 100000,
      quantity: STOCK,
      condition: 'NEW',
      attributes: { brand: 'Google', model: 'Pixel 8', storage: '128GB' },
      publish: true,
    },
  })
).data;
ok(
  'listing ACTIVE with stock',
  listing.status === 'ACTIVE' && listing.quantity === STOCK,
  `qty=${listing.quantity}`,
);

// Register the stampede of buyers up front so the burst itself is pure checkout.
const buyers = [];
for (let i = 0; i < BUYERS; i++) {
  const r = await j('POST', '/auth/register', {
    body: {
      email: `rush_${RUN}_${i}@example.com`,
      password: 'buyerpassword1',
      displayName: `Rush Buyer ${i}`,
    },
  });
  buyers.push(r.data.accessToken);
}
ok('buyers registered', buyers.every(Boolean), `${buyers.filter(Boolean).length}/${BUYERS}`);

// --- the stampede: every buyer checks out the same unit at the same moment ---
const results = await Promise.all(
  buyers.map((token, i) =>
    j('POST', '/orders', {
      token,
      headers: { 'idempotency-key': `rush-${RUN}-${i}` },
      body: { listingId: listing.id, quantity: 1 },
    }),
  ),
);

const created = results.filter((r) => r.status === 201);
const rejected = results.filter((r) => r.status !== 201);

ok(
  `exactly ${STOCK} orders accepted, ${BUYERS - STOCK} turned away`,
  created.length === STOCK && rejected.length === BUYERS - STOCK,
  `created=${created.length} rejected=${rejected.length}`,
);
ok(
  'losers get a clean out-of-stock error (409), not a 500',
  rejected.every((r) => r.status === 409),
  `statuses=${[...new Set(rejected.map((r) => r.status))].join(',')}`,
);

const afterRush = (await j('GET', `/listings/${listing.id}`)).data;
ok('stock never goes negative', afterRush.quantity >= 0, `qty=${afterRush.quantity}`);
ok('stock fully reserved by winners', afterRush.quantity === 0, `qty=${afterRush.quantity}`);
ok('depleted listing no longer ACTIVE', afterRush.status === 'SOLD', `status=${afterRush.status}`);

// --- accepting the winning orders must not double-decrement ---
await Promise.all(
  created.map((r) =>
    j('POST', `/orders/${r.data.id}/transition`, { token: seller, body: { action: 'accept' } }),
  ),
);
const afterAccept = (await j('GET', `/listings/${listing.id}`)).data;
ok('accept does not double-decrement', afterAccept.quantity === 0, `qty=${afterAccept.quantity}`);

// --- a cancelled order returns its unit to the pool ---
const firstOrder = created[0].data;
const cancelToken = buyers[results.indexOf(created[0])];
const cancelled = await j('POST', `/orders/${firstOrder.id}/transition`, {
  token: cancelToken,
  body: { action: 'cancel' },
});
ok('buyer can cancel', cancelled.status === 201, `status=${cancelled.status}`);
const afterCancel = (await j('GET', `/listings/${listing.id}`)).data;
ok(
  'cancelled unit restocked exactly once',
  afterCancel.quantity === 1,
  `qty=${afterCancel.quantity}`,
);
ok('restock relists the item', afterCancel.status === 'ACTIVE', `status=${afterCancel.status}`);

// --- cancelling twice must not mint phantom stock ---
const doubleCancel = await j('POST', `/orders/${firstOrder.id}/transition`, {
  token: cancelToken,
  body: { action: 'cancel' },
});
ok('double-cancel rejected', doubleCancel.status >= 400, `status=${doubleCancel.status}`);
const afterDouble = (await j('GET', `/listings/${listing.id}`)).data;
ok(
  'no phantom stock from double-cancel',
  afterDouble.quantity === 1,
  `qty=${afterDouble.quantity}`,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
