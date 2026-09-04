import { AccessMode, EventStatus, Prisma } from '@prisma/client';
import { isFQDN } from 'class-validator';
import { domainToASCII } from 'node:url';

export const attendeeStates: EventStatus[] = [
  EventStatus.READY,
  EventStatus.LIVE,
];
export function canonicalDomain(value: string) {
  const domain = value.trim().toLowerCase();
  return domain.includes('/') || /[\\?#@:%\s]/.test(domain)
    ? ''
    : domainToASCII(domain);
}

export function matchesEmailDomain(email: string, allowedDomains: string[]) {
  const domain = canonicalDomain(email.slice(email.lastIndexOf('@') + 1));
  return (
    email.includes('@') &&
    isFQDN(domain) &&
    allowedDomains.some((allowed) => canonicalDomain(allowed) === domain)
  );
}

type EligibleEvent = {
  id: string;
  status: EventStatus;
  accessPolicy: { mode: AccessMode; allowedDomains: string[] } | null;
};

export async function isAttendeeEligible(
  database: Pick<Prisma.TransactionClient, 'eventInvitation'>,
  event: EligibleEvent,
  email: string,
) {
  if (!attendeeStates.includes(event.status) || !event.accessPolicy)
    return false;
  switch (event.accessPolicy.mode) {
    case AccessMode.PUBLIC:
    case AccessMode.REGISTRATION:
      return true;
    case AccessMode.EMAIL_DOMAIN:
      return matchesEmailDomain(email, event.accessPolicy.allowedDomains);
    case AccessMode.INVITE_ONLY: {
      const invitation = await database.eventInvitation.findUnique({
        where: {
          eventId_email: {
            eventId: event.id,
            email: email.trim().toLowerCase(),
          },
        },
        select: { revokedAt: true },
      });
      return invitation !== null && invitation.revokedAt === null;
    }
    default:
      return false;
  }
}

export const attendeeEventSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  scheduledStart: true,
  scheduledEnd: true,
  timezone: true,
  workspace: { select: { name: true } },
  accessPolicy: {
    select: {
      mode: true,
      allowedDomains: true,
      requiresConsent: true,
      collectCompany: true,
      collectJobTitle: true,
    },
  },
} satisfies Prisma.StreamEventSelect;

type AttendeeEvent = Prisma.StreamEventGetPayload<{
  select: typeof attendeeEventSelect;
}>;

export function attendeeEventView(event: AttendeeEvent, verified = false) {
  const { accessPolicy, workspace, ...detail } = event;
  if (!accessPolicy) return null;
  const policy = {
    mode: accessPolicy.mode,
    requiresConsent: accessPolicy.requiresConsent,
    collectCompany: accessPolicy.collectCompany,
    collectJobTitle: accessPolicy.collectJobTitle,
  };
  const registrationOpen = attendeeStates.includes(event.status);
  if (
    !verified &&
    (policy.mode === AccessMode.EMAIL_DOMAIN ||
      policy.mode === AccessMode.INVITE_ONLY)
  ) {
    return {
      id: event.id,
      restricted: true as const,
      registrationOpen,
      policy,
    };
  }
  return {
    ...detail,
    restricted: false as const,
    organiser: workspace.name,
    registrationOpen,
    policy,
  };
}
