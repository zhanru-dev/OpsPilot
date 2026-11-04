import { z } from "zod";
import type {
  ChatContext,
  ChatEvent,
  History,
  MessageResponse,
  Replay,
} from "@opspilot/chat-contracts";

const actor = z.object({
  id: z.string(),
  kind: z.enum(["staff", "attendee"]),
  name: z.string(),
});
export const contextSchema = z.object({
  eventId: z.string().uuid(),
  actor,
  authority: z.string(),
  capabilities: z.object({
    read: z.boolean(),
    send: z.boolean(),
    moderate: z.boolean(),
  }),
}) satisfies z.ZodType<ChatContext>;
const sequence = z.number().int().nonnegative();
const message = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  author: actor,
  clientMessageId: z.string().uuid(),
  text: z.string().nullable(),
  createdSequence: sequence,
  version: sequence,
  createdAt: z.string(),
  deletedAt: z.string().nullable(),
});
export const eventSchema = z.object({
  eventId: z.string().uuid(),
  sequence,
  kind: z.enum(["message.created", "message.deleted"]),
  message,
}) satisfies z.ZodType<ChatEvent>;
export const historySchema = z.object({
  messages: z.array(message),
  watermark: sequence,
  nextBefore: sequence.nullable(),
  nextAfter: sequence.nullable(),
  context: contextSchema,
}) satisfies z.ZodType<History>;
export const replaySchema = z.object({
  events: z.array(eventSchema),
  watermark: sequence,
  nextAfter: sequence,
  hasMore: z.boolean(),
  context: contextSchema,
}) satisfies z.ZodType<Replay>;
export const responseSchema = z.object({
  message,
  context: contextSchema,
}) satisfies z.ZodType<MessageResponse>;
export const ticketSchema = z.object({
  ticket: z.string(),
  expiresInSeconds: z.number(),
  context: contextSchema,
});
