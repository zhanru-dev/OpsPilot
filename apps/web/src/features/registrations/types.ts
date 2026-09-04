export type RegistrationPolicy = {
  mode: "PUBLIC" | "REGISTRATION" | "EMAIL_DOMAIN" | "INVITE_ONLY";
  requiresConsent: boolean;
  collectCompany: boolean;
  collectJobTitle: boolean;
};

export type PublicEvent = {
  restricted: false;
  id: string;
  title: string;
  description: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string;
  timezone: string;
  organiser: string;
  registrationOpen: boolean;
  policy: RegistrationPolicy;
};

export type RegistrationEvent =
  | PublicEvent
  | {
      id: string;
      restricted: true;
      registrationOpen: boolean;
      policy: RegistrationPolicy;
    };

export type EventInvitation = {
  id: string;
  email: string;
  revokedAt: string | null;
  mailRequestedAt: string;
  mailSentAt: string | null;
  mailAttemptCount: number;
  createdAt: string;
};
export type InvitationList = {
  event: { id: string; title: string };
  canManage: boolean;
  items: EventInvitation[];
  total: number;
  page: number;
  pageSize: number;
};

export type AttendeeLivePoll = {
  id: string;
  question: string;
  status: "OPEN" | "CLOSED";
  openedAt: string | null;
  closedAt: string | null;
  currentUserOptionId: string | null;
  responseCount: number;
  options: Array<{
    id: string;
    label: string;
    sortOrder: number;
    responseCount: number;
  }>;
};

export type AttendeeLivePollList = {
  serverTime: string;
  polls: AttendeeLivePoll[];
};

export type RegistrationList = {
  event: { id: string; title: string };
  items: Array<{
    id: string;
    name: string;
    email: string;
    company: string | null;
    jobTitle: string | null;
    emailVerifiedAt: string | null;
    consentedAt: string | null;
    createdAt: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
};
