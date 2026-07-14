import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '../types';

/** Injects the authenticated principal (req.user) into a controller handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return req.user;
  },
);
