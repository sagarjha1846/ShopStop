import { authenticator } from 'otplib';
const B = 'http://localhost:4000/api/v1';
const RUN = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
async function j(method, path, { token, body } = {}) {
  const res = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await res.json(); } catch {}
  return { status: res.status, data: d };
}

const email = `mfa_${RUN}@example.com`, password = 'mfapassword1234';
const reg = await j('POST', '/auth/register', { body: { email, password } });
const token = reg.data.accessToken;

// Enroll → get secret + otpauth URL
const enroll = await j('POST', '/auth/mfa/enroll', { token });
ok('enroll returns secret + otpauth url', !!enroll.data.secret && enroll.data.otpauthUrl?.startsWith('otpauth://'), enroll.data.otpauthUrl);
const secret = enroll.data.secret;

// Enable with a wrong code → rejected
const badEnable = await j('POST', '/auth/mfa/enable', { token, body: { code: '000000' } });
ok('enable rejects wrong code', badEnable.status === 422, `status=${badEnable.status}`);

// Enable with a real TOTP code
const code = authenticator.generate(secret);
const enable = await j('POST', '/auth/mfa/enable', { token, body: { code } });
ok('enable with valid code', enable.status === 200 && enable.data.mfaEnabled === true, `status=${enable.status}`);

// Login now requires MFA
const loginNoMfa = await j('POST', '/auth/login', { body: { email, password } });
ok('login without MFA code rejected', loginNoMfa.status === 401, `status=${loginNoMfa.status}`);

// Login with MFA code succeeds
const loginMfa = await j('POST', '/auth/login', { body: { email, password, mfaCode: authenticator.generate(secret) } });
ok('login with MFA code succeeds', loginMfa.status === 200 && !!loginMfa.data.accessToken, `status=${loginMfa.status}`);

// Disable MFA (with a code) → login no longer needs it
const disable = await j('POST', '/auth/mfa/disable', { token: loginMfa.data.accessToken, body: { code: authenticator.generate(secret) } });
ok('disable MFA', disable.status === 200 && disable.data.mfaEnabled === false, `status=${disable.status}`);
const loginAfter = await j('POST', '/auth/login', { body: { email, password } });
ok('login without MFA works after disable', loginAfter.status === 200, `status=${loginAfter.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
