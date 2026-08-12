// Black-box E2E for public listing Q&A — the liquidity feature from docs/03 §5.
// Run: node apps/api/test/e2e/questions.e2e.mjs   (API on :4000)
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

const seller = await login('admin@shopstop.local', 'AdminPass123!');
const buyer = (await j('POST', '/auth/register', { body: { email: `qa_${RUN}@example.com`, password: 'qapass1234567' } })).data.accessToken;
const other = (await j('POST', '/auth/register', { body: { email: `qb_${RUN}@example.com`, password: 'qbpass1234567' } })).data.accessToken;

const cats = (await j('GET', '/categories')).data;
const catId = cats.find((c) => c.slug === 'electronics').children.find((c) => c.slug === 'mobile-phones').id;
const listing = (await j('POST', '/listings', { token: seller, body: { categoryId: catId, title: `QA Phone ${RUN}`, description: 'listing question and answer test', priceMinor: 450000, quantity: 3, attributes: { brand: 'B', model: 'M', storage: '128GB' }, publish: true } })).data;
if (listing.status === 'PENDING_REVIEW') {
  await j('POST', `/admin/moderation/LISTING/${listing.id}/action`, { token: seller, body: { decision: 'APPROVE' } });
}

// --- 1. asking ----------------------------------------------------------------
const asked = await j('POST', `/listings/${listing.id}/questions`, { token: buyer, body: { body: 'Is the battery health above 90 percent?' } });
ok('a buyer can ask', asked.status === 201, `status=${asked.status}`);
const anon = await j('POST', `/listings/${listing.id}/questions`, { body: { body: 'Anonymous question here' } });
ok('asking requires auth', anon.status === 401, `status=${anon.status}`);
const ownListing = await j('POST', `/listings/${listing.id}/questions`, { token: seller, body: { body: 'Talking to myself about this' } });
ok('the seller cannot ask on their own listing', ownListing.status === 422, `status=${ownListing.status}`);
const tooShort = await j('POST', `/listings/${listing.id}/questions`, { token: buyer, body: { body: 'hm' } });
ok('too-short questions rejected', tooShort.status === 422, `status=${tooShort.status}`);
const blocked = await j('POST', `/listings/${listing.id}/questions`, { token: buyer, body: { body: 'Do you also sell a gun with this phone?' } });
ok('prohibited keywords screened, same as listings', blocked.status === 422, `status=${blocked.status}`);

// --- 2. public reading --------------------------------------------------------
const publicList = await j('GET', `/listings/${listing.id}/questions`);
ok('questions are public', publicList.status === 200 && publicList.data.length === 1, `status=${publicList.status} n=${publicList.data?.length}`);
const q = publicList.data[0];
ok('shows the question text', q.body.includes('battery health'));
ok('unanswered questions have no answer', q.answerBody === null && q.answeredAt === null);
ok('exposes a handle, never an email', !!q.askedBy && !JSON.stringify(q).includes('@example.com'), JSON.stringify(q));

// --- 3. answering -------------------------------------------------------------
const byStranger = await j('POST', `/questions/${asked.data.id}/answer`, { token: other, body: { body: 'I think it is fine' } });
ok('only the seller can answer', byStranger.status === 403, `status=${byStranger.status}`);
const answered = await j('POST', `/questions/${asked.data.id}/answer`, { token: seller, body: { body: 'Yes — 94% as of this week.' } });
ok('the seller can answer', answered.status === 201, `status=${answered.status}`);
const twice = await j('POST', `/questions/${asked.data.id}/answer`, { token: seller, body: { body: 'Answering again' } });
ok('a question cannot be answered twice', twice.status === 409, `status=${twice.status}`);

const afterAnswer = (await j('GET', `/listings/${listing.id}/questions`)).data[0];
ok('the answer is public', afterAnswer.answerBody.includes('94%') && !!afterAnswer.answeredAt);

// --- 4. the asker is notified -------------------------------------------------
const notifs = (await j('GET', '/notifications', { token: buyer })).data;
ok('asker notified when answered', notifs.some((n) => n.type === 'question.answered'), `types=${notifs.map((n) => n.type).slice(0, 3)}`);

// --- 5. it counts as listing engagement in the funnel -------------------------
// A question is a buyer contacting a listing; the liquidity metric must see it,
// otherwise Q&A would invisibly depress the number it exists to improve.
const fresh = (await j('POST', '/listings', { token: seller, body: { categoryId: catId, title: `QA Fresh ${RUN}`, description: 'funnel counts questions test', priceMinor: 300000, attributes: { brand: 'B', model: 'M', storage: '128GB' }, publish: true } })).data;
if (fresh.status === 'PENDING_REVIEW') {
  await j('POST', `/admin/moderation/LISTING/${fresh.id}/action`, { token: seller, body: { decision: 'APPROVE' } });
}
const before = (await j('GET', '/admin/funnel?days=30', { token: seller })).data.metrics.find((m) => m.key === 'liquidity');
await j('POST', `/listings/${fresh.id}/questions`, { token: buyer, body: { body: 'Does this ship to Bengaluru?' } });
const after = (await j('GET', '/admin/funnel?days=30', { token: seller })).data.metrics.find((m) => m.key === 'liquidity');
ok('a question counts toward liquidity', after.numerator === before.numerator + 1, `${before.numerator} -> ${after.numerator}`);

// --- 6. moderation ------------------------------------------------------------
const hidden = await j('POST', `/admin/questions/${asked.data.id}/hide`, { token: seller });
ok('a moderator can hide a question', hidden.status === 201 || hidden.status === 200, `status=${hidden.status}`);
const afterHide = (await j('GET', `/listings/${listing.id}/questions`)).data;
ok('hidden questions disappear from the public list', !afterHide.some((x) => x.id === asked.data.id));
const byUser = await j('POST', `/admin/questions/${asked.data.id}/hide`, { token: buyer });
ok('ordinary users cannot hide questions', byUser.status === 403, `status=${byUser.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
