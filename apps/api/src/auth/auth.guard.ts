import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { AuthenticatedUser } from '../common/request-context';
import { AccessTokenPayload } from './auth.types';
import { StaffAuthorityService } from './staff-authority.service';

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly authority: StaffAuthorityService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.opspilot_access as string | undefined;
    if (!token) throw new UnauthorizedException('Authentication is required.');

    let payload: AccessTokenPayload & { exp: number };
    try {
      payload = await this.jwt.verifyAsync<
        AccessTokenPayload & { exp: number }
      >(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      if (
        !payload.sub ||
        !payload.sessionId ||
        !payload.workspaceId ||
        !Number.isFinite(payload.exp)
      )
        throw new Error('Invalid access identity');
    } catch {
      throw new UnauthorizedException('Session has expired.');
    }
    // Do not turn database outages into an invalid-credentials response or fall
    // back to JWT role claims. RolesGuard receives only current server authority.
    request.user = await this.authority.current({
      id: payload.sub,
      sessionId: payload.sessionId,
      workspaceId: payload.workspaceId,
      accessExpiresAt: payload.exp * 1000,
    });
    return true;
  }
}
