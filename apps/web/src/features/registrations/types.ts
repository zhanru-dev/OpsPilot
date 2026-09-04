export type PublicEvent = {
  id: string;
  title: string;
  description: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string;
  timezone: string;
  organiser: string;
  registrationOpen: boolean;
  policy: {
    mode: "PUBLIC" | "REGISTRATION";
    requiresConsent: boolean;
    collectCompany: boolean;
    collectJobTitle: boolean;
  };
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
