import { z } from "zod";
export const contextSchema = z.object({
  eventId: z.uuid(),
  actor: z.object({
    id: z.string(),
    kind: z.enum(["staff", "attendee"]),
    name: z.string(),
  }),
  authority: z.string(),
  capabilities: z.object({
    read: z.boolean(),
    view: z.boolean(),
    manage: z.boolean(),
    publish: z.boolean(),
    start: z.boolean(),
  }),
});
export const snapshotSchema = z.object({
  enabled: z.boolean(),
  eventId: z.uuid(),
  revision: z.number().int().nonnegative(),
  context: contextSchema,
  session: z
    .object({
      id: z.uuid(),
      eventId: z.uuid(),
      state: z.enum(["ACTIVE", "ENDED"]),
      availability: z.enum(["WAITING", "LIVE", "INTERRUPTED", "UNKNOWN"]),
      revision: z.number().int().positive(),
      createdAt: z.iso.datetime(),
      firstLiveAt: z.iso.datetime().nullable(),
      endedAt: z.iso.datetime().nullable(),
      checkedAt: z.iso.datetime().nullable(),
      cleanupPending: z.boolean(),
    })
    .nullable(),
});
export const playbackSchema = z.object({
  sessionId: z.uuid(),
  ticket: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime(),
  authority: z.string(),
});
export const publishSchema = z.object({
  sessionId: z.uuid(),
  server: z.url(),
  streamKey: z.string(),
  expiresAt: z.iso.datetime(),
});
