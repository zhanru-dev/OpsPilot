/** Wire types only. Server validation and current authority remain authoritative. */
export type UploadManifest = {
  clientOperationId: string;
  name: string;
  kind: "VIDEO" | "AUDIO";
  contentType: string;
  sizeBytes: number;
  hashes: string[];
  description?: string;
};
export type UploadReceipt = {
  id: string;
  assetId: string;
  clientOperationId: string;
  name: string;
  contentType: string;
  kind: "VIDEO" | "AUDIO";
  sizeBytes: number;
  hashes: string[];
  status:
    "PENDING" | "FINALIZING" | "UPLOADED" | "CANCELLED" | "EXPIRED" | "FAILED";
  assetStatus: string;
  parts: { number: number; sizeBytes: number; sha256: string }[];
  expiresAt: string;
  failureReason: string | null;
};
export type PartGrant = {
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
};
