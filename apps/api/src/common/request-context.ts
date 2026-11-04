import { WorkspaceRole } from '@prisma/client';

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
  sessionId: string;
  /** Verified access/Session expiry, retained for long-lived SSE authorization. */
  accessExpiresAt?: number;
};
