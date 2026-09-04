import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const eventId = "33333333-3333-4333-8333-333333333335";
const pollId = "44444444-4444-4444-8444-444444444441";
const optionOne = "55555555-5555-4555-8555-555555555551";
const optionTwo = "55555555-5555-4555-8555-555555555552";

test("a verified attendee retries, updates and observes a closed live poll", async ({
  page,
}, testInfo) => {
  const state = {
    failNextVote: true,
    poll: {
      id: pollId,
      question: "Which topic should we explore next?",
      status: "OPEN" as "OPEN" | "CLOSED",
      openedAt: "2026-09-04T18:00:00.000Z",
      closedAt: null as string | null,
      currentUserOptionId: null as string | null,
      responseCount: 0,
      options: [
        {
          id: optionOne,
          label: "Operational resilience",
          sortOrder: 0,
          responseCount: 0,
        },
        {
          id: optionTwo,
          label: "Audience analytics",
          sortOrder: 1,
          responseCount: 0,
        },
      ],
    },
  };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith(`/public/events/${eventId}`)) {
      await route.fulfill({
        json: {
          id: eventId,
          restricted: false,
          title: "Product Operations Forum",
          description: "A practical event.",
          status: "LIVE",
          scheduledStart: "2026-09-04T18:00:00.000Z",
          scheduledEnd: "2026-09-04T20:00:00.000Z",
          timezone: "Europe/London",
          organiser: "Brightline Events",
          registrationOpen: true,
          policy: {
            mode: "REGISTRATION",
            requiresConsent: false,
            collectCompany: false,
            collectJobTitle: false,
          },
        },
      });
    } else if (pathname.endsWith("/attendee/session")) {
      await route.fulfill({
        json: {
          eventId,
          email: "guest@example.test",
          expiresAt: "2026-09-05T00:00:00.000Z",
          event: {
            id: eventId,
            restricted: false,
            title: "Product Operations Forum",
            organiser: "Brightline Events",
          },
        },
      });
    } else if (
      request.method() === "GET" &&
      pathname.endsWith("/attendee/live-polls")
    ) {
      await route.fulfill({
        json: { serverTime: new Date().toISOString(), polls: [state.poll] },
      });
    } else if (
      request.method() === "POST" &&
      pathname.endsWith(`/live-polls/${pollId}/responses`)
    ) {
      if (state.failNextVote) {
        state.failNextVote = false;
        await route.fulfill({
          status: 503,
          json: { message: "The response could not be saved. Try again." },
        });
      } else {
        const body = request.postDataJSON() as { optionId: string };
        state.poll.currentUserOptionId = body.optionId;
        state.poll.responseCount = 1;
        for (const option of state.poll.options)
          option.responseCount = option.id === body.optionId ? 1 : 0;
        await route.fulfill({ json: state.poll });
      }
    } else {
      await route.fulfill({ status: 401, json: { message: "Unauthorised" } });
    }
  });

  await page.goto(`/events/${eventId}/confirm`);
  await expect(
    page.getByRole("heading", { name: "Email verified" }),
  ).toBeVisible();
  const poll = page.getByRole("article", {
    name: "Which topic should we explore next?",
  });
  await poll.getByRole("radio", { name: "Operational resilience" }).check();
  await poll.getByRole("button", { name: "Submit response" }).click();
  await expect(poll.getByRole("alert")).toContainText("could not be saved");
  await expect(
    poll.getByRole("radio", { name: "Operational resilience" }),
  ).toBeChecked();
  await poll.getByRole("button", { name: "Submit response" }).click();
  await expect(poll.getByText("Response saved")).toBeVisible();
  await expect(poll.getByText("1 · 100%", { exact: true })).toBeVisible();

  state.poll.status = "CLOSED";
  state.poll.closedAt = new Date().toISOString();
  await page.getByRole("button", { name: "Refresh live poll" }).click();
  await expect(poll.getByText("Closed", { exact: true })).toBeVisible();
  await expect(
    poll.getByRole("button", { name: "Update response" }),
  ).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.locator("main input, main button").evaluateAll((elements) =>
      elements.every((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left >= 0 && rect.right <= document.documentElement.clientWidth
        );
      }),
    ),
  ).toBe(true);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("attendee-live-poll-mobile.png"),
    fullPage: true,
  });
});
