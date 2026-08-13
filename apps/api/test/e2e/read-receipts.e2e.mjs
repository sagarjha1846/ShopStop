// Black-box E2E for chat read state (docs/03 §6): unread counts and read receipts.
// Run: node apps/api/test/e2e/read-receipts.e2e.mjs   (API on :4000)
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
const threadOf = (list, id) => list.find((t) => t.id === id);

const seller = await login('admin@shopstop.local', 'AdminPass123!');
const buyer = (await j('POST', '/auth/register', { body: { email: `read_${RUN}@example.com`, password: 'readpass12345' } })).data.accessToken;

const cats = (await j('GET', '/categories')).data;
const catId = cats.find((c) => c.slug === 'electronics').children.find((c) => c.slug === 'mobile-phones').id;
const listing = (await j('POST', '/listings', { token: seller, body: { categoryId: catId, title: `Read Phone ${RUN}`, description: 'read receipt test listing', priceMinor: 350000, attributes: { brand: 'B', model: 'M', storage: '128GB' }, publish: true } })).data;
if (listing.status === 'PENDING_REVIEW') {
  await j('POST', `/admin/moderation/LISTING/${listing.id}/action`, { token: seller, body: { decision: 'APPROVE' } });
}
const thread = (await j('POST', '/threads', { token: buyer, body: { listingId: listing.id } })).data;

// --- 1. unread counts ---------------------------------------------------------
await j('POST', `/threads/${thread.id}/messages`, { token: buyer, body: { kind: 'TEXT', body: `first ${RUN}` } });
await j('POST', `/threads/${thread.id}/messages`, { token: buyer, body: { kind: 'TEXT', body: `second ${RUN}` } });

const sellerInbox = (await j('GET', '/threads', { token: seller })).data;
ok('seller sees both messages as unread', threadOf(sellerInbox, thread.id)?.unreadCount === 2, `unread=${threadOf(sellerInbox, thread.id)?.unreadCount}`);

const buyerInbox = (await j('GET', '/threads', { token: buyer })).data;
ok('your own messages are never unread to you', threadOf(buyerInbox, thread.id)?.unreadCount === 0, `unread=${threadOf(buyerInbox, thread.id)?.unreadCount}`);

// --- 2. reading clears the count ---------------------------------------------
await j('GET', `/threads/${thread.id}/messages`, { token: seller });
const afterRead = (await j('GET', '/threads', { token: seller })).data;
ok('opening the thread clears the unread count', threadOf(afterRead, thread.id)?.unreadCount === 0, `unread=${threadOf(afterRead, thread.id)?.unreadCount}`);

// --- 3. read receipts ---------------------------------------------------------
const buyerView = (await j('GET', '/threads', { token: buyer })).data;
const receipt = threadOf(buyerView, thread.id)?.counterpartyLastReadAt;
ok('buyer can see the seller has read', !!receipt, `counterpartyLastReadAt=${receipt}`);

const msgs = (await j('GET', `/threads/${thread.id}/messages`, { token: buyer })).data;
ok('message list carries the read position', msgs.counterpartyLastReadAt !== undefined, JSON.stringify(Object.keys(msgs)));

// --- 4. a new message after the read goes unread again ------------------------
await j('POST', `/threads/${thread.id}/messages`, { token: buyer, body: { kind: 'TEXT', body: `third ${RUN}` } });
const afterNew = (await j('GET', '/threads', { token: seller })).data;
ok('a later message is unread again', threadOf(afterNew, thread.id)?.unreadCount === 1, `unread=${threadOf(afterNew, thread.id)?.unreadCount}`);

// The seller's read position must not have moved just because a message arrived.
const stillBuyer = (await j('GET', '/threads', { token: buyer })).data;
ok('read receipt does not advance on its own', threadOf(stillBuyer, thread.id)?.counterpartyLastReadAt === receipt, `${threadOf(stillBuyer, thread.id)?.counterpartyLastReadAt} vs ${receipt}`);

// --- 5. isolation -------------------------------------------------------------
const other = (await j('POST', '/auth/register', { body: { email: `read2_${RUN}@example.com`, password: 'read2pass1234' } })).data.accessToken;
const otherInbox = (await j('GET', '/threads', { token: other })).data;
ok('a stranger does not see this thread at all', !threadOf(otherInbox, thread.id));
const peek = await j('GET', `/threads/${thread.id}/messages`, { token: other });
ok('a stranger cannot read the messages', peek.status === 403, `status=${peek.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
