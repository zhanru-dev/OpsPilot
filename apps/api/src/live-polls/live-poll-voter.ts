import { createHash } from 'node:crypto';

export function livePollVoterKey(userId: string) {
  return createHash('sha256').update(`workspace-user:${userId}`).digest('hex');
}
