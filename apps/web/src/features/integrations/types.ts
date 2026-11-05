import type { WebhookDelivery, WebhookEndpoint } from "@/lib/types";

export type DeliveryResponse = {
  items: WebhookDelivery[];
  pagination: { page: number; pageSize: number; total: number };
  statusCounts: Record<string, number>;
};

// The signing secret is returned exactly once, when the endpoint is created.
export type CreatedEndpoint = {
  endpoint: WebhookEndpoint;
  signingSecret: string;
};
