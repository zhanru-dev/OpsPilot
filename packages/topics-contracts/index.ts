/** Types only: all identities, capabilities and visibility are server-derived. */
export type TopicActor = {
  id: string;
  kind: "staff" | "attendee";
  name: string;
};
export type TopicSettings = {
  audiencePublishing: boolean;
  audienceReplies: boolean;
  moderationRequired: boolean;
};
export type TopicContext = {
  eventId: string;
  actor: TopicActor;
  authority: string;
  capabilities: {
    read: boolean;
    viewPending: boolean;
    create: boolean;
    reply: boolean;
    moderate: boolean;
    configure: boolean;
    publish: boolean;
  };
  settings: TopicSettings;
  settingsRevision: number;
};
export type TopicReply = {
  id: string;
  eventId: string;
  topicId: string;
  author: TopicActor;
  clientOperationId: string;
  text: string | null;
  version: number;
  createdSequence: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
export type Topic = {
  id: string;
  eventId: string;
  author: TopicActor;
  clientOperationId: string;
  text: string | null;
  status: "PENDING" | "APPROVED";
  pinSlot: number | null;
  version: number;
  createdSequence: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  replies: TopicReply[];
};
export type TopicFilter = "all" | "approved" | "pending" | "pinned";
export type TopicPage = {
  topics: Topic[];
  counts: Record<TopicFilter, number>;
  nextBefore: number | null;
  watermark: number;
  context: TopicContext;
};
export type TopicResult = { topic: Topic; context: TopicContext };
export type TopicChange = {
  eventId: string;
  topicId?: string;
  revision: number;
};
