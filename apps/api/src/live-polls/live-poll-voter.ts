import { createHash } from 'node:crypto';

function voterKey(scope: string, id: string) {
  return createHash('sha256').update(`${scope}:${id}`).digest('hex');
}

export function livePollVoterKey(userId: string) {
  return voterKey('workspace-user', userId);
}

export function attendeeLivePollVoterKey(registrationId: string) {
  return voterKey('attendee-registration', registrationId);
}
