import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hashes to an argon2id string, not the plaintext', async () => {
    const hash = await svc.hash('correcthorsebattery');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('correcthorsebattery');
  });

  it('verifies a correct password', async () => {
    const hash = await svc.hash('correcthorsebattery');
    await expect(svc.verify(hash, 'correcthorsebattery')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await svc.hash('correcthorsebattery');
    await expect(svc.verify(hash, 'wrongpassword')).resolves.toBe(false);
  });

  it('returns false (never throws) on a malformed hash', async () => {
    await expect(svc.verify('not-a-hash', 'x')).resolves.toBe(false);
  });

  it('produces distinct hashes for the same input (unique salts)', async () => {
    const a = await svc.hash('samepassword1');
    const b = await svc.hash('samepassword1');
    expect(a).not.toEqual(b);
  });
});
