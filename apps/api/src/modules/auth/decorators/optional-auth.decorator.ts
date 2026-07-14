import { SetMetadata } from '@nestjs/common';

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * Marks a route as public but auth-aware: if a valid Bearer token is present,
 * req.user is populated; if absent/invalid, the request still proceeds as a guest.
 * Used for browse/detail endpoints that personalize for signed-in users.
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
