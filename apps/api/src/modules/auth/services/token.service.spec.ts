import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';
import type { AppConfigService } from '../../../config/config.service';

const config = {
  get: (key: string) => {
    const map: Record<string, unknown> = {
      JWT_ACCESS_SECRET: 'test-access-secret-000000000000',
      JWT_REFRESH_SECRET: 'test-refresh-secret-00000000000',
      JWT_ACCESS_TTL: 900,
      JWT_REFRESH_TTL: 2_592_000,
    };
    return map[key];
  },
} as unknown as AppConfigService;

describe('TokenService', () => {
  const svc = new TokenService(new JwtService(), config);
  const user = { id: 'u1', role: 'USER' as const, emailVerified: false, phoneVerified: false };

  it('signs a verifiable access token carrying role + verification claims', async () => {
    const token = await svc.signAccess(user);
    const payload = await svc.verifyAccess(token);
    expect(payload.sub).toBe('u1');
    expect(payload.role).toBe('USER');
    expect(payload.type).toBe('access');
  });

  it('rejects an access token verified with the refresh secret', async () => {
    const token = await svc.signAccess(user);
    await expect(svc.verifyRefresh(token)).rejects.toBeDefined();
  });

  // Regression: two rotations in the same second must NOT be byte-identical,
  // otherwise refresh-token reuse detection can never fire.
  it('produces a distinct refresh token on every issue (jti nonce)', async () => {
    const a = await svc.signRefresh('u1', 'sid1');
    const b = await svc.signRefresh('u1', 'sid1');
    expect(a).not.toEqual(b);
    expect(svc.hashToken(a)).not.toEqual(svc.hashToken(b));
  });

  it('hashToken is deterministic and does not echo the token', () => {
    const t = 'some.jwt.token';
    expect(svc.hashToken(t)).toEqual(svc.hashToken(t));
    expect(svc.hashToken(t)).not.toContain(t);
    expect(svc.hashToken(t)).toHaveLength(64); // sha256 hex
  });
});
