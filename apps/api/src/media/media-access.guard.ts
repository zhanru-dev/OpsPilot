import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { mediaAuthority } from './media-authority';
@Injectable()
export class MediaAccessGuard implements CanActivate {
  constructor(private readonly db: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user: AuthenticatedUser }>();
    const member = await this.db.$transaction((tx) =>
      mediaAuthority(
        tx,
        req.user,
        !['GET', 'HEAD'].includes(req.method) &&
          !/\/(playback-url|thumbnail-url)$/.test(req.path),
      ),
    );
    req.user.role = member.role;
    return true;
  }
}
