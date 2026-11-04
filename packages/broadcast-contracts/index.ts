/** Types only. Principals, permissions and availability are server-derived. */
export type BroadcastContext = {
  eventId: string;
  actor: { id: string; kind: "staff" | "attendee"; name: string };
  authority: string;
  capabilities: {
    read: boolean;
    view: boolean;
    manage: boolean;
    publish: boolean;
    start: boolean;
  };
};
export type BroadcastSession = {
  id: string;
  eventId: string;
  state: "ACTIVE" | "ENDED";
  availability: "WAITING" | "LIVE" | "INTERRUPTED" | "UNKNOWN";
  revision: number;
  createdAt: string;
  firstLiveAt: string | null;
  endedAt: string | null;
  checkedAt: string | null;
  cleanupPending: boolean;
};
export type BroadcastSnapshot = {
  enabled: boolean;
  eventId: string;
  revision: number;
  context: BroadcastContext;
  session: BroadcastSession | null;
};
export type PlaybackGrant = {
  sessionId: string;
  ticket: string;
  expiresAt: string;
  authority: string;
};
export type PublishGrant = {
  sessionId: string;
  server: string;
  streamKey: string;
  expiresAt: string;
};
