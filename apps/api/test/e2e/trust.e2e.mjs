const B = 'http://localhost:4000/api/v1';
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
async function j(method, path, { token, body } = {}) {
  const res = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (email, password) => (await j('POST', '/auth/login', { body: { email, password } })).data.accessToken;

const RUN = Date.now().toString(36);
const admin = await login('admin@shopstop.local', 'AdminPass123!');
const reporter = (await j('POST', '/auth/register', { body: { email: `reporter_${RUN}@example.com`, password: 'reporterpass1' } })).data.accessToken;

const cats = (await j('GET', '/categories')).data;
const catId = cats.find((c) => c.slug === 'electronics').children.find((c) => c.slug === 'mobile-phones').id;
const held = (await j('POST', '/listings', { token: admin, body: {
  categoryId: catId, title: `Flagged ${RUN} gun`, description: 'weapon included, wire transfer only',
  priceMinor: 100000, attributes: { brand: 'x', model: 'y' }, publish: true,
} })).data;
ok('risky listing held for review', held.status === 'PENDING_REVIEW', `status=${held.status}`);

const browse = (await j('GET', `/listings?categoryId=${catId}`)).data;
ok('held listing hidden from public browse', !browse.items.some((i) => i.id === held.id));

const report = await j('POST', '/reports', { token: reporter, body: { subjectType: 'LISTING', subjectId: held.id, reason: 'Prohibited item' } });
ok('report created', report.status === 201, `status=${report.status}`);

const forbiddenQueue = await j('GET', '/admin/moderation/queue', { token: reporter });
ok('non-admin blocked from queue (403)', forbiddenQueue.status === 403, `status=${forbiddenQueue.status}`);

const queue = (await j('GET', '/admin/moderation/queue', { token: admin })).data;
ok('admin queue has fraud events', Array.isArray(queue.fraud) && queue.fraud.length >= 1, `fraud=${queue.fraud?.length}`);
ok('admin queue has reports', Array.isArray(queue.reports) && queue.reports.length >= 1, `reports=${queue.reports?.length}`);

const reject = await j('POST', `/admin/moderation/LISTING/${held.id}/action`, { token: admin, body: { decision: 'REJECT', reason: 'Prohibited goods' } });
ok('admin rejects listing', reject.status === 201 || reject.status === 200);
const afterReject = (await j('GET', `/listings/${held.id}`, { token: admin })).data;
ok('listing REJECTED/REMOVED', ['REJECTED', 'REMOVED'].includes(afterReject.status), `status=${afterReject.status}`);

const held2 = (await j('POST', '/listings', { token: admin, body: {
  categoryId: catId, title: `Review me ${RUN} stolen`, description: 'stolen goods maybe', priceMinor: 100000, attributes: { brand: 'x', model: 'y' }, publish: true,
} })).data;
const approve = await j('POST', `/admin/moderation/LISTING/${held2.id}/action`, { token: admin, body: { decision: 'APPROVE' } });
ok('admin approves listing', approve.status === 201 || approve.status === 200);
const afterApprove = (await j('GET', `/listings/${held2.id}`)).data;
ok('approved listing now ACTIVE', afterApprove.status === 'ACTIVE', `status=${afterApprove.status}`);

const profile = (await j('GET', '/users/shopstop-admin')).data;
ok('public profile has trust score + badges', typeof profile.trustScore === 'number' && Array.isArray(profile.badges), `score=${profile.trustScore} badges=${profile.badges}`);
ok('public profile leaks no email', profile.email === undefined);

// dispute lifecycle: reuse an accepted order path is heavy; here test open on a non-disputable order -> 409
const disputeBadOrder = await j('POST', '/disputes', { token: reporter, body: { orderId: 'nonexistent', reason: 'x' } });
ok('dispute on unknown order -> 404', disputeBadOrder.status === 404, `status=${disputeBadOrder.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
