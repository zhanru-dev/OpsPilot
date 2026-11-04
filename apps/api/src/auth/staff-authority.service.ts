import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/request-context';

type Identity = Pick<
  AuthenticatedUser,
  'id' | 'sessionId' | 'workspaceId' | 'accessExpiresAt'
>;

@Injectable()
export class StaffAuthorityService {
  constructor(private readonly prisma: PrismaService) {}

  assertUnexpired(identity: Identity) {
    if (
      identity.accessExpiresAt !== undefined &&
      identity.accessExpiresAt <= Date.now()
    )
      throw new UnauthorizedException('Session has expired.');
  }

  // JWT supplies only the verified identity/scope. Current role and profile come
  // from PostgreSQL. Streaming callers hold these rows through snapshot emission.
  async current(
    identity: Identity,
    tx: Prisma.TransactionClient = this.prisma,
    lock = false,
  ): Promise<AuthenticatedUser> {
    this.assertUnexpired(identity);
    if (lock)
      await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${identity.sessionId} FOR SHARE`;
    const session = await tx.session.findUnique({
      where: { id: identity.sessionId },
      include: { user: true },
    });
    if (
      !session ||
      session.userId !== identity.id ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    )
      throw new UnauthorizedException('Staff session is no longer active.');
    if (lock)
      await tx.$queryRaw`SELECT id FROM "WorkspaceMembership" WHERE "workspaceId"=${identity.workspaceId} AND "userId"=${identity.id} FOR SHARE`;
    const membership = await tx.workspaceMembership.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: identity.workspaceId,
          userId: identity.id,
        },
      },
      include: { workspace: true },
    });
    if (!membership)
      throw new ForbiddenException('Workspace membership is unavailable.');
    const current = {
      id: session.userId,
      sessionId: session.id,
      email: session.user.email,
      name: session.user.name,
      workspaceId: membership.workspaceId,
      workspaceName: membership.workspace.name,
      role: membership.role,
      accessExpiresAt: Math.min(
        identity.accessExpiresAt ?? Infinity,
        session.expiresAt.getTime(),
      ),
    };
    this.assertUnexpired(current);
    return current;
  }
}
