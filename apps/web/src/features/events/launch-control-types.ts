import type {
  AuditLog,
  MediaAsset,
  Recommendation,
  StreamEvent,
} from "@/lib/types";

export type ContentBlock = {
  id: string;
  type: string;
  title: string;
  body: string;
  isVisible: boolean;
};

export type EventDetail = StreamEvent & {
  accessPolicy: {
    id: string;
    mode: string;
    allowedDomains: string[];
    requiresConsent: boolean;
    collectCompany: boolean;
    collectJobTitle: boolean;
  } | null;
  runbookItems: Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    isCritical: boolean;
    dueAt: string | null;
    owner: { name: string; avatarInitials: string } | null;
  }>;
  contentBlocks: ContentBlock[];
  mediaAssets: Array<{ media: MediaAsset; purpose: string }>;
  recommendations: Recommendation[];
  auditLogs: AuditLog[];
};

export type WorkspaceMember = {
  id: string;
  role: string;
  user: { id: string; name: string; email: string };
};
