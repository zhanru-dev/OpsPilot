// Addresses for browser suites. The test wrappers (scripts/test-env.mjs) export these,
// so a second isolated stack can run beside a developer environment.
const trim = (value: string) => value.replace(/\/+$/, "");

export const WEB_URL = trim(
  process.env.E2E_WEB_URL ??
    `http://localhost:${process.env.OPSPILOT_TEST_WEB_PORT ?? "3000"}`,
);
export const API_URL = trim(
  process.env.NEXT_PUBLIC_API_URL ??
    `http://localhost:${process.env.OPSPILOT_TEST_API_PORT ?? "4100"}/api/v1`,
);
export const API_ORIGIN = new URL(API_URL).origin;
export const MAILPIT_URL = trim(
  process.env.MAILPIT_URL ??
    `http://localhost:${process.env.OPSPILOT_TEST_MAILPIT_PORT ?? "8025"}`,
);
export const MINIO_PORT = process.env.OPSPILOT_TEST_MINIO_PORT ?? "9002";
export const MEDIAMTX_CONTAINER =
  process.env.OPSPILOT_TEST_MEDIAMTX_CONTAINER ??
  "opspilot-broadcast-test-mediamtx-1";

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
// Matches an attendee link for this web origin inside an email body.
export const eventLinkPattern = new RegExp(`${escape(WEB_URL)}/events/[^\\s]+`);
