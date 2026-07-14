import type { UserRole } from '@prisma/client';

/** Shape of the authenticated principal attached to req.user by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  role: UserRole;
  emailVerified: boolean;
  phoneVerified: boolean;
}

/** JWT access-token claims. */
export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  ev: boolean; // email verified
  pv: boolean; // phone verified
  type: 'access';
}

/**
 * JWT refresh-token claims. `sid` binds the token to a Session row for rotation;
 * `jti` is a random per-issue nonce so every rotation yields a byte-distinct token
 * (without it, two rotations in the same second are identical and reuse detection
 * cannot fire).
 */
export interface RefreshTokenPayload {
  sub: string;
  sid: string;
  jti: string;
  type: 'refresh';
}
