import { expect, test } from "@playwright/test";
import { API_URL } from "./support/env";

const api = API_URL;

// Regression for CA-LIVEOPS-01: when only the SSE transport is unavailable,
// the room must stay usable on its last authorised snapshot and reconnect with
// bounded backoff instead of unmounting and reconnecting in a tight loop.
test("live operations stays usable with bounded reconnects while SSE is unavailable", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("alex.morgan@opspilot.demo");
  await page.getByLabel("Password", { exact: true }).fill("DemoPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const sessions = (await (
    await page.request.get(`${api}/live-sessions`)
  ).json()) as { items: { status: string; event: { id: string } }[] };
  const live = sessions.items.find((item) => item.status === "ACTIVE");
  expect(live, "seeded active live session").toBeTruthy();

  let streamAttempts = 0;
  let snapshotReads = 0;
  await page.route("**/live-session/stream", (route) => {
    streamAttempts++;
    return route.abort();
  });
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      new URL(request.url()).pathname.endsWith("/live-session")
    )
      snapshotReads++;
  });

  await page.goto(`/streamops/events/${live!.event.id}/live`);
  const newPoll = page.getByRole("button", { name: "New poll" });
  await expect(newPoll).toBeVisible();
  await page.waitForTimeout(10_000);

  // Initial attempt plus 2s/4s backoff: at most four stream attempts in 10s.
  expect(streamAttempts).toBeGreaterThan(0);
  expect(streamAttempts).toBeLessThanOrEqual(4);
  expect(snapshotReads).toBeLessThanOrEqual(6);
  await expect(page.getByText("Rechecking access to live operations")).toHaveCount(0);
  await expect(page.getByText("Reconnecting", { exact: false })).toBeVisible();

  // Controls remain attached and usable on the last authorised snapshot.
  await newPoll.click();
  await expect(page.getByRole("dialog", { name: "Create live poll" })).toBeVisible();
});
