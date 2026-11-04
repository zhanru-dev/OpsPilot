/** Wire types only. Identity and permissions are always derived by the API. */
export type ChatActor = {
  id: string;
  kind: "staff" | "attendee";
  name: string;
};
export type ChatContext = {
  eventId: string;
  actor: ChatActor;
  capabilities: { read: boolean; send: boolean; moderate: boolean };
  authority: string;
};
export type Message = {
  id: string;
  eventId: string;
  author: ChatActor;
  clientMessageId: string;
  text: string | null;
  createdSequence: number;
  version: number;
  createdAt: string;
  deletedAt: string | null;
};
export type ChatEvent = {
  eventId: string;
  sequence: number;
  kind: "message.created" | "message.deleted";
  message: Message;
};
export type History = {
  messages: Message[];
  watermark: number;
  nextBefore: number | null;
  nextAfter: number | null;
  context: ChatContext;
};
export type Replay = {
  events: ChatEvent[];
  watermark: number;
  nextAfter: number;
  hasMore: boolean;
  context: ChatContext;
};
export type MessageResponse = { message: Message; context: ChatContext };
export type ChatAck<T> =
  | { ok: true; data: T }
  | { ok: false; error: { status: number; message: string } };
