-- Pin the legacy source version before external snapshot creation.
-- Nullable for existing single-PUT and multipart rows; no data is rewritten.
ALTER TABLE "MediaUpload" ADD COLUMN "snapshotSourceEtag" TEXT;
