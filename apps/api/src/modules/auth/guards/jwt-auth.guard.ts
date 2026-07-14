import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { TokenService } from '../services/token.service';
import { AppError } from '../../../common/errors/app-error';
import type { AuthUser } from '../types';

/**
 * Global guard. Validates the Bearer access token and attaches req.user.
 * Routes marked @Public() are skipped. Bearer tokens (not ambient cookies) make
 * the API CSRF-immune.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const isOptional = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = this.extractToken(req);
    if (!token) {
      if (isOptional) return true;
      throw new AppError('UNAUTHENTICATED', 'Missing access token');
    }

    try {
      const payload = await this.tokens.verifyAccess(token);
      if (payload.type !== 'access') throw new Error('wrong token type');
      req.user = {
        id: payload.sub,
        role: payload.role,
        emailVerified: payload.ev,
        phoneVerified: payload.pv,
      };
      return true;
    } catch {
      if (isOptional) return true; // proceed as guest on a bad token
      throw new AppError('UNAUTHENTICATED', 'Invalid or expired access token');
    }
  }

  private extractToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme === 'Bearer' && value ? value : null;
  }
}
