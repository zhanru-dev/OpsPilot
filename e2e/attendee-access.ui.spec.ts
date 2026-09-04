import { expect, test, type Page } from "@playwright/test";

const eventId = "33333333-3333-4333-8333-333333333335";
const path = `/events/${eventId}/confirm`;
const token = "a".repeat(43);

async function mockAttendeeApi(page: Page) {
  const state = {
    eventStatus: 200,
    sessionStatus: 401,
    mutations: [] as string[],
  };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/v1/auth/")) {
      await route.fulfill({ status: 401, json: { message: "Unauthorised" } });
    } else if (request.method() === "POST") {
      state.mutations.push(url.pathname);
      await route.fulfill({
        status: 400,
        json: {
          message:
            "This verification link is invalid or has expired. Request a new link.",
        },
      });
    } else if (url.pathname.endsWith(`/public/events/${eventId}`)) {
      await route.fulfill({
        status: state.eventStatus,
        json: {
          id: eventId,
          title: "Product Operations Forum",
          organiser: "Brightline Events",
          status: "READY",
          registrationOpen: true,
          policy: { mode: "REGISTRATION", requiresConsent: true },
        },
      });
    } else if (url.pathname.endsWith("/attendee/session")) {
      await route.fulfill({
        status: state.sessionStatus,
        json:
          state.sessionStatus === 200
            ? {
                eventId,
                email: "guest@example.test",
                expiresAt: "2026-09-05T00:00:00.000Z",
              }
            : { message: "Attendee session is unavailable." },
      });
    } else {
      await route.fulfill({ status: 401, json: { message: "Unauthorised" } });
    }
  });
  return state;
}

test("opening a link never submits it and stale links show recovery", async ({
  page,
}) => {
  const state = await mockAttendeeApi(page);
  await page.goto(`${path}#token=${token}`);
  await expect(
    page.getByRole("heading", { name: "Confirm your registration" }),
  ).toBeVisible();
  await expect(page).toHaveURL(`http://localhost:3000${path}`);
  expect(state.mutations).toEqual([]);
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Confirm registration", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "invalid or has expired" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Request a new link" }),
  ).toBeVisible();
  expect(state.mutations).toEqual([
    `/api/v1/public/events/${eventId}/attendee/verify`,
  ]);
});

test("opening another link in the same tab replaces the old confirmation state", async ({
  page,
}) => {
  await mockAttendeeApi(page);
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Verify your email" }),
  ).toBeVisible();
  await page.goto(`${path}#token=${token}`);
  await expect(
    page.getByRole("heading", { name: "Confirm your registration" }),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Confirm registration", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "invalid or has expired" }),
  ).toBeVisible();
  await page.goto(`${path}#token=${"b".repeat(43)}`);
  await expect(
    page.getByRole("alert").filter({ hasText: "invalid or has expired" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Confirm registration", exact: true }),
  ).toBeEnabled();
});

test("unavailable events never expose a confirmation form", async ({
  page,
}) => {
  const state = await mockAttendeeApi(page);
  state.eventStatus = 404;
  await page.goto(`${path}#token=${token}`);
  await expect(
    page.getByText("Attendee access is unavailable for this event."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Product Operations Forum" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Confirm registration", exact: true }),
  ).toHaveCount(0);
  expect(state.mutations).toEqual([]);
});

test("an expired session stops showing an active attendee identity", async ({
  page,
}) => {
  const state = await mockAttendeeApi(page);
  state.sessionStatus = 200;
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Email verified" }),
  ).toBeVisible();
  state.sessionStatus = 401;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Verify your email" }),
  ).toBeVisible();
  await expect(page.getByText("guest@example.test")).toHaveCount(0);
});
