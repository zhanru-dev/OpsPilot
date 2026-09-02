import { WorkspaceRole } from '@prisma/client';

export type AccessTokenPayload = {
  sub: string;
  sessionId: string;
  workspaceId: string;
  email: string;
  name: string;
  workspaceName: string;
  role: WorkspaceRole;
};

export type RefreshTokenPayload = {
  sub: string;
  sessionId: string;
  type: 'refresh';
};
