import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";
import type {
  LivePoll,
  LiveSessionSnapshot,
  User,
} from "../apps/web/src/lib/types";

const eventId = "33333333-3333-4333-8333-333333333332";
const livePath = `/streamops/events/${eventId}/live`;
const timestamp = "2026-09-04T10:00:00.000Z";
const actor = { id: "manager", name: "Alex Morgan", avatarInitials: "AM" };
const user: User = {
  ...actor,
  email: "alex.morgan@opspilot.demo",
  role: "OPERATIONS_MANAGER",
  workspaceId: "workspace",
  workspaceName: "Brightline Events",
};

function makePoll(overrides: Partial<LivePoll> = {}): LivePoll {
  return {
    id: "poll-one",
    sessionId: "session",
    question: "Which topic should we cover next?",
    status: "OPEN",
    openedAt: timestamp,
    closedAt: null,
    createdAt: timestamp,
    createdBy: actor,
    currentUserOptionId: null,
    responseCount: 2,
    options: [
      {
        id: "option-one",
        label: "Reliability",
        sortOrder: 0,
        responseCount: 1,
      },
      {
        id: "option-two",
        label: "Audience insights",
        sortOrder: 1,
        responseCount: 1,
      },
    ],
    ...overrides,
  };
}

// Only the HTTP boundary is replaced; routing, forms and query state are real.
async function mockLiveApi(
  page: Page,
  role: User["role"] = user.role,
  sessionStatus: "ACTIVE" | "ENDED" = "ACTIVE",
) {
  const state = {
    snapshot: {
      serverTime: timestamp,
      event: {
        id: eventId,
        title: "Partner Enablement Live",
        status: sessionStatus === "ACTIVE" ? "LIVE" : "COMPLETED",
        scheduledStart: timestamp,
        scheduledEnd: "2026-09-04T11:00:00.000Z",
        timezone: "Europe/London",
        expectedAttendees: 320,
      },
      session: {
        id: "session",
        eventId,
        status: sessionStatus,
        startedAt: timestamp,
        endedAt: sessionStatus === "ENDED" ? timestamp : null,
        startedBy: actor,
        endedBy: null,
        updates: [],
        polls: [
          makePoll(
            sessionStatus === "ENDED"
              ? { status: "CLOSED", closedAt: timestamp }
              : {},
          ),
        ],
      },
    } satisfies LiveSessionSnapshot,
    mutations: [] as Array<{ path: string; body: unknown }>,
    reads: 0,
    mutate: (_request: Request): { status: number; json: unknown } => ({
      status: 500,
      json: { message: "Unexpected mutation in UI test." },
    }),
  };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/live-session/stream")) {
      await route.abort();
    } else if (path.endsWith("/auth/me")) {
      await route.fulfill({ json: { user: { ...user, role } } });
    } else if (path.endsWith("/health/ready")) {
      await route.fulfill({ json: { status: "ready" } });
    } else if (request.method() === "GET" && path.endsWith("/live-session")) {
      state.reads++;
      await route.fulfill({ json: state.snapshot });
    } else if (["POST", "PATCH"].includes(request.method())) {
      state.mutations.push({ path, body: request.postDataJSON() as unknown });
      await route.fulfill(state.mutate(request));
    } else {
      await route.fulfill({
        status: 404,
        json: { message: "Unexpected API path." },
      });
    }
  });
  return state;
}

test("validates a draft, supports two to six options and preserves it after a failed save", async ({
  page,
}) => {
  const state = await mockLiveApi(page);
  state.snapshot.session.polls = [];
  await page.goto(livePath);
  await page.getByRole("button", { name: "New poll" }).click();
  const dialog = page.getByRole("dialog", { name: "Create live poll" });
  await expect(
    dialog.getByRole("button", { name: "Remove option 1" }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Poll question")
    .fill("What should we focus on next?");
  await dialog.getByLabel("Option 1", { exact: true }).fill("Reliability");
  await dialog.getByLabel("Option 2", { exact: true }).fill(" reliability ");
  await dialog
    .getByRole("button", { name: "Create poll", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Each option must be different.",
  );
  expect(state.mutations).toHaveLength(0);
  await dialog.getByLabel("Option 2", { exact: true }).fill("Media");
  for (let index = 3; index <= 6; index++) {
    await dialog.getByRole("button", { name: "Add option" }).click();
    await dialog
      .getByLabel(`Option ${index}`, { exact: true })
      .fill(`Topic ${index}`);
  }
  await expect(
    dialog.getByRole("button", { name: "Add option" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Remove option 3" }).click();
  await expect(dialog.getByLabel("Option 3", { exact: true })).toHaveValue(
    "Topic 4",
  );
  state.mutate = () => ({
    status: 503,
    json: { message: "Poll service unavailable. Try again." },
  });
  await dialog
    .getByRole("button", { name: "Create poll", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Poll service unavailable. Try again.",
  );
  await expect(dialog.getByLabel("Poll question")).toHaveValue(
    "What should we focus on next?",
  );
  await expect(dialog.getByLabel("Option 3", { exact: true })).toHaveValue(
    "Topic 4",
  );
  const draft = makePoll({
    status: "DRAFT",
    question: "What should we focus on next?",
    responseCount: 0,
    openedAt: null,
    options: ["Reliability", "Media", "Topic 4", "Topic 5", "Topic 6"].map(
      (label, sortOrder) => ({
        id: `option-${sortOrder}`,
        label,
        sortOrder,
        responseCount: 0,
      }),
    ),
  });
  state.mutate = () => {
    state.snapshot.session.polls = [draft];
    return { status: 201, json: draft };
  };
  await dialog
    .getByRole("button", { name: "Create poll", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("article", { name: draft.question }),
  ).toBeVisible();
  expect(state.mutations.at(-1)?.body).toEqual({
    question: draft.question,
    options: ["Reliability", "Media", "Topic 4", "Topic 5", "Topic 6"],
  });
  await page.getByRole("button", { name: "New poll" }).click();
  await expect(dialog.getByLabel("Poll question")).toHaveValue("");
  await expect(dialog.getByRole("textbox")).toHaveCount(3);
});

test("analysts can retry a failed vote and change a saved response without management controls", async ({
  page,
}) => {
  const state = await mockLiveApi(page, "ANALYST");
  await page.goto(livePath);
  const card = page.getByRole("article", { name: makePoll().question });
  await expect(page.getByRole("button", { name: "New poll" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Close poll" })).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Submit response" }),
  ).toBeDisabled();
  await card.getByRole("radio", { name: "Reliability", exact: true }).check();
  state.mutate = () => ({
    status: 503,
    json: { message: "Response could not be saved." },
  });
  await card.getByRole("button", { name: "Submit response" }).click();
  await expect(card.getByRole("alert")).toHaveText(
    "Response could not be saved.",
  );
  await expect(
    card.getByRole("radio", { name: "Reliability", exact: true }),
  ).toBeChecked();
  await expect(card.getByText("2 responses", { exact: true })).toBeVisible();
  const saved = makePoll({
    responseCount: 3,
    currentUserOptionId: "option-one",
    options: makePoll().options.map((option, index) => ({
      ...option,
      responseCount: index === 0 ? 2 : 1,
    })),
  });
  state.mutate = () => {
    state.snapshot.session.polls = [saved];
    return { status: 201, json: saved };
  };
  await card.getByRole("button", { name: "Submit response" }).click();
  await expect(card.getByText("Response saved")).toBeVisible();
  await expect(card.getByRole("alert")).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Update response" }),
  ).toBeDisabled();
  await card
    .getByRole("radio", { name: "Audience insights", exact: true })
    .check();
  const changed = {
    ...saved,
    currentUserOptionId: "option-two",
    options: saved.options.map((option, index) => ({
      ...option,
      responseCount: index === 0 ? 1 : 2,
    })),
  };
  state.mutate = () => {
    state.snapshot.session.polls = [changed];
    return { status: 201, json: changed };
  };
  await card.getByRole("button", { name: "Update response" }).click();
  await expect(
    card.getByRole("button", { name: "Update response" }),
  ).toBeDisabled();
  await expect(card.getByText("3 responses", { exact: true })).toBeVisible();
  await expect(
    card.getByRole("meter", { name: "Audience insights response share" }),
  ).toHaveAttribute("aria-valuenow", "67");
  expect(state.mutations.at(-1)).toEqual({
    path: `/api/v1/stream-events/${eventId}/live-polls/poll-one/responses`,
    body: { optionId: "option-two" },
  });
});

test("keeps close failures visible in the dialog and frees the next draft after retry", async ({
  page,
}) => {
  const state = await mockLiveApi(page);
  const draft = makePoll({
    id: "draft",
    question: "Are you ready for the next session?",
    status: "DRAFT",
    responseCount: 0,
  });
  state.snapshot.session.polls.push(draft);
  await page.goto(livePath);
  const card = page.getByRole("article", { name: makePoll().question });
  const next = page.getByRole("article", { name: draft.question });
  await expect(next.getByRole("button", { name: "Open poll" })).toBeDisabled();
  await card.getByRole("button", { name: "Close poll" }).click();
  const dialog = page.getByRole("dialog", { name: "Close this poll?" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(state.mutations).toHaveLength(0);
  await card.getByRole("button", { name: "Close poll" }).click();
  state.mutate = () => ({
    status: 503,
    json: { message: "Unable to close poll. Try again." },
  });
  await dialog.getByRole("button", { name: "Close poll", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Unable to close poll. Try again.",
  );
  await expect(next.getByRole("button", { name: "Open poll" })).toBeDisabled();
  const closed = makePoll({ status: "CLOSED", closedAt: timestamp });
  state.mutate = () => {
    state.snapshot.session.polls = [closed, draft];
    return { status: 200, json: closed };
  };
  await dialog.getByRole("button", { name: "Close poll", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(card.getByText("Closed", { exact: true })).toBeVisible();
  await expect(card.getByRole("radio")).toHaveCount(0);
  await expect(card.getByText("2 responses", { exact: true })).toBeVisible();
  await expect(next.getByRole("button", { name: "Open poll" })).toBeEnabled();
});

test("refreshes through REST when the live stream is unavailable", async ({
  page,
}) => {
  await page.clock.install();
  const state = await mockLiveApi(page);
  await page.goto(livePath);
  const card = page.getByRole("article", { name: makePoll().question });
  await expect(card.getByText("2 responses", { exact: true })).toBeVisible();
  await expect(page.getByText("Reconnecting to live updates")).toBeVisible();
  state.snapshot.session.polls = [
    makePoll({
      status: "CLOSED",
      closedAt: timestamp,
      responseCount: 3,
      options: makePoll().options.map((option, index) => ({
        ...option,
        responseCount: index === 0 ? 2 : 1,
      })),
    }),
  ];
  await page.clock.fastForward(15_100);
  await expect(card.getByText("Closed", { exact: true })).toBeVisible();
  await expect(card.getByText("3 responses", { exact: true })).toBeVisible();
  await expect(card.getByRole("radio")).toHaveCount(0);
  expect(state.reads).toBeGreaterThanOrEqual(2);
});

test("keeps a pending close confirmation open until the request finishes", async ({
  page,
}) => {
  const state = await mockLiveApi(page);
  let releaseResponse!: () => void;
  const pending = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let requests = 0;
  await page.route("**/live-polls/poll-one/status", async (route) => {
    requests++;
    await pending;
    const closed = makePoll({ status: "CLOSED", closedAt: timestamp });
    state.snapshot.session.polls = [closed];
    await route.fulfill({ json: closed });
  });
  try {
    await page.goto(livePath);
    await page.getByRole("button", { name: "Close poll" }).click();
    const dialog = page.getByRole("dialog", { name: "Close this poll?" });
    await dialog
      .getByRole("button", { name: "Close poll", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Close poll", exact: true }),
    ).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeVisible();
    expect(requests).toBe(1);
    releaseResponse();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("article").getByText("Closed", { exact: true }),
    ).toBeVisible();
  } finally {
    releaseResponse();
  }
});

test("shows final results without voting or management actions after event completion", async ({
  page,
}) => {
  await mockLiveApi(page, "OPERATIONS_MANAGER", "ENDED");
  await page.goto(livePath);
  const card = page.getByRole("article", { name: makePoll().question });
  await expect(card.getByText("2 responses", { exact: true })).toBeVisible();
  await expect(card.getByRole("meter")).toHaveCount(2);
  await expect(card.getByRole("radio")).toHaveCount(0);
  await expect(card.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New poll" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Complete event" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Record update" })).toHaveCount(
    0,
  );
});

test("preserves readable results and accessible controls across desktop and mobile", async ({
  page,
}, testInfo) => {
  await mockLiveApi(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(livePath);
  await expect(
    page.getByRole("article", { name: makePoll().question }),
  ).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const result = await new AxeBuilder({ page }).analyze();
    expect(
      result.violations.filter((item) =>
        ["critical", "serious"].includes(item.impact ?? ""),
      ),
    ).toEqual([]);
    expect(
      await page.locator("main button, main input").evaluateAll((elements) =>
        elements.every((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.left >= 0 && rect.right <= document.documentElement.clientWidth
          );
        }),
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`live-polls-${width}.png`),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
