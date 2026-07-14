import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AppError } from '../../../common/errors/app-error';
import type { AuthUser } from '../types';

/**
 * RBAC. Runs after JwtAuthGuard; checks req.user.role against @Roles(...).
 * ABAC (ownership) checks live in services, close to the data.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    if (!user || !required.includes(user.role)) {
      throw AppError.forbidden('Insufficient role');
    }
    return true;
  }
}
