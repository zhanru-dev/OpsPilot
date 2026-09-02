export type MediaProcessingJobData = {
  processingJobId: string;
  mediaId: string;
  workspaceId: string;
  traceId: string;
};

export type ProbedMedia = {
  format?: {
    duration?: string;
    format_name?: string;
  };
  streams?: Array<{
    codec_name?: string;
    codec_type?: string;
    duration?: string;
    width?: number;
    height?: number;
  }>;
};
