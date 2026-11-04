import { z } from "zod";
import type {
  TopicContext,
  TopicPage,
  TopicResult,
} from "@opspilot/topics-contracts";
const sequence = z.number().int().nonnegative();
const actor = z.object({
  id: z.string(),
  kind: z.enum(["staff", "attendee"]),
  name: z.string(),
});
export const settingsSchema = z.object({
  audiencePublishing: z.boolean(),
  audienceReplies: z.boolean(),
  moderationRequired: z.boolean(),
});
export const topicContextSchema = z.object({
  eventId: z.string().uuid(),
  actor,
  authority: z.string(),
  settings: settingsSchema,
  settingsRevision: sequence,
  capabilities: z.object({
    read: z.boolean(),
    viewPending: z.boolean(),
    create: z.boolean(),
    reply: z.boolean(),
    moderate: z.boolean(),
    configure: z.boolean(),
    publish: z.boolean(),
  }),
}) satisfies z.ZodType<TopicContext>;
const record = {
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  author: actor,
  clientOperationId: z.string().uuid(),
  text: z.string().nullable(),
  version: sequence,
  createdSequence: sequence,
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
};
const topic = z.object({
  ...record,
  status: z.enum(["PENDING", "APPROVED"]),
  pinSlot: z.number().int().min(1).max(7).nullable(),
  replies: z
    .array(z.object({ ...record, topicId: z.string().uuid() }))
    .max(100),
});
export const topicPageSchema = z.object({
  topics: z.array(topic).max(50),
  counts: z.object({
    all: sequence,
    approved: sequence,
    pending: sequence,
    pinned: sequence,
  }),
  nextBefore: sequence.nullable(),
  watermark: sequence,
  context: topicContextSchema,
}) satisfies z.ZodType<TopicPage>;
export const topicResultSchema = z.object({
  topic,
  context: topicContextSchema,
}) satisfies z.ZodType<TopicResult>;
export const topicTicketSchema = z.object({
  ticket: z.string(),
  expiresInSeconds: z.number(),
  context: topicContextSchema,
});
export const topicChangeSchema = z.object({
  eventId: z.string().uuid(),
  topicId: z.string().uuid().optional(),
  revision: sequence,
});
