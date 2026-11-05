// A short-lived signed URL for private media (see StorageService.presignGet).
export type Playback = {
  url: string;
  expiresAt: string | null;
  source: "SEEDED" | "PRIVATE_STORAGE";
};
