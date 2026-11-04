import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import type { AuthenticatedUser } from '../common/request-context';

export const mediaWriters: WorkspaceRole[] = [
  'ADMIN',
  'OPERATIONS_MANAGER',
  'CONTENT_OPERATOR',
];
// Same verified staff-session / current-membership contract as EventIdentityService.
// Lock order is resource -> session -> membership; locks last through the operation.
export async function mediaAuthority(
  tx: Prisma.TransactionClient,
  user: AuthenticatedUser,
  write = false,
) {
  await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${user.sessionId} FOR SHARE`;
  const session = await tx.session.findUnique({
    where: { id: user.sessionId },
  });
  if (
    !session ||
    session.userId !== user.id ||
    session.revokedAt ||
    session.expiresAt <= new Date()
  )
    throw new UnauthorizedException('Staff session is no longer available.');
  await tx.$queryRaw`SELECT id FROM "WorkspaceMembership" WHERE "workspaceId"=${user.workspaceId} AND "userId"=${user.id} FOR SHARE`;
  const member = await tx.workspaceMembership.findUnique({
    where: {
      workspaceId_userId: { workspaceId: user.workspaceId, userId: user.id },
    },
  });
  if (!member || (write && !mediaWriters.includes(member.role)))
    throw new ForbiddenException(
      'Current workspace permission does not allow this operation.',
    );
  return member;
}
